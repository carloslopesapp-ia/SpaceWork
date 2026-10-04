import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { pathsForFolders, trailOf } from "../src/worker/lib/paths";
import { registerUser } from "./auth-helpers";
import { dbCountingPrepares } from "./db-helpers";
import { createFolder } from "./folder-helpers";
import { resetDb } from "./helpers";

beforeEach(resetDb);

describe("pathsForFolders", () => {
  it("devolve o caminho da raiz até cada pasta, numa só consulta", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B", a.id);
    const c = await createFolder(cookie, "C", b.id);
    const d = await createFolder(cookie, "D");

    const { db, sql } = dbCountingPrepares();
    const paths = await pathsForFolders(db, user.id, [c.id, d.id, b.id, c.id]);

    expect(paths.get(c.id)).toEqual([
      { id: a.id, name: "A" },
      { id: b.id, name: "B" },
      { id: c.id, name: "C" },
    ]);
    expect(paths.get(d.id)).toEqual([{ id: d.id, name: "D" }]);
    expect(paths.get(b.id)).toHaveLength(2);
    expect(sql).toHaveLength(1);
  });

  it("não devolve pastas de outro utilizador nem ids desconhecidos", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const daAna = await createFolder(ana.cookie, "Da Ana");

    const paths = await pathsForFolders(env.DB, bob.user.id, [daAna.id, "nao-existe"]);

    expect(paths.size).toBe(0);
  });

  it("sem pastas não consulta a base", async () => {
    const { user } = await registerUser("ana@example.com");
    const { db, sql } = dbCountingPrepares();
    expect((await pathsForFolders(db, user.id, [])).size).toBe(0);
    expect(sql).toHaveLength(0);
  });

  it("divide em blocos de 50 pastas: 120 pastas fazem 3 consultas", async () => {
    const { user } = await registerUser("ana@example.com");
    const ids = Array.from({ length: 120 }, (_unused, index) => `pasta-${index}`);
    await env.DB.batch(
      ids.map((id) =>
        env.DB.prepare(
          "INSERT INTO folders (id, user_id, parent_id, name, name_norm, created_at) VALUES (?1, ?2, NULL, ?1, ?1, 0)",
        ).bind(id, user.id),
      ),
    );

    const { db, sql } = dbCountingPrepares();
    const paths = await pathsForFolders(db, user.id, ids);

    expect(paths.size).toBe(120);
    expect(sql).toHaveLength(3);
  });

  it("termina mesmo com um ciclo gravado na base (limite de profundidade)", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B");
    await env.DB.batch([
      env.DB.prepare("UPDATE folders SET parent_id = ?1 WHERE id = ?2").bind(b.id, a.id),
      env.DB.prepare("UPDATE folders SET parent_id = ?1 WHERE id = ?2").bind(a.id, b.id),
    ]);

    const paths = await pathsForFolders(env.DB, user.id, [a.id]);

    expect(paths.get(a.id)!.length).toBeLessThanOrEqual(1001);
  });
});

describe("trailOf", () => {
  it("a raiz e as pastas desconhecidas têm caminho vazio", () => {
    const paths = new Map([["f1", [{ id: "f1", name: "Fotos" }]]]);
    expect(trailOf(paths, null)).toEqual([]);
    expect(trailOf(paths, "outra")).toEqual([]);
    expect(trailOf(paths, "f1")).toEqual([{ id: "f1", name: "Fotos" }]);
  });
});
