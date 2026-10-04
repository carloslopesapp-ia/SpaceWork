/** Ficheiros eliminados de vez por chamada: o `IN (...)` tem de caber nos 100 parâmetros de uma instrução da D1. */
export const TRASH_PURGE_BATCH = 50;

/**
 * Elimina de vez ficheiros que estão na lixeira (`ids`, no máximo `TRASH_PURGE_BATCH`). Numa só `batch` desconta o tamanho
 * a `used_bytes` (nunca abaixo de 0) e apaga as linhas: só as que ainda estão na lixeira, por isso um ficheiro restaurado
 * entretanto não é tocado. O `RETURNING` diz que linhas saíram mesmo e só os objetos dessas vão para fora do R2, numa
 * só chamada. Se o R2 falhar, o objeto fica órfão (fica registado), mas a quota e a base ficam certas.
 * Devolve quantos ficheiros foram eliminados.
 */
export async function purgeTrashed(env: Pick<Env, "DB" | "FILES">, userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  if (ids.length > TRASH_PURGE_BATCH) throw new Error(`purgeTrashed: no máximo ${TRASH_PURGE_BATCH} ficheiros por chamada.`);
  const marks = ids.map((_id, index) => `?${index + 2}`).join(", ");
  const [, deleted] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET used_bytes = MAX(used_bytes - (
         SELECT COALESCE(SUM(size), 0) FROM files WHERE user_id = ?1 AND deleted_at IS NOT NULL AND id IN (${marks})
       ), 0) WHERE id = ?1`,
    ).bind(userId, ...ids),
    env.DB.prepare(
      `DELETE FROM files WHERE user_id = ?1 AND deleted_at IS NOT NULL AND id IN (${marks}) RETURNING r2_key`,
    ).bind(userId, ...ids),
  ]);
  const keys = (deleted.results as { r2_key: string }[]).map((row) => row.r2_key);
  if (keys.length > 0) {
    await env.FILES.delete(keys).catch((error) => console.error(`Objetos órfãos no R2 (${keys.length})`, error));
  }
  return keys.length;
}
