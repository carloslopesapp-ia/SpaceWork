import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/worker/app";
import { registerUser } from "./auth-helpers";
import { countFiles, setQuota, uploadFile, uploadOk, usedBytes } from "./file-helpers";
import { createFolder, getContents } from "./folder-helpers";
import { ORIGIN, api, resetState } from "./helpers";

beforeEach(resetState);

describe("PUT /api/files (upload)", () => {
  it("grava o ficheiro no R2 e na D1 e devolve-o", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const res = await uploadFile(cookie, "nota.txt", "olá mundo", { type: "text/plain" });
    expect(res.status).toBe(201);
    const { file } = (await res.json()) as { file: Record<string, unknown> };
    expect(file).toMatchObject({ name: "nota.txt", folderId: null, size: 10, mime: "text/plain" });

    const object = await env.FILES.get(`u/${user.id}/${file.id}`);
    expect(await object?.text()).toBe("olá mundo");
    expect(object?.httpMetadata?.contentType).toBe("text/plain");

    const row = await env.DB.prepare("SELECT status, r2_key FROM files WHERE id = ?1")
      .bind(file.id)
      .first<{ status: string; r2_key: string }>();
    expect(row).toEqual({ status: "ready", r2_key: `u/${user.id}/${file.id}` });
  });

  it("conta o tamanho em bytes na quota e mostra o ficheiro na listagem", async () => {
    const { cookie } = await registerUser("ana@example.com");
    await uploadOk(cookie, "a.txt", "12345");
    await uploadOk(cookie, "b.txt", "123");
    expect(await usedBytes(cookie)).toBe(8);
    const contents = await getContents(cookie);
    expect(contents.files.map((f) => [f.name, f.size])).toEqual([
      ["a.txt", 5],
      ["b.txt", 3],
    ]);
  });

  it("guarda o ficheiro na pasta indicada e só aí aparece", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const docs = await createFolder(cookie, "Docs");
    const file = await uploadOk(cookie, "a.txt", "x", { folder: docs.id });
    expect(file.folderId).toBe(docs.id);
    expect((await getContents(cookie, docs.id)).files.map((f) => f.name)).toEqual(["a.txt"]);
    expect((await getContents(cookie)).files).toEqual([]);
  });

  it("aceita ficheiros vazios", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "vazio.txt", "");
    expect(file.size).toBe(0);
    expect(await usedBytes(cookie)).toBe(0);
  });

  it("normaliza o nome e recusa nomes inválidos (400)", async () => {
    const { cookie } = await registerUser("ana@example.com");
    expect((await uploadOk(cookie, "  Relatório.pdf ", "x")).name).toBe("Relatório.pdf");
    for (const name of ["", "a/b", "..", "a".repeat(256)]) {
      const res = await uploadFile(cookie, name, "x");
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_name" });
    }
    expect(await countFiles()).toBe(1);
  });

  it("limpa o Content-Type: tira parâmetros e troca lixo por application/octet-stream", async () => {
    const { cookie } = await registerUser("ana@example.com");
    expect((await uploadOk(cookie, "a.html", "x", { type: "Text/HTML; charset=utf-8" })).mime).toBe("text/html");
    expect((await uploadOk(cookie, "b.bin", "x", { type: "isto nao e um tipo" })).mime).toBe("application/octet-stream");
    expect((await uploadOk(cookie, "c.bin", "x", { type: "" })).mime).toBe("application/octet-stream");
  });

  it("devolve 404 se a pasta não existir ou for de outro utilizador, sem gastar quota", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await createFolder(bob.cookie, "Privada");
    for (const folder of ["nao-existe", doBob.id]) {
      const res = await uploadFile(ana.cookie, "a.txt", "x", { folder });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "folder_not_found" });
    }
    expect(await countFiles()).toBe(0);
    expect(await usedBytes(ana.cookie)).toBe(0);
  });

  it("recusa um nome repetido no mesmo sítio (409) sem gastar quota nem deixar objeto no R2", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const docs = await createFolder(cookie, "Docs");
    await uploadOk(cookie, "a.txt", "12345");
    const dup = await uploadFile(cookie, "a.txt", "999");
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "name_taken" });
    expect(await usedBytes(cookie)).toBe(5);
    expect(await countFiles()).toBe(1);
    expect((await env.FILES.list({ prefix: "u/" })).objects).toHaveLength(1);
    await uploadOk(cookie, "a.txt", "ok", { folder: docs.id }); // outra pasta: permitido
  });

  it("exige sessão", async () => {
    const res = await api("/api/files?name=a.txt", { method: "PUT", body: new Uint8Array(1) });
    expect(res.status).toBe(401);
  });
});

