import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNTS_PER_RUN, DELETING_ACCOUNTS_SQL, R2_PAGE, SWEEP_PAGES, removeAccountRows } from "../src/worker/lib/account-removal";
import { runMaintenance } from "../src/worker/cron";
import { insertUser } from "./auth-helpers";
import { envCountingSubrequests, silenceErrors } from "./db-helpers";
import { seedFiles } from "./file-helpers";
import { api, resetState } from "./helpers";

beforeEach(resetState);
afterEach(() => vi.restoreAllMocks());

const NOW = 1_800_000_000_000;

const exists = async (table: string, column: string, value: string): Promise<boolean> =>
  (await env.DB.prepare(`SELECT 1 AS n FROM ${table} WHERE ${column} = ?1`).bind(value).first()) !== null;
const objectsOf = async (userId: string): Promise<number> => (await env.FILES.list({ prefix: `u/${userId}/` })).objects.length;

/** Uma conta com ficheiros (um deles na lixeira há pouco), pastas aninhadas, uma partilha, uma sessão e um objeto órfão no R2 (sem linha). */
async function populate(userId: string, label: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO folders (id, user_id, parent_id, name, name_norm, created_at) VALUES (?1, ?2, NULL, 'pai', 'pai', 1)").bind(`${label}-pai`, userId),
    env.DB.prepare("INSERT INTO folders (id, user_id, parent_id, name, name_norm, created_at) VALUES (?1, ?2, ?3, 'filha', 'filha', 1)").bind(`${label}-filha`, userId, `${label}-pai`),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, 1, ?3)").bind(`${label}-sessao`, userId, NOW + 1000),
  ]);
  await seedFiles(userId, [{ id: `${label}-f1`, size: 10 }, { id: `${label}-f2`, size: 20, deletedAt: NOW - 1000 }]);
  await env.DB.batch([
    env.DB.prepare("UPDATE files SET folder_id = ?1 WHERE id = ?2").bind(`${label}-filha`, `${label}-f1`),
    env.DB.prepare("INSERT INTO shares (id, token_hash, file_id, user_id, created_at) VALUES (?1, ?2, ?3, ?4, 1)").bind(`${label}-share`, `${label}-tok`, `${label}-f1`, userId),
  ]);
  await env.FILES.put(`u/${userId}/${label}-orfao`, "sem linha");
}

