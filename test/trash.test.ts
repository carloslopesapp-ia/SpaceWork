import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrashContents } from "../src/shared/types";
import { registerUser } from "./auth-helpers";
import { dbWithStatementHook, fetchWithEnv, silenceErrors } from "./db-helpers";
import { insertFileRow, uploadOk, usedBytes } from "./file-helpers";
import { createFolder, getContents } from "./folder-helpers";
import { api, buildRequest, resetState } from "./helpers";

beforeEach(resetState);
afterEach(() => {
  vi.restoreAllMocks();
});

const DAY_MS = 86_400_000;

async function trashFile(cookie: string, id: string): Promise<void> {
  expect((await api(`/api/files/${id}`, { method: "DELETE", cookie })).status).toBe(204);
}

async function listTrash(cookie: string): Promise<TrashContents> {
  const res = await api("/api/trash", { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as TrashContents;
}

/** Cria `count` ficheiros já na lixeira, por SQL e com o objeto no R2 (bem mais rápido do que pela API). */
async function seedTrashed(userId: string, count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, (_unused, index) => `lixo-${String(index).padStart(3, "0")}`);
  await env.DB.batch([
    ...ids.map((id, index) =>
      env.DB.prepare(
        `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at, deleted_at)
         VALUES (?1, ?2, NULL, ?1, ?1, 10, 'text/plain', ?3, 'ready', 0, ?4)`,
      ).bind(id, userId, `u/${userId}/${id}`, 1000 + index),
    ),
    env.DB.prepare("UPDATE users SET used_bytes = used_bytes + ?1 WHERE id = ?2").bind(10 * count, userId),
  ]);
  await Promise.all(ids.map((id) => env.FILES.put(`u/${userId}/${id}`, "0123456789")));
  return ids;
}

const objectCount = async () => (await env.FILES.list({ prefix: "u/" })).objects.length;

describe("GET /api/trash", () => {
  it("exige sessão", async () => {
    expect((await api("/api/trash")).status).toBe(401);
  });

  it("lista só os ficheiros excluídos do utilizador, do mais recente para o mais antigo, com a pasta e a data de eliminação", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const fotos = await createFolder(ana.cookie, "Fotos");
    const ferias = await createFolder(ana.cookie, "Férias", fotos.id);
    const antigo = await uploadOk(ana.cookie, "antigo.txt", "x");
    const recente = await uploadOk(ana.cookie, "praia.png", "xy", { folder: ferias.id });
    await uploadOk(ana.cookie, "fica.txt", "x");
    const doBob = await uploadOk(bob.cookie, "do-bob.txt", "x");
    await trashFile(ana.cookie, antigo.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await trashFile(ana.cookie, recente.id);
    await trashFile(bob.cookie, doBob.id);

    const { items, total, retentionDays } = await listTrash(ana.cookie);

    expect(items.map((item) => item.name)).toEqual(["praia.png", "antigo.txt"]);
    expect(total).toBe(2);
    expect(retentionDays).toBe(30);
    expect(items[0]).toMatchObject({ id: recente.id, size: 2, folderId: ferias.id });
    expect(items[0].path).toEqual([
      { id: fotos.id, name: "Fotos" },
      { id: ferias.id, name: "Férias" },
    ]);
    expect(items[1]).toMatchObject({ folderId: null, path: [] });
    expect(items[0].purgeAt).toBe(items[0].deletedAt + 30 * DAY_MS);
  });

  it("está vazia sem ficheiros excluídos, e um ficheiro `pending` nunca aparece", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    await insertFileRow(user.id, null, { name: "pendente.txt", status: "pending" });
    expect(await listTrash(cookie)).toEqual({ items: [], total: 0, retentionDays: 30 });
  });

  it("mostra no máximo os 200 mais recentes, e `total` conta todos", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    await seedTrashed(user.id, 205);
    const { items, total } = await listTrash(cookie);
    expect(items).toHaveLength(200);
    expect(total).toBe(205);
    expect(items[0].name).toBe("lixo-204"); // o mais recente: deleted_at 1204
  });
});

