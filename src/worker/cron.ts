import { getConfig } from "./config";
import { PURGE_BATCH, purgeExpiredTrash, purgeStalePending } from "./lib/purge";

const DAY_MS = 86_400_000;

/** Um envio `pending` com mais de uma hora já não vai acabar (um upload de 100 MB demora bem menos) e a reserva é libertada. */
export const PENDING_MAX_AGE_MS = 60 * 60_000;
/** As falhas de login só contam nos últimos 15 minutos; guardam-se um dia. */
export const LOGIN_FAILURE_MAX_AGE_MS = DAY_MS;
/** Os links revogados ou expirados guardam-se 30 dias e depois saem (os de ficheiros eliminados saem logo, em cascata). */
export const SHARE_KEEP_MS = 30 * DAY_MS;

/**
 * Quanto trabalho cabe numa execução. O plano gratuito do Workers dá 50 subpedidos por invocação e cada chamada à D1 ou ao R2 conta.
 * A conta de cada passo, no pior caso:
 *   - lixeira:   1 consulta + `TRASH_BLOCKS` × 2 (uma `batch` e um `delete` do R2 por bloco) = 13;
 *   - pendentes: 1 consulta + `PENDING_BLOCKS` × 2 = 7;
 *   - limpeza:   1 `batch` com as 4 instruções = 1.
 * O que não couber fica para a hora seguinte (cada passo é idempotente e retoma onde ficou).
 */
export const TRASH_BLOCKS = 6;
export const PENDING_BLOCKS = 3;

/** As consultas que escolhem o que eliminar: usam os índices parciais da migração 0003 (um teste confirma-o com `EXPLAIN QUERY PLAN`). */
export const EXPIRED_TRASH_SQL =
  "SELECT id FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ?1 ORDER BY deleted_at LIMIT ?2";
export const STALE_PENDING_SQL =
  "SELECT id FROM files WHERE status = 'pending' AND created_at < ?1 ORDER BY created_at LIMIT ?2";
export const CLEANUP_SQL = {
  sessions: "DELETE FROM sessions WHERE expires_at < ?1",
  loginFailures: "DELETE FROM login_failures WHERE failed_at < ?1",
  revokedShares: "DELETE FROM shares WHERE revoked_at IS NOT NULL AND revoked_at < ?1",
  expiredShares: "DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at < ?1",
} as const;

/** O que uma execução fez; `errors` tem os passos que falharam (os outros correram na mesma). */
export interface MaintenanceReport {
  trashPurged: number;
  pendingPurged: number;
  sessionsDeleted: number;
  loginFailuresDeleted: number;
  sharesDeleted: number;
  errors: string[];
}

async function selectIds(db: D1Database, sql: string, cutoff: number, limit: number): Promise<string[]> {
  const { results } = await db.prepare(sql).bind(cutoff, limit).all<{ id: string }>();
  return results.map((row) => row.id);
}

/** Elimina `ids` por blocos de `PURGE_BATCH`, um bloco de cada vez (cada bloco são 2 subpedidos). */
async function purgeInBlocks(ids: string[], purge: (block: string[]) => Promise<number>): Promise<number> {
  let purged = 0;
  for (let start = 0; start < ids.length; start += PURGE_BATCH) {
    purged += await purge(ids.slice(start, start + PURGE_BATCH));
  }
  return purged;
}

/**
 * A manutenção por hora (spec, secção 7). Cada passo é idempotente, trabalha em lotes limitados (ver `TRASH_BLOCKS`) e falha sozinho:
 * se um passo lança, os outros correm na mesma e o erro fica em `report.errors`. `now` é o instante da execução (os testes fixam-no).
 */
export async function runMaintenance(env: Env, now: number = Date.now()): Promise<MaintenanceReport> {
  const report: MaintenanceReport = {
    trashPurged: 0,
    pendingPurged: 0,
    sessionsDeleted: 0,
    loginFailuresDeleted: 0,
    sharesDeleted: 0,
    errors: [],
  };

  async function step(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      console.error(`Manutenção: o passo «${name}» falhou`, error);
      report.errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await step("lixeira", async () => {
    const cutoff = now - getConfig(env).trashRetentionDays * DAY_MS;
    const ids = await selectIds(env.DB, EXPIRED_TRASH_SQL, cutoff, TRASH_BLOCKS * PURGE_BATCH);
    report.trashPurged = await purgeInBlocks(ids, (block) => purgeExpiredTrash(env, block));
  });

  await step("envios pendentes", async () => {
    const ids = await selectIds(env.DB, STALE_PENDING_SQL, now - PENDING_MAX_AGE_MS, PENDING_BLOCKS * PURGE_BATCH);
    report.pendingPurged = await purgeInBlocks(ids, (block) => purgeStalePending(env, block));
  });

  await step("limpeza", async () => {
    const [sessions, loginFailures, revokedShares, expiredShares] = await env.DB.batch([
      env.DB.prepare(CLEANUP_SQL.sessions).bind(now),
      env.DB.prepare(CLEANUP_SQL.loginFailures).bind(now - LOGIN_FAILURE_MAX_AGE_MS),
      env.DB.prepare(CLEANUP_SQL.revokedShares).bind(now - SHARE_KEEP_MS),
      env.DB.prepare(CLEANUP_SQL.expiredShares).bind(now - SHARE_KEEP_MS),
    ]);
    report.sessionsDeleted = sessions.meta.changes;
    report.loginFailuresDeleted = loginFailures.meta.changes;
    report.sharesDeleted = revokedShares.meta.changes + expiredShares.meta.changes;
  });

  return report;
}

/** O que o gatilho do cron corre: a manutenção, e falha a execução (para aparecer no painel da Cloudflare) se algum passo falhou. */
export async function scheduledMaintenance(env: Env, now: number = Date.now()): Promise<MaintenanceReport> {
  const report = await runMaintenance(env, now);
  if (report.errors.length > 0) throw new Error(`Manutenção com erros: ${report.errors.join("; ")}`);
  return report;
}