describe("contas em remoção (manutenção)", () => {
  it("apaga o R2 (órfãos incluídos), as linhas e o utilizador de uma conta em remoção, e não toca nas outras", async () => {
    const ana = await insertUser("ana@example.com");
    const bob = await insertUser("bob@example.com", { status: "deleting" });
    const carla = await insertUser("carla@example.com", { status: "suspended" });
    await populate(ana, "ana");
    await populate(bob, "bob");
    await populate(carla, "carla");

    const report = await runMaintenance(env, NOW);

    expect(report).toMatchObject({ accountsRemoved: 1, accountObjectsDeleted: 3, errors: [] });
    expect(await exists("users", "id", bob)).toBe(false);
    for (const [table, column, value] of [
      ["files", "id", "bob-f1"],
      ["folders", "id", "bob-pai"],
      ["folders", "id", "bob-filha"],
      ["sessions", "token_hash", "bob-sessao"],
      ["shares", "id", "bob-share"],
    ] as const) {
      expect(await exists(table, column, value), `${table} ${value}`).toBe(false);
    }
    expect(await objectsOf(bob)).toBe(0);
    // as outras contas ficam como estavam
    for (const [owner, label] of [[ana, "ana"], [carla, "carla"]] as const) {
      expect(await exists("users", "id", owner)).toBe(true);
      expect(await exists("files", "id", `${label}-f1`)).toBe(true);
      expect(await exists("shares", "id", `${label}-share`)).toBe(true);
      expect(await exists("sessions", "token_hash", `${label}-sessao`)).toBe(true);
      expect(await objectsOf(owner)).toBe(3);
    }
  });

  it("depois da remoção o email fica livre para um registo novo", async () => {
    await insertUser("bob@example.com", { status: "deleting" });
    const register = () => api("/api/auth/register", { method: "POST", json: { email: "bob@example.com", password: "senha-segura-123" } });
    expect((await register()).status).toBe(409); // enquanto a conta existe, o email está ocupado

    await runMaintenance(env, NOW);

    expect((await register()).status).toBe(201);
  });

  it("uma conta grande leva várias execuções: só quando o R2 fica vazio saem as linhas e o utilizador", async () => {
    const bob = await insertUser("bob@example.com", { status: "deleting" });
    await seedFiles(bob, [{ id: "f1", size: 1 }]);
    const extra = SWEEP_PAGES * R2_PAGE + 100 - 1; // com o objeto do `f1`, mais 100 do que cabe numa execução
    for (let start = 0; start < extra; start += 500) {
      await Promise.all(
        Array.from({ length: Math.min(500, extra - start) }, (_unused, i) => env.FILES.put(`u/${bob}/x${start + i}`, "x")),
      );
    }

    const first = await runMaintenance(env, NOW);

    expect(first).toMatchObject({ accountsRemoved: 0, accountObjectsDeleted: SWEEP_PAGES * R2_PAGE });
    expect(await exists("users", "id", bob)).toBe(true); // ainda em remoção, com as linhas
    expect(await exists("files", "id", "f1")).toBe(true);
    expect(await objectsOf(bob)).toBe(100);

    const second = await runMaintenance(env, NOW);

    expect(second).toMatchObject({ accountsRemoved: 1, accountObjectsDeleted: 100 });
    expect(await exists("users", "id", bob)).toBe(false);
    expect(await objectsOf(bob)).toBe(0);
  });

  it("se o R2 falha, a conta continua em remoção com tudo (nada se perde) e a execução seguinte retoma", async () => {
    const errors = silenceErrors();
    const bob = await insertUser("bob@example.com", { status: "deleting" });
    await seedFiles(bob, [{ id: "f1", size: 1 }]);
    const brokenR2 = { list: async () => Promise.reject(new Error("R2 em baixo")) } as unknown as R2Bucket;

    const report = await runMaintenance({ ...env, FILES: brokenR2 } as Env, NOW);

    expect(report.errors).toEqual(["contas em remoção: R2 em baixo"]);
    expect(errors).toHaveBeenCalled();
    expect(await exists("users", "id", bob)).toBe(true);
    expect(await exists("files", "id", "f1")).toBe(true);
    expect(await objectsOf(bob)).toBe(1);

    expect((await runMaintenance(env, NOW)).accountsRemoved).toBe(1);
  });

  it("trata no máximo ACCOUNTS_PER_RUN contas por execução, as mais antigas primeiro", async () => {
    const ids = [];
    for (let index = 0; index < ACCOUNTS_PER_RUN + 1; index++) {
      ids.push(await insertUser(`u${index}@example.com`, { status: "deleting", createdAt: 10 + index }));
    }

    expect((await runMaintenance(env, NOW)).accountsRemoved).toBe(ACCOUNTS_PER_RUN);
    expect(await exists("users", "id", ids[ACCOUNTS_PER_RUN])).toBe(true); // a mais recente espera pela hora seguinte
    expect((await runMaintenance(env, NOW)).accountsRemoved).toBe(1);
  });

  it("removeAccountRows só alcança contas em remoção (a guarda protege uma conta ativa)", async () => {
    const ana = await insertUser("ana@example.com");
    await populate(ana, "ana");

    expect(await removeAccountRows(env.DB, ana)).toBe(false);

    expect(await exists("users", "id", ana)).toBe(true);
    expect(await exists("files", "id", "ana-f1")).toBe(true);
    expect(await exists("folders", "id", "ana-pai")).toBe(true);
    expect(await exists("shares", "id", "ana-share")).toBe(true);
    expect(await exists("sessions", "token_hash", "ana-sessao")).toBe(true);
  });

  it("a consulta das contas em remoção usa o índice parcial", async () => {
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${DELETING_ACCOUNTS_SQL}`).bind(2).all<{ detail: string }>();
    expect(results.map((row) => row.detail).join(" | ")).toMatch(/USING (COVERING )?INDEX users_deleting/);
  });

  it("no pior caso (contas grandes, a acabar) a execução inteira gasta 32 subpedidos, abaixo dos 50 do plano gratuito", async () => {
    for (let index = 0; index < ACCOUNTS_PER_RUN + 1; index++) {
      await insertUser(`u${index}@example.com`, { status: "deleting", createdAt: 10 + index });
    }
    await seedFiles(await insertUser("t@example.com"), Array.from({ length: 330 }, (_unused, i) => ({ id: `t${i}`, size: 1, deletedAt: 5 })));
    await seedFiles(await insertUser("p@example.com"), Array.from({ length: 170 }, (_unused, i) => ({ id: `p${i}`, size: 1, status: "pending" as const })));
    // R2 de mentira: cada conta tem 1000 chaves na 1.ª página (com mais a seguir) e outras 1000 na 2.ª (a última); conta-se à parte.
    const calls = { r2: 0 };
    const pagesOf = new Map<string, number>();
    const fakeR2 = {
      list: async ({ prefix }: { prefix: string }) => {
        calls.r2++;
        const page = (pagesOf.get(prefix) ?? 0) + 1;
        pagesOf.set(prefix, page);
        return { objects: Array.from({ length: R2_PAGE }, (_unused, i) => ({ key: `${prefix}${i}` })), truncated: page < SWEEP_PAGES };
      },
      delete: async () => {
        calls.r2++;
      },
    } as unknown as R2Bucket;
    const { env: counted, count } = envCountingSubrequests();

    const report = await runMaintenance({ ...counted, FILES: fakeR2 } as Env, NOW);

    expect(report).toMatchObject({ trashPurged: 300, pendingPurged: 150, accountsRemoved: ACCOUNTS_PER_RUN, errors: [] });
    // lixeira 1 + 6 × 2; pendentes 1 + 3 × 2; contas 1 + 2 × (2 páginas × 2 + a batch das linhas); limpeza 1
    const total = count() + calls.r2;
    expect(total).toBe(13 + 7 + (1 + ACCOUNTS_PER_RUN * (SWEEP_PAGES * 2 + 1)) + 1);
    expect(total).toBeLessThanOrEqual(50);
  });
});