describe("DELETE /api/trash/:id", () => {
  it("elimina o ficheiro de vez: o objeto do R2, a linha e o espaço usado", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "12345");
    await uploadOk(cookie, "fica.txt", "123");
    await trashFile(cookie, file.id);
    expect(await usedBytes(cookie)).toBe(8); // na lixeira ainda ocupa espaço
    expect(await objectCount()).toBe(2);

    const res = await api(`/api/trash/${file.id}`, { method: "DELETE", cookie });

    expect(res.status).toBe(204);
    expect(await usedBytes(cookie)).toBe(3);
    expect(await objectCount()).toBe(1);
    expect((await listTrash(cookie)).total).toBe(0);
    expect((await getContents(cookie)).files.map((f) => f.name)).toEqual(["fica.txt"]);
  });

  it("só elimina ficheiros que estão na lixeira e que são do utilizador (senão 404)", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const ativo = await uploadOk(ana.cookie, "ativo.txt", "x");
    const apagado = await uploadOk(ana.cookie, "apagado.txt", "x");
    await trashFile(ana.cookie, apagado.id);

    for (const [cookie, id] of [[ana.cookie, ativo.id], [bob.cookie, apagado.id], [ana.cookie, "nao-existe"]]) {
      const res = await api(`/api/trash/${id}`, { method: "DELETE", cookie });
      expect(res.status, id).toBe(404);
      expect(await res.json()).toMatchObject({ error: "file_not_found" });
    }
    expect(await objectCount()).toBe(2);
    expect((await listTrash(ana.cookie)).total).toBe(1);
  });

  it("a quota nunca fica negativa, mesmo que a contabilidade esteja desviada", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "12345");
    await trashFile(cookie, file.id);
    await env.DB.prepare("UPDATE users SET used_bytes = 2 WHERE id = ?1").bind(user.id).run();

    expect((await api(`/api/trash/${file.id}`, { method: "DELETE", cookie })).status).toBe(204);

    expect(await usedBytes(cookie)).toBe(0);
  });

  it("se o R2 falhar, a linha e a quota ficam certas e o objeto órfão fica registado", async () => {
    const errors = silenceErrors();
    const { cookie, user } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "12345");
    await trashFile(cookie, file.id);
    const r2Key = `u/${user.id}/${file.id}`;
    const brokenFiles = new Proxy(env.FILES, {
      get(target, prop) {
        if (prop === "delete") return () => Promise.reject(new Error("R2 em baixo"));
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const res = await fetchWithEnv(buildRequest(`/api/trash/${file.id}`, { method: "DELETE", cookie }), { FILES: brokenFiles });

    expect(res.status).toBe(204);
    expect(await usedBytes(cookie)).toBe(0);
    expect((await listTrash(cookie)).total).toBe(0);
    expect(errors).toHaveBeenCalled();
    expect(errors.mock.calls.some((call) => String(call[0]).includes(r2Key))).toBe(true);
    expect(await env.FILES.head(r2Key)).not.toBeNull();
  });
});

describe("DELETE /api/trash (esvaziar)", () => {
  it("esvazia por blocos de 50 e diz quantos faltam", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    await seedTrashed(user.id, 55);
    const ativo = await uploadOk(cookie, "ativo.txt", "123");
    expect(await usedBytes(cookie)).toBe(553);

    const first = await api("/api/trash", { method: "DELETE", cookie });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ purged: 50, remaining: 5 });
    expect(await usedBytes(cookie)).toBe(53);
    expect(await objectCount()).toBe(6); // 5 na lixeira + o ativo

    const second = await api("/api/trash", { method: "DELETE", cookie });
    expect(await second.json()).toEqual({ purged: 5, remaining: 0 });
    expect(await usedBytes(cookie)).toBe(3);
    expect(await objectCount()).toBe(1);
    expect((await getContents(cookie)).files.map((f) => f.id)).toEqual([ativo.id]);

    const third = await api("/api/trash", { method: "DELETE", cookie });
    expect(await third.json()).toEqual({ purged: 0, remaining: 0 });
  });

  it("não mexe na lixeira de outro utilizador", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    await seedTrashed(bob.user.id, 3);
    await api("/api/trash", { method: "DELETE", cookie: ana.cookie });
    expect((await listTrash(bob.cookie)).total).toBe(3);
    expect(await objectCount()).toBe(3);
  });

  it("um ficheiro restaurado entre a escolha e a eliminação não é apagado nem perde o objeto", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const [first, second] = await seedTrashed(user.id, 2);
    const racingDb = dbWithStatementHook(/^\s*UPDATE users SET used_bytes = MAX/, async () => {
      await env.DB.prepare("UPDATE files SET deleted_at = NULL WHERE id = ?1").bind(first).run();
    });

    const res = await fetchWithEnv(buildRequest("/api/trash", { method: "DELETE", cookie }), { DB: racingDb });

    expect(await res.json()).toEqual({ purged: 1, remaining: 0 });
    expect(await env.FILES.head(`u/${user.id}/${first}`)).not.toBeNull();
    expect(await env.FILES.head(`u/${user.id}/${second}`)).toBeNull();
    expect(await usedBytes(cookie)).toBe(10); // só o ficheiro restaurado continua a contar
  });
});
