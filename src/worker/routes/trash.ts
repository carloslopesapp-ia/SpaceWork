import { searchKey } from "../../shared/names";
import type { FileItem, TrashContents, TrashItem } from "../../shared/types";
import { getConfig } from "../config";
import { ApiError, isUniqueViolation } from "../errors";
import { FILE_COLUMNS, fileNameTaken, rowToFile, type FileRow } from "../lib/files";
import { pathsForFolders, trailOf } from "../lib/paths";
import { restoreCandidates } from "../lib/restore-names";
import { PURGE_BATCH, purgeTrashed } from "../lib/purge";
import { createAuthedRouter } from "./authed";

export const trash = createAuthedRouter();

const DAY_MS = 86_400_000;
/** Itens que a lixeira lista de cada vez (os mais recentes); `total` conta todos. */
const TRASH_LIST_LIMIT = 200;

async function countTrashed(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM files WHERE user_id = ?1 AND status = 'ready' AND deleted_at IS NOT NULL")
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Os ficheiros excluídos, do mais recente para o mais antigo, com a pasta onde estavam e quando o cron os elimina de vez. */
trash.get("/", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const retentionDays = getConfig(c.env).trashRetentionDays;

  const [{ results: rows }, total] = await Promise.all([
    db
      .prepare(
        `SELECT ${FILE_COLUMNS}, deleted_at FROM files
         WHERE user_id = ?1 AND status = 'ready' AND deleted_at IS NOT NULL
         ORDER BY deleted_at DESC, id LIMIT ${TRASH_LIST_LIMIT}`,
      )
      .bind(userId)
      .all<FileRow & { deleted_at: number }>(),
    countTrashed(db, userId),
  ]);
  const paths = await pathsForFolders(
    db,
    userId,
    rows.flatMap((row) => (row.folder_id === null ? [] : [row.folder_id])),
  );
  const items: TrashItem[] = rows.map((row) => {
    const { id, name, size, mime, folderId } = rowToFile(row);
    return {
      id,
      name,
      size,
      mime,
      folderId,
      path: trailOf(paths, folderId),
      deletedAt: row.deleted_at,
      purgeAt: row.deleted_at + retentionDays * DAY_MS,
    };
  });
  return c.json({ items, total, retentionDays } satisfies TrashContents);
});

/** Elimina de vez um ficheiro da lixeira (apaga o objeto do R2 e a linha, e devolve o espaço). */
trash.delete("/:id", async (c) => {
  const purged = await purgeTrashed(c.env, c.get("user").id, [c.req.param("id")]);
  if (purged !== 1) throw new ApiError(404, "file_not_found", "Ficheiro não encontrado na lixeira.");
  return c.body(null, 204);
});

/**
 * Esvazia a lixeira por blocos de `PURGE_BATCH` ficheiros (para respeitar o limite de chamadas por invocação).
 * Responde `{ purged, remaining }`: quem chama repete até `remaining` ser 0 (ou `purged` ser 0, se outro pedido mexer na lixeira).
 */
trash.delete("/", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const { results } = await db
    .prepare(
      `SELECT id FROM files WHERE user_id = ?1 AND status = 'ready' AND deleted_at IS NOT NULL
       ORDER BY deleted_at, id LIMIT ${PURGE_BATCH}`,
    )
    .bind(userId)
    .all<{ id: string }>();
  const purged = await purgeTrashed(c.env, userId, results.map((row) => row.id));
  return c.json({ purged, remaining: await countTrashed(db, userId) });
});

/**
 * Restaura um ficheiro da lixeira (limpa `deleted_at`; a quota já o contava). Se o nome já está ocupado no destino,
 * experimenta os nomes de `restoreCandidates`; o destino é a pasta onde estava (ao apagar uma pasta, os ficheiros
 * que estavam na lixeira passaram para a raiz, por isso `folder_id` existe sempre ou é a raiz).
 */
trash.post("/:id/restore", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const row = await db
    .prepare(
      `SELECT ${FILE_COLUMNS} FROM files WHERE id = ?1 AND user_id = ?2 AND status = 'ready' AND deleted_at IS NOT NULL`,
    )
    .bind(c.req.param("id"), userId)
    .first<FileRow>();
  if (!row) throw new ApiError(404, "file_not_found", "Ficheiro não encontrado na lixeira.");

  for (const name of restoreCandidates(row.name)) {
    try {
      const restored = await db
        .prepare(
          `UPDATE files SET deleted_at = NULL, name = ?1, name_norm = ?2
           WHERE id = ?3 AND user_id = ?4 AND status = 'ready' AND deleted_at IS NOT NULL`,
        )
        .bind(name, searchKey(name), row.id, userId)
        .run();
      // Nenhuma linha alterada: outro pedido restaurou-o ou eliminou-o entretanto.
      if (restored.meta.changes !== 1) throw new ApiError(404, "file_not_found", "Ficheiro não encontrado na lixeira.");
      return c.json({ file: { ...rowToFile(row), name } satisfies FileItem });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error; // nome ocupado: tenta o seguinte
    }
  }
  throw fileNameTaken();
});
