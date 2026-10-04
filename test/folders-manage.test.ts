import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { FolderItem } from "../src/shared/types";
import { registerUser } from "./auth-helpers";
import { insertFileRow } from "./file-helpers";
import { createFolder, getContents } from "./folder-helpers";
import { dbWithStatementHook, fetchWithEnv } from "./db-helpers";
import { api, buildRequest, resetDb } from "./helpers";

beforeEach(resetDb);

const patch = (cookie: string, id: string, json: unknown) =>
  api(`/api/folders/${id}`, { method: "PATCH", cookie, json });
const remove = (cookie: string, id: string) =>
  api(`/api/folders/${id}`, { method: "DELETE", cookie });

describe("PATCH /api/folders/:id (renomear)", () => {
  it("renomeia e normaliza o nome", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const folder = await createFolder(cookie, "Fotos");
    const res = await patch(cookie, folder.id, { name: "  Férias " });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { folder: FolderItem }).folder).toMatchObject({
      id: folder.id,
      name: "Férias",
      parentId: null,
    });
    expect((await getContents(cookie)).folders.map((f) => f.name)).toEqual(["Férias"]);
  });

  it("recusa nomes inválidos (400) e nomes repetidos (409), mas aceita o nome atual", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    await createFolder(cookie, "B");
    const invalid = await patch(cookie, a.id, { name: "a/b" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_name" });
    const dup = await patch(cookie, a.id, { name: "B" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "name_taken" });
    expect((await patch(cookie, a.id, { name: "A" })).status).toBe(200);
  });

  it("recusa um surrogate isolado no nome (400 invalid_name): a D1 gravaria U+FFFD e a resposta divergiria da base", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const res = await patch(cookie, a.id, { name: "\ud800.txt" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_name" });
    expect((await getContents(cookie)).folders.map((f) => f.name)).toEqual(["A"]);
  });

  it("recusa um nome que não é texto ({ name: 5 }) e um corpo que não é um objeto (400)", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const notText = await patch(cookie, a.id, { name: 5 });
    expect(notText.status).toBe(400);
    expect(await notText.json()).toMatchObject({ error: "invalid_name" });
    for (const json of ["texto", [1, 2], null]) {
      const res = await patch(cookie, a.id, json);
      expect(res.status, JSON.stringify(json)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_body" });
    }
  });

  it("recusa um corpo acima de 64 KiB (413)", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const res = await patch(cookie, a.id, { name: "a".repeat(70 * 1024) });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "payload_too_large" });
    expect((await getContents(cookie)).folders.map((f) => f.name)).toEqual(["A"]);
  });

  it("exige name e/ou parentId", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const res = await patch(cookie, a.id, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_body" });
  });

  it("devolve 404 para pastas inexistentes ou de outro utilizador", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await createFolder(bob.cookie, "Privada");
    expect((await patch(ana.cookie, doBob.id, { name: "X" })).status).toBe(404);
    expect((await patch(ana.cookie, "nao-existe", { name: "X" })).status).toBe(404);
    expect((await getContents(bob.cookie)).folders[0].name).toBe("Privada");
  });
});

describe("PATCH /api/folders/:id (mover)", () => {
  it("move para outra pasta e de volta para a raiz (null e 'root')", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B");
    const moved = await patch(cookie, b.id, { parentId: a.id });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as { folder: FolderItem }).folder.parentId).toBe(a.id);
    expect((await getContents(cookie, b.id)).breadcrumb.map((x) => x.name)).toEqual(["A", "B"]);

    expect((await patch(cookie, b.id, { parentId: null })).status).toBe(200);
    expect((await getContents(cookie)).folders.map((f) => f.name)).toEqual(["A", "B"]);
    await patch(cookie, b.id, { parentId: a.id });
    expect((await patch(cookie, b.id, { parentId: "root" })).status).toBe(200);
    expect((await getContents(cookie, a.id)).folders).toEqual([]);
  });

  it("recusa mover uma pasta para dentro de si própria ou de uma descendente (400)", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B", a.id);
    const c = await createFolder(cookie, "C", b.id);
    for (const target of [a.id, b.id, c.id]) {
      const res = await patch(cookie, a.id, { parentId: target });
      expect(res.status, `A para ${target}`).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_move" });
    }
    // continua tudo no sítio
    expect((await getContents(cookie, c.id)).breadcrumb.map((x) => x.name)).toEqual(["A", "B", "C"]);
  });

  it("permite mover uma pasta para dentro de uma irmã ou de uma antepassada", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B", a.id);
    const c = await createFolder(cookie, "C", b.id);
    expect((await patch(cookie, c.id, { parentId: a.id })).status).toBe(200);
    expect((await getContents(cookie, c.id)).breadcrumb.map((x) => x.name)).toEqual(["A", "C"]);
  });

  it("recusa o destino que não existe ou é de outro utilizador (404) e o nome repetido no destino (409)", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const a = await createFolder(ana.cookie, "A");
    const doBob = await createFolder(bob.cookie, "Privada");
    expect((await patch(ana.cookie, a.id, { parentId: doBob.id })).status).toBe(404);
    expect((await patch(ana.cookie, a.id, { parentId: "nao-existe" })).status).toBe(404);

    const dest = await createFolder(ana.cookie, "Destino");
    await createFolder(ana.cookie, "A", dest.id);
    const clash = await patch(ana.cookie, a.id, { parentId: dest.id });
    expect(clash.status).toBe(409);
  });

  it("recusa mover para a raiz uma pasta cujo nome já existe lá (409) e um parentId que não é texto (400)", async () => {
    const { cookie } = await registerUser("ana@example.com");
    await createFolder(cookie, "X");
    const b = await createFolder(cookie, "B");
    const inner = await createFolder(cookie, "X", b.id);
    const clash = await patch(cookie, inner.id, { parentId: "root" });
    expect(clash.status).toBe(409);
    expect(await clash.json()).toMatchObject({ error: "name_taken" });
    expect((await getContents(cookie, b.id)).folders.map((f) => f.name)).toEqual(["X"]); // ficou onde estava

    const bad = await patch(cookie, inner.id, { parentId: 5 });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_body" });
  });

  it("move e renomeia no mesmo pedido", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B");
    const res = await patch(cookie, b.id, { name: "Novo", parentId: a.id });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { folder: FolderItem }).folder).toMatchObject({
      name: "Novo",
      parentId: a.id,
    });
  });
});

