const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;

/** Verdadeiro com 5 ou mais falhas deste email nos últimos 15 minutos. */
export async function isLockedOut(
  db: D1Database,
  email: string,
  now: number = Date.now(),
): Promise<boolean> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM login_failures WHERE email = ?1 AND failed_at > ?2")
    .bind(email, now - WINDOW_MS)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= MAX_FAILURES;
}

export async function recordFailure(
  db: D1Database,
  email: string,
  now: number = Date.now(),
): Promise<void> {
  await db
    .prepare("INSERT INTO login_failures (email, failed_at) VALUES (?1, ?2)")
    .bind(email, now)
    .run();
}

export async function clearFailures(db: D1Database, email: string): Promise<void> {
  await db.prepare("DELETE FROM login_failures WHERE email = ?1").bind(email).run();
}
