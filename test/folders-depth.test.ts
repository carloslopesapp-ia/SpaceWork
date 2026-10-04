import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { registerUser } from "./auth-helpers";
import { createFolder } from "./folder-helpers";
import { api, resetDb } from "./helpers";

beforeEach(resetDb);

/** Cria `depth` pastas encadeadas (a 1.ª na raiz) diretamente na D1, que é bem mais rápido do que pela API. */
async function insertChain(userId: string, prefix: string, depth: number, parentId: string | null = null) {
  const ids: string[] = [];
  let parent = parentId;
  const statements = [];
  for (let level = 1; level <= depth; level++) {
    const id = `${prefix}-${level}`;
    statements.push(
      env.DB.prepare(
        "INSERT INTO folders (id, user_id, parent_id, name, name_norm, created_at) VALUES (?1, ?2, ?3, ?4, ?4, 0)",
      ).bind(id, userId, parent, id),
    );
    ids.push(id);
    parent = id;
  }
  await env.DB.batch(statements);
  return ids;
}

const post = (cookie: string, name: string, parentId: string | null) =>
  api("/api/folders", { method: "POST", cookie, json: { name, parentId } });
const patch = (cookie: string, id: string, json: unknown) =>
  api(`/api/folders/${id}`, { method: "PATCH", cookie, json });

describe("profundidade máxima das pastas (100 níveis)", () => {
  it("deixa criar até ao nível 100 e recusa o 101", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const chain = await insertChain(user.id, "n", 99);
    expect((await post(cookie, "nivel-100", chain[98])).status).toBe(201);

    const tooDeep = await insertChain(user.id, "m", 100);
    const res = await post(cookie, "nivel-101", tooDeep[99]);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "folder_too_deep",
      message: expect.stringContaining("100"),
    });
  });

  it("ao mover conta a profundidade da pasta com tudo o que tem dentro", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const chain = await insertChain(user.id, "n", 98); // a última está no nível 98
    const moved = await createFolder(cookie, "movida");
    const child = await createFolder(cookie, "filha", moved.id);
    await createFolder(cookie, "neta", child.id); // a pasta movida tem 3 níveis

    // por baixo do nível 98 ficariam nos níveis 99, 100 e 101: não cabe
    const res = await patch(cookie, moved.id, { parentId: chain[97] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "folder_too_deep" });
    // por baixo do nível 97 ficam nos níveis 98, 99 e 100: cabe
    expect((await patch(cookie, moved.id, { parentId: chain[96] })).status).toBe(200);
  });

  it("mover para a raiz nunca é recusado por causa da profundidade", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const chain = await insertChain(user.id, "n", 100);
    expect((await patch(cookie, chain[99], { parentId: null })).status).toBe(200);
  });
});
