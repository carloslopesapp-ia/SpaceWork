import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { FileItem } from "../src/shared/types";
import { registerUser } from "./auth-helpers";
import { uploadOk, usedBytes } from "./file-helpers";
import { createFolder, getContents } from "./folder-helpers";
import { api, resetState } from "./helpers";

beforeEach(resetState);

const patch = (cookie: string, id: string, json: unknown) =>
  api(`/api/files/${id}`, { method: "PATCH", cookie, json });
const remove = (cookie: string, id: string) => api(`/api/files/${id}`, { method: "DELETE", cookie });

describe("PATCH /api/files/:id (renomear)", () => {
  it("renomeia, normaliza o nome e não mexe no conteúdo nem na chave do R2", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "conteúdo");
    const res = await patch(cookie, file.id, { name: "  Relatório.txt " });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { file: FileItem };
    expect(body.file).toMatchObject({ id: file.id, name: "Relatório.txt", folderId: null, size: file.size });
    expect(Object.keys(body.file).sort()).toEqual(
      ["createdAt", "folderId", "id", "mime", "name", "size"],
    ); // nunca expõe a chave do R2
    expect((await getContents(cookie)).files.map((f) => f.name)).toEqual(["Relatório.txt"]);
    expect(await (await env.FILES.get(`u/${user.id}/${file.id}`))?.text()).toBe("conteúdo");
    const download = await api(`/api/files/${file.id}/download`, { cookie });
    expect(await download.text()).toBe("conteúdo");
  });

  it("recusa nomes inválidos (400) e repetidos (409), mas aceita o nome atual", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await uploadOk(cookie, "a.txt", "x");
    await uploadOk(cookie, "b.txt", "x");
    expect((await patch(cookie, a.id, { name: "a/b" })).status).toBe(400);
    const dup = await patch(cookie, a.id, { name: "b.txt" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "name_taken" });
    expect((await patch(cookie, a.id, { name: "a.txt" })).status).toBe(200);
  });

  it("exige name e/ou folderId", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await uploadOk(cookie, "a.txt", "x");
    const res = await patch(cookie, a.id, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_body" });
  });
});

describe("PATCH /api/files/:id (mover)", () => {
  it("move para uma pasta e de volta para a raiz (null e 'root')", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const docs = await createFolder(cookie, "Docs");
    const file = await uploadOk(cookie, "a.txt", "x");
    const moved = await patch(cookie, file.id, { folderId: docs.id });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as { file: FileItem }).file.folderId).toBe(docs.id);
    expect((await getContents(cookie, docs.id)).files.map((f) => f.name)).toEqual(["a.txt"]);
    expect((await getContents(cookie)).files).toEqual([]);

    expect((await patch(cookie, file.id, { folderId: null })).status).toBe(200);
    expect((await getContents(cookie)).files.map((f) => f.name)).toEqual(["a.txt"]);
    await patch(cookie, file.id, { folderId: docs.id });
    expect((await patch(cookie, file.id, { folderId: "root" })).status).toBe(200);
    expect((await getContents(cookie, docs.id)).files).toEqual([]);
  });

  it("recusa o destino que não existe ou é de outro utilizador (404) e o nome repetido no destino (409)", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await createFolder(bob.cookie, "Privada");
    const file = await uploadOk(ana.cookie, "a.txt", "x");
    expect((await patch(ana.cookie, file.id, { folderId: doBob.id })).status).toBe(404);
    expect((await patch(ana.cookie, file.id, { folderId: "nao-existe" })).status).toBe(404);

    const dest = await createFolder(ana.cookie, "Destino");
    await uploadOk(ana.cookie, "a.txt", "outro", { folder: dest.id });
    const clash = await patch(ana.cookie, file.id, { folderId: dest.id });
    expect(clash.status).toBe(409);
  });

  it("move e renomeia no mesmo pedido", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const docs = await createFolder(cookie, "Docs");
    const file = await uploadOk(cookie, "a.txt", "x");
    const res = await patch(cookie, file.id, { name: "novo.txt", folderId: docs.id });
    expect(((await res.json()) as { file: FileItem }).file).toMatchObject({ name: "novo.txt", folderId: docs.id });
  });
});

describe("DELETE /api/files/:id (excluir para a lixeira)", () => {
  it("tira o ficheiro das listagens e dos downloads mas mantém objeto e quota", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "12345");
    const res = await remove(cookie, file.id);
    expect(res.status).toBe(204);
    expect((await getContents(cookie)).files).toEqual([]);
    expect((await api(`/api/files/${file.id}/download`, { cookie })).status).toBe(404);
    expect(await usedBytes(cookie)).toBe(5);
    expect(await env.FILES.head(`u/${user.id}/${file.id}`)).not.toBeNull();
    const row = await env.DB.prepare("SELECT deleted_at FROM files WHERE id = ?1")
      .bind(file.id)
      .first<{ deleted_at: number | null }>();
    expect(row?.deleted_at).toBeGreaterThan(0);
  });

  it("permite voltar a usar o mesmo nome depois de excluir", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "um");
    await remove(cookie, file.id);
    const again = await uploadOk(cookie, "a.txt", "dois");
    expect(again.id).not.toBe(file.id);
  });

  it("excluir duas vezes dá 404; ficheiros de outro utilizador também", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await uploadOk(bob.cookie, "privado.txt", "x");
    const minha = await uploadOk(ana.cookie, "a.txt", "x");
    expect((await remove(ana.cookie, minha.id)).status).toBe(204);
    expect((await remove(ana.cookie, minha.id)).status).toBe(404);
    expect((await remove(ana.cookie, doBob.id)).status).toBe(404);
    expect((await getContents(bob.cookie)).files).toHaveLength(1);
  });
});
