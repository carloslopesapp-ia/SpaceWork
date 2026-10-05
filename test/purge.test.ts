import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PURGE_BATCH, purgeExpiredTrash, purgeStalePending, purgeTrashed } from "../src/worker/lib/purge";
import { registerUser } from "./auth-helpers";
import { dbCountingPrepares, dbWithBatchHook, silenceErrors } from "./db-helpers";
import { seedFiles } from "./file-helpers";
import { resetState } from "./helpers";

beforeEach(resetState);
afterEach(() => vi.restoreAllMocks());

const used = async (userId: string): Promise<number> =>
  (await env.DB.prepare("SELECT used_bytes AS n FROM users WHERE id = ?1").bind(userId).first<{ n: number }>())!.n;
const rowExists = async (id: string): Promise<boolean> =>
  (await env.DB.prepare("SELECT 1 AS n FROM files WHERE id = ?1").bind(id).first()) !== null;
const objectExists = async (userId: string, id: string): Promise<boolean> =>
  (await env.FILES.head(`u/${userId}/${id}`)) !== null;

describe("purgeExpiredTrash (de qualquer dono)", () => {
  it("elimina ficheiros de vários donos numa só chamada e desconta a quota de cada um", async () => {
    const ana = (await registerUser("ana@example.com")).user;
    const bob = (await registerUser("bob@example.com")).user;
    const eva = (await registerUser("eva@example.com")).user;
    await seedFiles(ana.id, [{ id: "a1", size: 30, deletedAt: 5 }, { id: "a2", size: 20, deletedAt: 5 }, { id: "a3", size: 7 }]);
    await seedFiles(bob.id, [{ id: "b1", size: 100, deletedAt: 5 }]);
    await seedFiles(eva.id, [{ id: "e1", size: 40, deletedAt: 5 }]);

    const purged = await purgeExpiredTrash(env, ["a1", "a2", "b1"]);

    expect(purged).toBe(3);
    expect(await Promise.all(["a1", "a2", "b1"].map(rowExists))).toEqual([false, false, false]);
    expect(await objectExists(ana.id, "a1")).toBe(false);
    expect(await objectExists(bob.id, "b1")).toBe(false);
    expect(await used(ana.id)).toBe(7); // 30 + 20 + 7 - 50
    expect(await used(bob.id)).toBe(0);
    expect(await used(eva.id)).toBe(40); // não estava na lista
    expect(await rowExists("e1")).toBe(true);
  });

  it("não toca no que já não está na lixeira (um ficheiro restaurado, ou que nunca lá esteve) nem na sua quota", async () => {
    const ana = (await registerUser("ana@example.com")).user;
    await seedFiles(ana.id, [{ id: "a1", size: 30 }, { id: "a2", size: 20, deletedAt: 5 }]);

    expect(await purgeExpiredTrash(env, ["a1", "a2"])).toBe(1);

    expect(await rowExists("a1")).toBe(true);
    expect(await objectExists(ana.id, "a1")).toBe(true);
    expect(await used(ana.id)).toBe(30);
  });

  it("uma lista que não corresponde a nada não escreve em `users` (nenhuma linha alterada)", async () => {
    const ana = (await registerUser("ana@example.com")).user;
    await seedFiles(ana.id, [{ id: "a1", size: 30 }]);
    let changes: number[] = [];
    const db = dbWithBatchHook(async (_call, runReal) => {
      const results = await runReal();
      changes = results.map((result) => result.meta.changes);
      return results;
    });

    expect(await purgeExpiredTrash({ DB: db, FILES: env.FILES }, ["a1", "inexistente"])).toBe(0);

    expect(changes).toEqual([0, 0]);
  });

  it("a quota nunca fica abaixo de zero", async () => {
    const ana = (await registerUser("ana@example.com")).user;
    await seedFiles(ana.id, [{ id: "a1", size: 30, deletedAt: 5 }]);
    await env.DB.prepare("UPDATE users SET used_bytes = 10 WHERE id = ?1").bind(ana.id).run();

    await purgeExpiredTrash(env, ["a1"]);

    expect(await used(ana.id)).toBe(0);
  });

  it("se o R2 falha, regista as chaves, mas a base e a quota ficam certas", async () => {
    const ana = (await registerUser("ana@example.com")).user;
    await seedFiles(ana.id, [{ id: "a1", size: 30, deletedAt: 5 }]);
    const errors = silenceErrors();
    const brokenR2 = { delete: async () => Promise.reject(new Error("R2 em baixo")) } as unknown as R2Bucket;

    expect(await purgeExpiredTrash({ DB: env.DB, FILES: brokenR2 }, ["a1"])).toBe(1);

    expect(await rowExists("a1")).toBe(false);
    expect(await used(ana.id)).toBe(0);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining(`u/${ana.id}/a1`), expect.any(Error));
  });

  it("recusa mais de PURGE_BATCH ficheiros por chamada e uma lista vazia não toca na base", async () => {
    await expect(purgeExpiredTrash(env, Array.from({ length: PURGE_BATCH + 1 }, (_unused, i) => `x${i}`))).rejects.toThrow(
      /no máximo 50/,
    );
    const { db, sql } = dbCountingPrepares();
    expect(await purgeExpiredTrash({ DB: db, FILES: env.FILES }, [])).toBe(0);
    expect(sql).toEqual([]);
  });

  it("aceita exatamente PURGE_BATCH ficheiros", async () => {
    const ana = (await registerUser("ana@example.com")).user;
    const files = Array.from({ length: PURGE_BATCH }, (_unused, i) => ({ id: `f${i}`, size: 1, deletedAt: 5 }));
    await seedFiles(ana.id, files);

    expect(await purgeExpiredTrash(env, files.map((file) => file.id))).toBe(PURGE_BATCH);
    expect(await used(ana.id)).toBe(0);
  });
});

