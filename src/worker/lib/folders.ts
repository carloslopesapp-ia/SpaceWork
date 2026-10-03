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

/** Caminho da raiz até à pasta (inclusive), por consulta recursiva. */
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
         WHERE f.user_id = ?2
       )
       SELECT id, name FROM anc ORDER BY depth DESC`,
    )
    .bind(folderId, userId)
    .all<BreadcrumbItem>();
  return results;
}

/** Mover `folderId` para dentro de `newParentId` cria um ciclo se for a própria pasta ou uma descendente dela. */
export async function wouldCreateCycle(
  db: D1Database,
  userId: string,
  folderId: string,
  newParentId: string,
): Promise<boolean> {
  const trail = await breadcrumbFor(db, userId, newParentId);
  return trail.some((item) => item.id === folderId);
}