describe("DELETE /api/folders/:id", () => {
  it("apaga uma pasta vazia", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const res = await remove(cookie, a.id);
    expect(res.status).toBe(204);
    expect((await getContents(cookie)).folders).toEqual([]);
    expect((await api(`/api/folders/${a.id}/contents`, { cookie })).status).toBe(404);
  });

  it("recusa apagar uma pasta com subpastas (409 folder_not_empty)", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    await createFolder(cookie, "B", a.id);
    const res = await remove(cookie, a.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "folder_not_empty" });
    expect((await getContents(cookie)).folders.map((f) => f.name)).toEqual(["A"]);
  });

  it("recusa apagar uma pasta com ficheiros, incluindo um ficheiro ainda a ser carregado (pending)", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B");
    await insertFileRow(user.id, a.id, { status: "ready" });
    await insertFileRow(user.id, b.id, { status: "pending" });
    expect((await remove(cookie, a.id)).status).toBe(409);
    expect((await remove(cookie, b.id)).status).toBe(409);
  });

  it("uma pasta só com ficheiros na lixeira apaga-se e os ficheiros passam para a raiz", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const fileId = await insertFileRow(user.id, a.id, { deletedAt: 5 });
    expect((await remove(cookie, a.id)).status).toBe(204);
    const row = await env.DB.prepare("SELECT folder_id, deleted_at FROM files WHERE id = ?1")
      .bind(fileId)
      .first<{ folder_id: string | null; deleted_at: number | null }>();
    expect(row).toEqual({ folder_id: null, deleted_at: 5 });
  });

  it("conteúdo acrescentado depois da verificação: 409 e a batch reverte (o ficheiro da lixeira não sai da pasta)", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const a = await createFolder(ana.cookie, "A");
    const naLixeira = await insertFileRow(ana.user.id, a.id, { name: "lixo.txt", deletedAt: 5 });
    // A pasta passa a verificação (só tem um ficheiro na lixeira) e, antes da batch, aparece lá dentro um ficheiro de
    // outro utilizador: a chave estrangeira recusa o DELETE e o UPDATE que já tinha corrido na batch tem de desfazer-se.
    const racingDb = dbWithStatementHook(/^\s*UPDATE files SET folder_id = NULL/, async () => {
      await insertFileRow(bob.user.id, a.id, { name: "intruso.txt" });
    });
    const res = await fetchWithEnv(buildRequest(`/api/folders/${a.id}`, { method: "DELETE", cookie: ana.cookie }), {
      DB: racingDb,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "folder_not_empty" });
    const row = await env.DB.prepare("SELECT folder_id FROM files WHERE id = ?1")
      .bind(naLixeira)
      .first<{ folder_id: string | null }>();
    expect(row?.folder_id).toBe(a.id);
    expect((await getContents(ana.cookie)).folders.map((f) => f.name)).toEqual(["A"]);
  });

  it("devolve 404 para pastas inexistentes ou de outro utilizador e exige sessão", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await createFolder(bob.cookie, "Privada");
    expect((await remove(ana.cookie, doBob.id)).status).toBe(404);
    expect((await remove(ana.cookie, "nao-existe")).status).toBe(404);
    expect((await api(`/api/folders/${doBob.id}`, { method: "DELETE" })).status).toBe(401);
    expect((await getContents(bob.cookie)).folders).toHaveLength(1);
  });
});