describe("quota", () => {
  it("recusa com 413 quota_exceeded um ficheiro que não cabe e aceita o que cabe à justa", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    await setQuota(user.id, 10);
    const tooBig = await uploadFile(cookie, "grande.bin", new Uint8Array(11));
    expect(tooBig.status).toBe(413);
    expect(await tooBig.json()).toMatchObject({ error: "quota_exceeded" });
    expect(await countFiles()).toBe(0);
    expect(await usedBytes(cookie)).toBe(0);

    await uploadOk(cookie, "justo.bin", new Uint8Array(10));
    expect(await usedBytes(cookie)).toBe(10);
    expect((await uploadFile(cookie, "mais.bin", new Uint8Array(1))).status).toBe(413);
    expect(await usedBytes(cookie)).toBe(10);
  });

  it("uploads em paralelo nunca ultrapassam a quota", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    await setQuota(user.id, 100);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => uploadFile(cookie, `p${i}.bin`, new Uint8Array(30))),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201, 201, 413, 413]);
    expect(await usedBytes(cookie)).toBe(90);
    expect(await countFiles()).toBe(3);
  });

  it("uma conta suspensa não consegue reservar espaço", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    // A sessão deixa de valer ao suspender; este caso cobre a condição `status = 'active'` da reserva.
    await env.DB.prepare("UPDATE users SET status = 'suspended' WHERE id = ?1").bind(user.id).run();
    const res = await uploadFile(cookie, "a.txt", "x");
    expect(res.status).toBe(401);
    expect(await countFiles()).toBe(0);
  });
});

describe("limites e falhas", () => {
  // Chama a app diretamente com bindings/variáveis alterados. Aqui o Content-Length tem de ser posto à mão
  // (`lengthHeader: null` omite-o).
  function rawUpload(
    name: string,
    body: Uint8Array,
    cookie: string,
    override: Record<string, unknown>,
    lengthHeader: string | null = String(body.length),
  ) {
    const request = new Request(`${ORIGIN}/api/files?name=${name}`, {
      method: "PUT",
      body,
      headers: {
        Origin: ORIGIN,
        Cookie: cookie,
        "Content-Type": "application/octet-stream",
        ...(lengthHeader === null ? {} : { "Content-Length": lengthHeader }),
      },
    });
    return app.fetch(request, { ...env, ...override } as Env);
  }

  it("recusa com 413 file_too_large um ficheiro acima de MAX_UPLOAD_BYTES", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const res = await rawUpload("g.bin", new Uint8Array(11), cookie, { MAX_UPLOAD_BYTES: "10" });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "file_too_large" });
    expect(await countFiles()).toBe(0);
    expect(await usedBytes(cookie)).toBe(0);
    const ok = await rawUpload("ok.bin", new Uint8Array(10), cookie, { MAX_UPLOAD_BYTES: "10" });
    expect(ok.status).toBe(201);
  });

  it("exige um Content-Length válido (411): sem ele o R2 não aceitaria o corpo em stream", async () => {
    const { cookie } = await registerUser("ana@example.com");
    for (const lengthHeader of [null, "", "abc", "-5", "1.5"]) {
      const res = await rawUpload("s.bin", new Uint8Array(3), cookie, {}, lengthHeader);
      expect(res.status, String(lengthHeader)).toBe(411);
      expect(await res.json()).toMatchObject({ error: "length_required" });
    }
    expect(await countFiles()).toBe(0);
  });

  it("se o R2 falhar, devolve o espaço, apaga a linha pending e tenta limpar o objeto", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const deleted: string[] = [];
    const brokenR2 = {
      put: async () => {
        throw new Error("r2 em baixo");
      },
      delete: async (key: string) => {
        deleted.push(key);
      },
    };
    const res = await rawUpload("a.bin", new Uint8Array(7), cookie, { FILES: brokenR2 as unknown as R2Bucket });
    expect(res.status).toBe(500);
    expect(await countFiles()).toBe(0);
    expect(await usedBytes(cookie)).toBe(0);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatch(/^u\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
  });

  it("se o tamanho gravado for diferente do declarado, trata como falha e devolve o espaço", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const wrongSizeR2 = { put: async () => ({ size: 3 }), delete: async () => undefined };
    const res = await rawUpload("a.bin", new Uint8Array(5), cookie, { FILES: wrongSizeR2 as unknown as R2Bucket });
    expect(res.status).toBe(500);
    expect(await countFiles()).toBe(0);
    expect(await usedBytes(cookie)).toBe(0);
  });

  it("uploads pending (a meio) não aparecem nas listagens", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    await env.DB.prepare(
      `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at)
       VALUES ('p1', ?1, NULL, 'a meio.txt', 'a meio.txt', 1, 'text/plain', 'u/x/p1', 'pending', 1)`,
    )
      .bind(user.id)
      .run();
    expect((await getContents(cookie)).files).toEqual([]);
  });
});
