import type { AuthUser } from "../types";
import { randomToken, sha256Hex } from "./crypto";
import { rowToAuthUser, type UserRow } from "./users";

const DAY_MS = 86_400_000;

/** Cria uma sessão. O token só existe aqui e no cookie; a D1 guarda apenas o hash. */
export async function createSession(
  db: D1Database,
  userId: string,
  ttlDays: number,
  now: number = Date.now(),
): Promise<{ token: string }> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  await db
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(tokenHash, userId, now, now + ttlDays * DAY_MS)
    .run();
  return { token };
}

/** Devolve o utilizador da sessão, ou null se o token não existir, tiver expirado ou a conta não estiver ativa. */
export async function findSession(
  db: D1Database,
  token: string,
  now: number = Date.now(),
): Promise<{ user: AuthUser; tokenHash: string } | null> {
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.role, u.status, u.quota_bytes, u.used_bytes
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?1 AND s.expires_at > ?2 AND u.status = 'active'`,
    )
    .bind(tokenHash, now)
    .first<UserRow>();
  return row ? { user: rowToAuthUser(row), tokenHash } : null;
}

export async function deleteSessionByHash(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(tokenHash).run();
}

/**
 * A instrução que apaga as sessões de um utilizador, exceto (opcionalmente) a indicada. Devolve-se a instrução, sem a executar, para
 * se juntar a outras escritas na mesma `batch` (trocar a senha, suspender ou apagar uma conta): ou ficam todas, ou nenhuma.
 */
export function deleteUserSessionsStatement(
  db: D1Database,
  userId: string,
  exceptTokenHash = "",
): D1PreparedStatement {
  return db.prepare("DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2").bind(userId, exceptTokenHash);
}
