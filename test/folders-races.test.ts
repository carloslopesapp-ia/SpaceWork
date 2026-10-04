import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { FolderItem } from "../src/shared/types";
import { registerUser } from "./auth-helpers";
import { dbWithStatementHook, fetchWithEnv } from "./db-helpers";
import { createFolder, getContents } from "./folder-helpers";
import { api, buildRequest, resetDb } from "./helpers";

beforeEach(resetDb);

/** Muda o pai de uma pasta por SQL direto (o "outro pedido" das corridas). */
async function setParent(id: string, parentId: string | null): Promise<void> {
  await env.DB.prepare("UPDATE folders SET parent_id = ?1 WHERE id = ?2").bind(parentId, id).run();
}

async function parentOf(id: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT parent_id FROM folders WHERE id = ?1")
    .bind(id)
    .first<{ parent_id: string | null }>();
  return row?.parent_id ?? null;
}

/** Pastas que voltam a si próprias ao subir pelos pais (consulta com limite, para terminar sempre). */
async function foldersInCycles(userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `WITH RECURSIVE walk(start, id, depth) AS (
       SELECT id, parent_id, 1 FROM folders WHERE user_id = ?1
       UNION ALL
       SELECT w.start, f.parent_id, w.depth + 1 FROM walk w JOIN folders f ON f.id = w.id WHERE w.depth < 50
     )
     SELECT DISTINCT start FROM walk WHERE id = start`,
  )
    .bind(userId)
    .all<{ start: string }>();
  return results.map((row) => row.start);
}

async function deleteFolderRow(id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM folders WHERE id = ?1").bind(id).run();
}

/** PATCH de pasta com `DB` em Proxy: `before` corre imediatamente antes do `UPDATE folders` do pedido. */
function patchWithRace(cookie: string, id: string, json: unknown, before: () => Promise<void>) {
  const racingDb = dbWithStatementHook(/^\s*UPDATE folders SET/, before);
  return fetchWithEnv(buildRequest(`/api/folders/${id}`, { method: "PATCH", cookie, json }), { DB: racingDb });
}

describe("PATCH /api/folders/:id: corridas entre pedidos", () => {
  it("dois movimentos opostos em paralelo (A para B e B para A): o segundo é recusado e não nasce nenhum ciclo", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B");
    // O pedido A -> B já passou na verificação rápida quando B -> A é gravado.
    const res = await patchWithRace(cookie, a.id, { parentId: b.id }, () => setParent(b.id, a.id));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_move" });
    expect(await parentOf(a.id)).toBeNull();
    expect(await parentOf(b.id)).toBe(a.id);
    expect(await foldersInCycles(user.id)).toEqual([]);
  });

  it("renomear não regrava o pai antigo: um movimento concorrente não é desfeito nem cria um ciclo", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const x = await createFolder(cookie, "X");
    const a = await createFolder(cookie, "A", x.id);
    // O instantâneo de A (pai X) já foi lido quando A vai para a raiz e X para dentro de A.
    const res = await patchWithRace(cookie, a.id, { name: "Novo" }, async () => {
      await setParent(a.id, null);
      await setParent(x.id, a.id);
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { folder: FolderItem }).folder).toMatchObject({
      id: a.id,
      name: "Novo",
      parentId: null,
    });
    expect(await parentOf(a.id)).toBeNull();
    expect(await parentOf(x.id)).toBe(a.id);
    expect(await foldersInCycles(user.id)).toEqual([]);
  });

  it("mover não regrava o nome antigo: um rename concorrente fica", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const dest = await createFolder(cookie, "Destino");
    const res = await patchWithRace(cookie, a.id, { parentId: dest.id }, async () => {
      await env.DB.prepare("UPDATE folders SET name = 'Renomeada', name_norm = 'renomeada' WHERE id = ?1")
        .bind(a.id)
        .run();
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { folder: FolderItem }).folder).toMatchObject({
      name: "Renomeada",
      parentId: dest.id,
    });
  });

  it("um ciclo já gravado não bloqueia a base: o conteúdo e um movimento para dentro dele terminam", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B");
    const c = await createFolder(cookie, "C");
    await setParent(a.id, b.id);
    await setParent(b.id, a.id); // ciclo A <-> B, inserido por SQL

    const contents = await api(`/api/folders/${a.id}/contents`, { cookie });
    expect(contents.status).toBe(200);
    expect(((await contents.json()) as { breadcrumb: unknown[] }).breadcrumb.length).toBeLessThanOrEqual(1001);

    const move = await api(`/api/folders/${c.id}`, { method: "PATCH", cookie, json: { parentId: a.id } });
    expect(move.status).toBe(400);
    // O ciclo vê-se como uma cadeia sem fim: o limite de profundidade responde antes do UPDATE.
    expect(await move.json()).toMatchObject({ error: "folder_too_deep" });
    expect((await getContents(cookie)).folders.map((f) => f.name)).toEqual(["C"]);
  });
});

describe("pasta ou destino apagados a meio do pedido: 404 em vez de 500", () => {
  it("POST /api/folders: a pasta-mãe é apagada antes do INSERT", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const parent = await createFolder(cookie, "Mãe");
    const racingDb = dbWithStatementHook(/^\s*INSERT INTO folders/, () => deleteFolderRow(parent.id));
    const res = await fetchWithEnv(
      buildRequest("/api/folders", { method: "POST", cookie, json: { name: "Filha", parentId: parent.id } }),
      { DB: racingDb },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "folder_not_found" });
  });

  it("PATCH: o destino é apagado antes do UPDATE", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const dest = await createFolder(cookie, "Destino");
    const res = await patchWithRace(cookie, a.id, { parentId: dest.id }, () => deleteFolderRow(dest.id));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "folder_not_found" });
    expect(await parentOf(a.id)).toBeNull();
  });

  it("PATCH: a própria pasta é apagada antes do UPDATE", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const res = await patchWithRace(cookie, a.id, { name: "Novo" }, () => deleteFolderRow(a.id));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "folder_not_found" });
  });
});

describe("PATCH /api/folders/:id: a guarda do UPDATE contra ciclos", () => {
  it("um ciclo gravado depois das verificações rápidas: o UPDATE termina (limite de profundidade) e recusa com invalid_move", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B");
    const destination = await createFolder(cookie, "Destino");
    const moved = await createFolder(cookie, "Movida");

    // As verificações rápidas já passaram quando o ciclo A <-> B, com o destino pendurado nele, é gravado por SQL.
    const res = await patchWithRace(cookie, moved.id, { parentId: destination.id }, async () => {
      await setParent(a.id, b.id);
      await setParent(b.id, a.id);
      await setParent(destination.id, a.id);
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_move" });
    expect(await parentOf(moved.id)).toBeNull();
  });
});
