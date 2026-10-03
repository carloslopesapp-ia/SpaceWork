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

/** Chave do ficheiro no R2: opaca, sem nome nem caminho (mover e renomear só mexem na D1). */
export function r2KeyFor(userId: string, fileId: string): string {
  return `u/${userId}/${fileId}`;
}

const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/** `type/subtype` em minúsculas, sem parâmetros; qualquer coisa inválida vira `application/octet-stream`. */
export function sanitizeMime(raw: string | undefined): string {
  const type = (raw ?? "").split(";")[0].trim().toLowerCase();
  return MIME_PATTERN.test(type) ? type : "application/octet-stream";
}
