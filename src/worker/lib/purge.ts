/** Ficheiros eliminados por chamada: o `IN (...)` e o dono têm de caber nos 100 parâmetros de uma instrução da D1. */
export const PURGE_BATCH = 50;

/** Que linhas de `files` se podem eliminar: as que estão na lixeira, ou os envios que nunca chegaram ao fim. */
const KIND_CONDITION = {
  trashed: "deleted_at IS NOT NULL",
  pending: "status = 'pending'",
} as const;

type PurgeKind = keyof typeof KIND_CONDITION;

/**
 * Elimina de vez as linhas de `files` de `ids` (no máximo `PURGE_BATCH`) que são do tipo `kind`, de `ownerId` ou, com `null`, de
 * qualquer dono. Numa só `batch` desconta a quota (o tamanho de cada dono, nunca abaixo de 0) e apaga as linhas. As duas instruções
 * têm a mesma condição, por isso só contam as linhas que ainda são do tipo certo: um ficheiro restaurado, ou um envio que acabou,
 * entretanto não é tocado. O `RETURNING` diz que linhas saíram mesmo e só os objetos dessas vão para fora do R2, numa só chamada.
 * Se o R2 falhar, o objeto fica órfão: as chaves ficam registadas no log, mas a quota e a base ficam certas.
 * Devolve quantos ficheiros foram eliminados.
 */
async function purgeFiles(
  env: Pick<Env, "DB" | "FILES">,
  ids: string[],
  kind: PurgeKind,
  ownerId: string | null,
): Promise<number> {
  if (ids.length === 0) return 0;
  if (ids.length > PURGE_BATCH) throw new Error(`purgeFiles: no máximo ${PURGE_BATCH} ficheiros por chamada.`);
  const marks = ids.map((_id, index) => `?${index + 1}`).join(", ");
  const owner = `?${ids.length + 1}`;
  const where = `${KIND_CONDITION[kind]} AND id IN (${marks}) AND (${owner} IS NULL OR user_id = ${owner})`;
  const [, deleted] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET used_bytes = MAX(used_bytes - (
         SELECT COALESCE(SUM(size), 0) FROM files WHERE files.user_id = users.id AND ${where}
       ), 0) WHERE id IN (SELECT user_id FROM files WHERE ${where})`,
    ).bind(...ids, ownerId),
    env.DB.prepare(`DELETE FROM files WHERE ${where} RETURNING r2_key`).bind(...ids, ownerId),
  ]);
  const keys = (deleted.results as { r2_key: string }[]).map((row) => row.r2_key);
  if (keys.length > 0) {
    await env.FILES.delete(keys).catch((error) => console.error(`Objetos órfãos no R2 (${keys.length}): ${keys.join(", ")}`, error));
  }
  return keys.length;
}

/** Elimina de vez ficheiros que estão na lixeira de um utilizador (`ids`, no máximo `PURGE_BATCH`). */
export function purgeTrashed(env: Pick<Env, "DB" | "FILES">, userId: string, ids: string[]): Promise<number> {
  return purgeFiles(env, ids, "trashed", userId);
}

/** Para a manutenção: elimina de vez ficheiros que estão na lixeira, sejam de quem forem (`ids`, no máximo `PURGE_BATCH`). */
export function purgeExpiredTrash(env: Pick<Env, "DB" | "FILES">, ids: string[]): Promise<number> {
  return purgeFiles(env, ids, "trashed", null);
}

/** Para a manutenção: apaga envios que nunca chegaram ao fim (`pending`), de quem forem, e devolve o espaço que reservaram. */
export function purgeStalePending(env: Pick<Env, "DB" | "FILES">, ids: string[]): Promise<number> {
  return purgeFiles(env, ids, "pending", null);
}
