/** Contas em remoção tratadas por execução. */
export const ACCOUNTS_PER_RUN = 2;
/** Chaves por página do R2 (o máximo que um `delete` aceita). */
export const R2_PAGE = 1000;
/** Páginas do R2 varridas por conta e por execução: cada uma são 2 subpedidos (um `list` e um `delete`). */
export const SWEEP_PAGES = 2;

/** Usa o índice parcial `users_deleting` (migração 0003). */
export const DELETING_ACCOUNTS_SQL = "SELECT id FROM users WHERE status = 'deleting' ORDER BY created_at LIMIT ?1";

/**
 * Apaga os objetos de `u/<userId>/` do R2, até `SWEEP_PAGES` páginas. Varre-se o prefixo e não as linhas de `files`: assim também saem os
 * objetos órfãos (de uma libertação de reserva que falhou) e o que as linhas já não dizem. Devolve quantos apagou e se o prefixo ficou vazio.
 */
async function sweepObjects(env: Pick<Env, "FILES">, userId: string): Promise<{ deleted: number; empty: boolean }> {
  let deleted = 0;
  for (let page = 0; page < SWEEP_PAGES; page++) {
    const listing = await env.FILES.list({ prefix: `u/${userId}/`, limit: R2_PAGE });
    if (listing.objects.length > 0) {
      await env.FILES.delete(listing.objects.map((object) => object.key));
      deleted += listing.objects.length;
    }
    if (!listing.truncated) return { deleted, empty: true };
  }
  return { deleted, empty: false };
}

/** Só alcança contas em remoção: se um id de uma conta ativa chegasse aqui por engano, nada se apagava. */
const OWNED_BY_DELETING = "user_id IN (SELECT id FROM users WHERE id = ?1 AND status = 'deleting')";

/**
 * Apaga as linhas de uma conta em remoção numa só `batch`, filhos primeiro por causa das chaves estrangeiras: partilhas, ficheiros, pastas
 * (num só `DELETE`, que a D1 verifica no fim da instrução, por isso uma pasta e as suas subpastas saem juntas), sessões e, por fim, o utilizador.
 * Devolve se o utilizador foi apagado.
 */
export async function removeAccountRows(db: D1Database, userId: string): Promise<boolean> {
  const results = await db.batch([
    db.prepare(`DELETE FROM shares WHERE ${OWNED_BY_DELETING}`).bind(userId),
    db.prepare(`DELETE FROM files WHERE ${OWNED_BY_DELETING}`).bind(userId),
    db.prepare(`DELETE FROM folders WHERE ${OWNED_BY_DELETING}`).bind(userId),
    db.prepare(`DELETE FROM sessions WHERE ${OWNED_BY_DELETING}`).bind(userId),
    db.prepare("DELETE FROM users WHERE id = ?1 AND status = 'deleting'").bind(userId),
  ]);
  return results[4].meta.changes === 1;
}

export interface AccountRemovalReport {
  accountsRemoved: number;
  objectsDeleted: number;
}

/**
 * Remove as contas em `deleting` (o admin apagou-as pela API; a remoção real é daqui). Por conta: primeiro os objetos do R2 e só depois as
 * linhas da D1: se as linhas saíssem primeiro e o R2 falhasse, os objetos ficavam sem dono para sempre. Uma conta grande leva várias
 * execuções (`SWEEP_PAGES` páginas por execução); só quando o prefixo fica vazio saem as linhas e o utilizador, e o email fica livre.
 * Custo no pior caso: 1 consulta + `ACCOUNTS_PER_RUN` × (`SWEEP_PAGES` × 2 + 1) = 11 subpedidos.
 */
export async function removeDeletingAccounts(env: Pick<Env, "DB" | "FILES">): Promise<AccountRemovalReport> {
  const report: AccountRemovalReport = { accountsRemoved: 0, objectsDeleted: 0 };
  const { results } = await env.DB.prepare(DELETING_ACCOUNTS_SQL).bind(ACCOUNTS_PER_RUN).all<{ id: string }>();
  for (const { id } of results) {
    const swept = await sweepObjects(env, id);
    report.objectsDeleted += swept.deleted;
    if (swept.empty && (await removeAccountRows(env.DB, id))) report.accountsRemoved++;
  }
  return report;
}
