import { env } from "cloudflare:workers";
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker";
import {
  CLEANUP_SQL,
  EXPIRED_TRASH_SQL,
  PENDING_BLOCKS,
  PENDING_MAX_AGE_MS,
  STALE_PENDING_SQL,
  TRASH_BLOCKS,
  runMaintenance,
  scheduledMaintenance,
} from "../src/worker/cron";
import { PURGE_BATCH } from "../src/worker/lib/purge";
import { insertUser } from "./auth-helpers";
import { dbFailingOn, envCountingSubrequests, silenceErrors } from "./db-helpers";
import { seedFiles } from "./file-helpers";
import { resetState } from "./helpers";

beforeEach(resetState);
afterEach(() => vi.restoreAllMocks());

const DAY = 86_400_000;
/** A hora programada das execuções destes testes. */
const NOW = 1_800_000_000_000;

const used = async (userId: string): Promise<number> =>
  (await env.DB.prepare("SELECT used_bytes AS n FROM users WHERE id = ?1").bind(userId).first<{ n: number }>())!.n;
const count = async (table: string): Promise<number> =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
const rowIds = async (table: string, column = "id"): Promise<string[]> =>
  (await env.DB.prepare(`SELECT ${column} AS v FROM ${table} ORDER BY ${column}`).all<{ v: string }>()).results.map((row) => row.v);

describe("runMaintenance: lixeira", () => {
  it("elimina o que está na lixeira há mais do que a retenção (de qualquer dono), desconta a quota e deixa o resto", async () => {
    const ana = await insertUser("ana@example.com");
    const bob = await insertUser("bob@example.com");
    await seedFiles(ana, [
      { id: "velho", size: 30, deletedAt: NOW - 31 * DAY },
      { id: "recente", size: 20, deletedAt: NOW - 29 * DAY },
      { id: "vivo", size: 5 },
    ]);
    await seedFiles(bob, [{ id: "velho-bob", size: 100, deletedAt: NOW - 40 * DAY }]);

    const report = await runMaintenance(env, NOW);

    expect(report).toMatchObject({ trashPurged: 2, errors: [] });
    expect(await rowIds("files")).toEqual(["recente", "vivo"]);
    expect((await env.FILES.list({ prefix: "u/" })).objects.map((o) => o.key.split("/")[2])).toEqual(
      expect.arrayContaining(["recente", "vivo"]),
    );
    expect((await env.FILES.list({ prefix: "u/" })).objects).toHaveLength(2);
    expect(await used(ana)).toBe(25); // 30 + 20 + 5 - 30
    expect(await used(bob)).toBe(0);
  });

  it("respeita TRASH_RETENTION_DAYS", async () => {
    const ana = await insertUser("ana@example.com");
    await seedFiles(ana, [{ id: "dois-dias", size: 10, deletedAt: NOW - 2 * DAY }]);

    expect((await runMaintenance(env, NOW)).trashPurged).toBe(0); // por defeito são 30 dias
    const report = await runMaintenance({ ...env, TRASH_RETENTION_DAYS: "1" } as unknown as Env, NOW);

    expect(report.trashPurged).toBe(1);
    expect(await count("files")).toBe(0);
  });

  it("trabalha por lotes: TRASH_BLOCKS × PURGE_BATCH por execução, e as execuções seguintes acabam o trabalho", async () => {
    const ana = await insertUser("ana@example.com");
    const total = TRASH_BLOCKS * PURGE_BATCH + 20;
    await seedFiles(
      ana,
      Array.from({ length: total }, (_unused, index) => ({ id: `f${String(index).padStart(3, "0")}`, size: 1, deletedAt: 5 + index })),
    );

    expect((await runMaintenance(env, NOW)).trashPurged).toBe(TRASH_BLOCKS * PURGE_BATCH);
    expect(await count("files")).toBe(20);
    expect((await runMaintenance(env, NOW)).trashPurged).toBe(20); // os mais velhos saem primeiro; sobraram os 20 mais recentes
    expect(await count("files")).toBe(0);
    expect(await used(ana)).toBe(0);
    expect((await runMaintenance(env, NOW)).trashPurged).toBe(0); // idempotente
  });
});

describe("runMaintenance: envios pendentes", () => {
  it("apaga os envios pendentes com mais de uma hora e devolve o espaço reservado, e deixa os recentes e os prontos", async () => {
    const ana = await insertUser("ana@example.com");
    await seedFiles(ana, [
      { id: "velho", size: 30, status: "pending", createdAt: NOW - PENDING_MAX_AGE_MS - 1 },
      { id: "novo", size: 20, status: "pending", createdAt: NOW - 1000 },
      { id: "pronto", size: 5 },
    ]);

    const report = await runMaintenance(env, NOW);

    expect(report).toMatchObject({ pendingPurged: 1, errors: [] });
    expect(await rowIds("files")).toEqual(["novo", "pronto"]);
    expect((await env.FILES.list({ prefix: "u/" })).objects).toHaveLength(2);
    expect(await used(ana)).toBe(25);
  });
});

