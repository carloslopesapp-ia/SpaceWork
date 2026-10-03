import { searchKey } from "../../shared/names";
import { ApiError, isUniqueViolation } from "../errors";
import { FILE_COLUMNS, rowToFile, type FileRow } from "../lib/files";
import {
  breadcrumbFor,
  FOLDER_COLUMNS,
  parseFolderRef,
  requireFolder,
  rowToFolder,
  type FolderRow,
} from "../lib/folders";
import { readJsonObject, readString } from "../lib/http";
import { parseName } from "../lib/names";
import { createAuthedRouter } from "./authed";

export const folders = createAuthedRouter();

/** Todas as pastas do utilizador (para o diálogo "Mover para…"). */
folders.get("/tree", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${FOLDER_COLUMNS} FROM folders WHERE user_id = ?1 ORDER BY name_norm, name`,
  )
    .bind(c.get("user").id)
    .all<FolderRow>();
  return c.json({ folders: results.map(rowToFolder) });
});

/** Conteúdo de uma pasta; `root` é a raiz. Pastas primeiro, depois ficheiros, por nome sem acentos. */
folders.get("/:id/contents", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const folderId = parseFolderRef(c.req.param("id"));
  const folder = folderId === null ? null : await requireFolder(db, userId, folderId);

  const [subfolders, files, breadcrumb] = await Promise.all([
    db
      .prepare(
        `SELECT ${FOLDER_COLUMNS} FROM folders WHERE user_id = ?1 AND parent_id IS ?2 ORDER BY name_norm, name`,
      )
      .bind(userId, folderId)
      .all<FolderRow>(),
    db
      .prepare(
        `SELECT ${FILE_COLUMNS} FROM files
         WHERE user_id = ?1 AND folder_id IS ?2 AND status = 'ready' AND deleted_at IS NULL
         ORDER BY name_norm, name`,
      )
      .bind(userId, folderId)
      .all<FileRow>(),
    folderId === null ? Promise.resolve([]) : breadcrumbFor(db, userId, folderId),
  ]);

  return c.json({
    folder,
    breadcrumb,
    folders: subfolders.results.map(rowToFolder),
    files: files.results.map(rowToFile),
  });
});

folders.post("/", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const body = await readJsonObject(c);
  const name = parseName(readString(body, "name"));
  const parentId = parseFolderRef(body.parentId);
  if (parentId !== null) await requireFolder(db, userId, parentId);

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  try {
    await db
      .prepare(
        `INSERT INTO folders (id, user_id, parent_id, name, name_norm, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(id, userId, parentId, name, searchKey(name), createdAt)
      .run();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "name_taken", "Já existe uma pasta com esse nome neste local.");
    }
    throw error;
  }
  return c.json({ folder: { id, name, parentId, createdAt } }, 201);
});