describe("purgeTrashed (de um utilizador)", () => {
  it("só toca nos ficheiros do dono indicado", async () => {
    const ana = (await registerUser("ana@example.com")).user;
    const bob = (await registerUser("bob@example.com")).user;
    await seedFiles(ana.id, [{ id: "a1", size: 30, deletedAt: 5 }]);
    await seedFiles(bob.id, [{ id: "b1", size: 20, deletedAt: 5 }]);

    expect(await purgeTrashed(env, bob.id, ["a1", "b1"])).toBe(1);

    expect(await rowExists("a1")).toBe(true);
    expect(await objectExists(ana.id, "a1")).toBe(true);
    expect(await used(ana.id)).toBe(30);
    expect(await rowExists("b1")).toBe(false);
    expect(await used(bob.id)).toBe(0);
  });
});

describe("purgeStalePending", () => {
  it("apaga só os envios pendentes e devolve o espaço que tinham reservado", async () => {
    const ana = (await registerUser("ana@example.com")).user;
    const bob = (await registerUser("bob@example.com")).user;
    await seedFiles(ana.id, [
      { id: "a1", size: 30, status: "pending" },
      { id: "a2", size: 5 }, // pronto: fica
      { id: "a3", size: 9, deletedAt: 5 }, // na lixeira: fica
    ]);
    await seedFiles(bob.id, [{ id: "b1", size: 11, status: "pending" }]);

    expect(await purgeStalePending(env, ["a1", "a2", "a3", "b1"])).toBe(2);

    expect(await Promise.all(["a1", "b1"].map(rowExists))).toEqual([false, false]);
    expect(await Promise.all(["a2", "a3"].map(rowExists))).toEqual([true, true]);
    expect(await objectExists(ana.id, "a1")).toBe(false);
    expect(await used(ana.id)).toBe(14); // 30 + 5 + 9 - 30
    expect(await used(bob.id)).toBe(0);
  });
});