describe("runMaintenance: limpeza", () => {
  it("limpa sessões expiradas, falhas de login com mais de um dia e partilhas revogadas ou expiradas há mais de 30 dias", async () => {
    const ana = await insertUser("ana@example.com");
    await seedFiles(ana, [{ id: "f1", size: 1 }]);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('valida', ?1, 1, ?2), ('expirada', ?1, 1, ?3)").bind(
        ana,
        NOW + DAY,
        NOW - 1,
      ),
      env.DB.prepare("INSERT INTO login_failures (email, failed_at) VALUES ('a@x', ?1), ('b@x', ?2)").bind(NOW - 2 * DAY, NOW - 1000),
      env.DB.prepare(
        `INSERT INTO shares (id, token_hash, file_id, user_id, created_at, expires_at, revoked_at) VALUES
           ('ativa', 't1', 'f1', ?1, 1, NULL, NULL),
           ('revogada-velha', 't2', 'f1', ?1, 1, NULL, ?2),
           ('revogada-nova', 't3', 'f1', ?1, 1, NULL, ?3),
           ('expirada-velha', 't4', 'f1', ?1, 1, ?2, NULL),
           ('expirada-nova', 't5', 'f1', ?1, 1, ?3, NULL)`,
      ).bind(ana, NOW - 31 * DAY, NOW - DAY),
    ]);

    const report = await runMaintenance(env, NOW);

    expect(report).toMatchObject({ sessionsDeleted: 1, loginFailuresDeleted: 1, sharesDeleted: 2, errors: [] });
    expect(await rowIds("sessions", "token_hash")).toEqual(["valida"]);
    expect(await rowIds("login_failures", "email")).toEqual(["b@x"]);
    expect(await rowIds("shares")).toEqual(["ativa", "expirada-nova", "revogada-nova"]);
  });
});

describe("runMaintenance: falhas e limites", () => {
  it("um passo que falha não impede os outros, e o gatilho falha a execução para a falha aparecer", async () => {
    const errors = silenceErrors();
    const ana = await insertUser("ana@example.com");
    await seedFiles(ana, [{ id: "velho", size: 10, status: "pending" }]);
    const broken = { ...env, DB: dbFailingOn(/FROM files WHERE deleted_at IS NOT NULL/) } as Env;

    const report = await runMaintenance(broken, NOW);

    expect(report.errors).toEqual(["lixeira: D1 em baixo"]);
    expect(report.pendingPurged).toBe(1); // o passo seguinte correu
    expect(errors).toHaveBeenCalled();
    await expect(scheduledMaintenance(broken, NOW)).rejects.toThrow(/Manutenção com erros: lixeira: D1 em baixo/);
  });

  it("no pior caso gasta 21 subpedidos, bem abaixo dos 50 do plano gratuito", async () => {
    const owners = await Promise.all(["a", "b", "c", "d"].map((name) => insertUser(`${name}@example.com`)));
    const perOwner = (TRASH_BLOCKS * PURGE_BATCH) / owners.length + 10; // mais do que cabe numa execução
    for (const [index, owner] of owners.entries()) {
      await seedFiles(
        owner,
        Array.from({ length: perOwner }, (_unused, i) => ({ id: `t${index}-${i}`, size: 1, deletedAt: 5 })),
      );
      await seedFiles(
        owner,
        Array.from({ length: (PENDING_BLOCKS * PURGE_BATCH) / owners.length + 5 }, (_unused, i) => ({ id: `p${index}-${i}`, size: 1, status: "pending" as const })),
      );
    }
    const { env: counted, count: subrequests } = envCountingSubrequests();

    const report = await runMaintenance(counted, NOW);

    expect(report).toMatchObject({ trashPurged: TRASH_BLOCKS * PURGE_BATCH, pendingPurged: PENDING_BLOCKS * PURGE_BATCH, errors: [] });
    // lixeira: 1 + 6 × 2; pendentes: 1 + 3 × 2; limpeza: 1
    expect(subrequests()).toBe(1 + TRASH_BLOCKS * 2 + (1 + PENDING_BLOCKS * 2) + 1);
    expect(subrequests()).toBeLessThanOrEqual(50);
  });
});

describe("as consultas da manutenção usam os índices", () => {
  const plan = async (sql: string, ...binds: number[]): Promise<string> =>
    (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all<{ detail: string }>()).results.map((row) => row.detail).join(" | ");

  it("nenhuma varre a tabela inteira", async () => {
    expect(await plan(EXPIRED_TRASH_SQL, 1, 1)).toMatch(/USING (COVERING )?INDEX files_trash_expiry/);
    expect(await plan(STALE_PENDING_SQL, 1, 1)).toMatch(/USING (COVERING )?INDEX files_pending_created/);
    expect(await plan(CLEANUP_SQL.sessions, 1)).toMatch(/USING (COVERING )?INDEX sessions_expires_at/);
    expect(await plan(CLEANUP_SQL.loginFailures, 1)).toMatch(/USING (COVERING )?INDEX login_failures_failed_at/);
    expect(await plan(CLEANUP_SQL.revokedShares, 1)).toMatch(/USING (COVERING )?INDEX shares_revoked_at/);
    expect(await plan(CLEANUP_SQL.expiredShares, 1)).toMatch(/USING (COVERING )?INDEX shares_expires_at/);
  });
});

describe("o gatilho do cron", () => {
  it("`scheduled` corre a manutenção à hora programada", async () => {
    const ana = await insertUser("ana@example.com");
    await seedFiles(ana, [{ id: "velho", size: 10, deletedAt: 5 }, { id: "vivo", size: 5 }]);
    const ctx = createExecutionContext();

    worker.scheduled!(createScheduledController({ scheduledTime: NOW, cron: "0 * * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(await rowIds("files")).toEqual(["vivo"]);
    expect(await used(ana)).toBe(5);
  });
});
