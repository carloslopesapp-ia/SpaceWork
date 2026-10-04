import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { FolderItem } from "../src/shared/types";
import { registerUser } from "./auth-helpers";
import { createFolder, getContents } from "./folder-helpers";
import { api, resetDb } from "./helpers";

beforeEach(resetDb);

const patch = (cookie: string, id: string, json: unknown) =>
  api(`/api/folders/${id}`, { method: "PATCH", cookie, json });
const remove = (cookie: string, id: string) =>
  api(`/api/folders/${id}`, { method: "DELETE", cookie });

async function insertFileRow(
  userId: string,
  folderId: string | null,
  options: { name?: string; status?: string; deletedAt?: number | null } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at, deleted_at)
     VALUES (?1, ?2, ?3, ?4, ?4, 1, 'text/plain', ?5, ?6, 1, ?7)`,
  )
    .bind(
      id,
      userId,
      folderId,
      options.name ?? "a.txt",
      `u/${userId}/${id}`,
      options.status ?? "ready",
      options.deletedAt ?? null,
    )
    .run();
  return id;
}

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
    expect((await patch(cookie, a.id, { name: "a/b" })).status).toBe(400);
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
