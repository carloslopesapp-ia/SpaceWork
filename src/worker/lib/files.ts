import type { FileItem } from "../../shared/types";
import { ApiError } from "../errors";

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

/** Um ficheiro pronto, com a chave do R2 (nunca vai para o frontend). */
export interface StoredFile extends FileItem {
  r2Key: string;
}

/** Ficheiro pronto e fora da lixeira do utilizador, ou null. */
export async function findReadyFile(
  db: D1Database,
  userId: string,
  id: string,
): Promise<StoredFile | null> {
  const row = await db
    .prepare(
      `SELECT ${FILE_COLUMNS}, r2_key FROM files
       WHERE id = ?1 AND user_id = ?2 AND status = 'ready' AND deleted_at IS NULL`,
    )
    .bind(id, userId)
    .first<FileRow & { r2_key: string }>();
  return row ? { ...rowToFile(row), r2Key: row.r2_key } : null;
}

/** Como `findReadyFile`, mas um ficheiro inexistente, na lixeira ou de outro utilizador é 404. */
export async function requireFile(
  db: D1Database,
  userId: string,
  id: string,
): Promise<StoredFile> {
  const file = await findReadyFile(db, userId, id);
  if (!file) throw new ApiError(404, "file_not_found", "Ficheiro não encontrado.");
  return file;
}

/** O ficheiro sem a chave do R2, pronto para sair na resposta da API. */
export function toFileItem(file: StoredFile): FileItem {
  const { r2Key: _r2Key, ...item } = file;
  return item;
}

// Só estes tipos abrem dentro da app. SVG e HTML ficam de fora de propósito: executariam código no nosso domínio.
const PREVIEW_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

/** Content-Type fixo para a pré-visualização, decidido pela extensão do nome; null se não for permitida. */
export function previewContentType(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null; // sem extensão, ou um ficheiro escondido como ".png"
  const extension = name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(PREVIEW_TYPES, extension) ? PREVIEW_TYPES[extension] : null;
}

/** `Content-Disposition` com `filename` ASCII de recurso e `filename*` em UTF-8 (RFC 5987). */
export function contentDisposition(type: "attachment" | "inline", filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
