import type { FileItem } from "../../shared/types";

/** Colunas de `files` usadas nas listagens, tal como vêm da D1. */
export interface FileRow {
  id: string;
  folder_id: string | null;
  name: string;
  size: number;
  mime: string;
  created_at: number;
}

export const FILE_COLUMNS = "id, folder_id, name, size, mime, created_at";

export function rowToFile(row: FileRow): FileItem {
  return {
    id: row.id,
    name: row.name,
    folderId: row.folder_id,
    size: row.size,
    mime: row.mime,
    createdAt: row.created_at,
  };
}
