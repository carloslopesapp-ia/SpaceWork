const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000;

/**
 * Regista uma tentativa de autenticação para `email` só se ainda houver margem (menos de 5
 * tentativas nos últimos 15 minutos). É uma única instrução SQL, por isso atómica: pedidos em
 * paralelo não conseguem ultrapassar o limite. Devolve false quando o email está bloqueado.
 * As linhas ficam em `login_failures` até `clearFailures` (senha certa) ou até saírem da janela.
 */
export async function tryRecordAttempt(
  db: D1Database,
  email: string,
  now: number = Date.now(),
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO login_failures (email, failed_at)
       SELECT ?1, ?2
       WHERE (SELECT COUNT(*) FROM login_failures WHERE email = ?1 AND failed_at > ?3) < ?4`,
    )
    .bind(email, now, now - WINDOW_MS, MAX_ATTEMPTS)
    .run();
  return result.meta.changes === 1;
}

export async function clearFailures(db: D1Database, email: string): Promise<void> {
  await db.prepare("DELETE FROM login_failures WHERE email = ?1").bind(email).run();
}
