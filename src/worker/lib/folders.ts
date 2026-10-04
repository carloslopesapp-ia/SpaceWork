import type { BreadcrumbItem, FolderItem } from "../../shared/types";
import { ApiError } from "../errors";

/** Colunas de `folders` tal como vêm da D1. */
export interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  created_at: number;
}

export const FOLDER_COLUMNS = "id, parent_id, name, created_at";

export function rowToFolder(row: FolderRow): FolderItem {
  return { id: row.id, name: row.name, parentId: row.parent_id, createdAt: row.created_at };
}

/** `null`, `undefined`, "" e "root" significam a raiz (null); um identificador devolve-se tal e qual. */
export function parseFolderRef(value: unknown): string | null {
  if (value === null || value === undefined || value === "" || value === "root") return null;
  if (typeof value === "string") return value;
  throw new ApiError(400, "invalid_body", "Identificador de pasta inválido.");
}

export async function findFolder(
  db: D1Database,
  userId: string,
  id: string,
): Promise<FolderItem | null> {
  const row = await db
    .prepare(`SELECT ${FOLDER_COLUMNS} FROM folders WHERE id = ?1 AND user_id = ?2`)
    .bind(id, userId)
    .first<FolderRow>();
  return row ? rowToFolder(row) : null;
}

/** Como `findFolder`, mas uma pasta inexistente (ou de outro utilizador) é 404. */
export async function requireFolder(
  db: D1Database,
  userId: string,
  id: string,
): Promise<FolderItem> {
  const folder = await findFolder(db, userId, id);
  if (!folder) throw new ApiError(404, "folder_not_found", "Pasta não encontrada.");
  return folder;
}

/** Profundidade máxima das consultas recursivas: mesmo com um ciclo já gravado, terminam. */
export const MAX_FOLDER_DEPTH = 1000;

/** Caminho da raiz até à pasta (inclusive), por consulta recursiva (com limite de profundidade). */
export async function breadcrumbFor(
  db: D1Database,
  userId: string,
  folderId: string,
): Promise<BreadcrumbItem[]> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE anc(id, parent_id, name, depth) AS (
         SELECT id, parent_id, name, 0 FROM folders WHERE id = ?1 AND user_id = ?2
         UNION ALL
         SELECT f.id, f.parent_id, f.name, a.depth + 1
         FROM folders f JOIN anc a ON f.id = a.parent_id
         WHERE f.user_id = ?2 AND a.depth < ${MAX_FOLDER_DEPTH}
       )
       SELECT id, name FROM anc ORDER BY depth DESC`,
    )
    .bind(folderId, userId)
    .all<BreadcrumbItem>();
  return results;
}

/**
 * Mover `folderId` para dentro de `newParentId` cria um ciclo se for a própria pasta ou uma descendente dela.
 * É só uma pré-verificação rápida: a garantia é o `UPDATE` do `PATCH` (ver `UPDATE_FOLDER_SQL`).
 */
export async function wouldCreateCycle(
  db: D1Database,
  userId: string,
  folderId: string,
  newParentId: string,
): Promise<boolean> {
  const trail = await breadcrumbFor(db, userId, newParentId);
  return trail.some((item) => item.id === folderId);
}

/**
 * Renomeia e/ou move uma pasta numa só instrução atómica. Só grava as colunas pedidas (`?1` nome ou NULL,
 * `?2` chave de pesquisa ou NULL, `?3` = 1 se o pedido traz `parentId`, `?4` novo pai ou NULL, `?5` pasta,
 * `?6` utilizador) e recusa, na própria instrução, um destino que seja a pasta ou uma descendente dela
 * (ou uma cadeia mais funda do que `MAX_FOLDER_DEPTH`): dois movimentos opostos em paralelo não criam ciclos.
 */
export const UPDATE_FOLDER_SQL = `
  UPDATE folders SET name = COALESCE(?1, name), name_norm = COALESCE(?2, name_norm),
    parent_id = CASE WHEN ?3 = 1 THEN ?4 ELSE parent_id END
  WHERE id = ?5 AND user_id = ?6
    AND NOT (?3 = 1 AND ?4 IS NOT NULL AND EXISTS (
      WITH RECURSIVE anc(id, depth) AS (
        SELECT ?4, 0 UNION ALL
        SELECT f.parent_id, a.depth + 1 FROM folders f JOIN anc a ON f.id = a.id
        WHERE f.user_id = ?6 AND f.parent_id IS NOT NULL AND a.depth < ${MAX_FOLDER_DEPTH})
      SELECT 1 FROM anc WHERE id = ?5 OR depth >= ${MAX_FOLDER_DEPTH}))`;

/** Profundidade máxima das pastas do utilizador (as da raiz estão no nível 1). */
export const MAX_NESTING = 100;

/** Número de níveis de uma pasta contando com as suas descendentes (1 = sem subpastas). */
async function subtreeHeight(db: D1Database, userId: string, folderId: string): Promise<number> {
  const row = await db
    .prepare(
      `WITH RECURSIVE sub(id, depth) AS (
         SELECT id, 1 FROM folders WHERE id = ?1 AND user_id = ?2
         UNION ALL
         SELECT f.id, s.depth + 1 FROM folders f JOIN sub s ON f.parent_id = s.id
         WHERE f.user_id = ?2 AND s.depth < ${MAX_FOLDER_DEPTH}
       )
       SELECT MAX(depth) AS height FROM sub`,
    )
    .bind(folderId, userId)
    .first<{ height: number | null }>();
  return row?.height ?? 1;
}

/**
 * Garante que uma pasta nova (ou, com `movingFolderId`, a pasta movida com tudo o que tem dentro) cabe por baixo
 * de `parentId` sem passar de `MAX_NESTING` níveis. A raiz (`null`) nunca é recusada. É uma verificação à parte
 * da escrita: dois pedidos em paralelo podem passar o limite por poucos níveis.
 */
export async function assertFitsBelow(
  db: D1Database,
  userId: string,
  parentId: string | null,
  movingFolderId?: string,
): Promise<void> {
  if (parentId === null) return;
  const height = movingFolderId === undefined ? 1 : await subtreeHeight(db, userId, movingFolderId);
  const depth = (await breadcrumbFor(db, userId, parentId)).length;
  if (depth + height > MAX_NESTING) {
    throw new ApiError(400, "folder_too_deep", `As pastas não podem ter mais de ${MAX_NESTING} níveis de profundidade.`);
  }
}
