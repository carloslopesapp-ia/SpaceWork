import { searchKey } from "../../shared/names";
import type { FolderContents, FolderItem } from "../../shared/types";
import { ApiError, isForeignKeyViolation, rethrowConstraint } from "../errors";
import { FILE_COLUMNS, rowToFile, type FileRow } from "../lib/files";
import {
  breadcrumbFor,
  FOLDER_COLUMNS,
  parseFolderRef,
  requireFolder,
  rowToFolder,
  UPDATE_FOLDER_SQL,
  wouldCreateCycle,
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
  } satisfies FolderContents);
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
    rethrowConstraint(error, {
      unique: new ApiError(409, "name_taken", "Já existe uma pasta com esse nome neste local."),
      // A pasta-mãe foi apagada entre a verificação e o INSERT.
      foreignKey: new ApiError(404, "folder_not_found", "Pasta não encontrada."),
    });
  }
  return c.json({ folder: { id, name, parentId, createdAt } satisfies FolderItem }, 201);
});

/**
 * Renomeia e/ou move uma pasta (`parentId: null` ou "root" = raiz). Só mexe na D1. A verificação do ciclo
 * e a escrita são uma só instrução (`UPDATE_FOLDER_SQL`) que só grava as colunas pedidas; a resposta vem
 * de uma releitura depois do `UPDATE`.
 */
folders.patch("/:id", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const folder = await requireFolder(db, userId, c.req.param("id"));
  const body = await readJsonObject(c);
  const hasName = "name" in body;
  const hasParent = "parentId" in body;
  if (!hasName && !hasParent) {
    throw new ApiError(400, "invalid_body", "Indique o novo nome e/ou a nova pasta.");
  }

  const name = hasName ? parseName(readString(body, "name")) : null;
  const parentId = hasParent ? parseFolderRef(body.parentId) : null;
  const invalidMove = new ApiError(
    400,
    "invalid_move",
    "Não é possível mover uma pasta para dentro de si própria ou de uma das suas subpastas.",
  );
  if (parentId !== null) {
    await requireFolder(db, userId, parentId);
    if (await wouldCreateCycle(db, userId, folder.id, parentId)) throw invalidMove;
  }

  let updated;
  try {
    updated = await db
      .prepare(UPDATE_FOLDER_SQL)
      .bind(name, name === null ? null : searchKey(name), hasParent ? 1 : 0, parentId, folder.id, userId)
      .run();
  } catch (error) {
    rethrowConstraint(error, {
      unique: new ApiError(409, "name_taken", "Já existe uma pasta com esse nome neste local."),
      // O destino foi apagado entre a verificação e o UPDATE.
      foreignKey: new ApiError(404, "folder_not_found", "Pasta não encontrada."),
    });
  }
  // Nenhuma linha alterada: ou a pasta já não existe, ou o destino passou a ser uma descendente dela.
  if (updated.meta.changes !== 1) {
    await requireFolder(db, userId, folder.id);
    throw invalidMove;
  }
  return c.json({ folder: (await requireFolder(db, userId, folder.id)) satisfies FolderItem });
});

/**
 * Só apaga pastas vazias: sem subpastas e sem ficheiros fora da lixeira (um ficheiro `pending`
 * conta como conteúdo). Os ficheiros que estão na lixeira passam para a raiz e a pasta desaparece.
 */
folders.delete("/:id", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const folder = await requireFolder(db, userId, c.req.param("id"));
  const notEmpty = new ApiError(
    409,
    "folder_not_empty",
    "A pasta não está vazia. Mova ou exclua primeiro o conteúdo.",
  );

  const [subfolders, files] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) AS n FROM folders WHERE user_id = ?1 AND parent_id = ?2")
      .bind(userId, folder.id)
      .first<{ n: number }>(),
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM files WHERE user_id = ?1 AND folder_id = ?2 AND deleted_at IS NULL",
      )
      .bind(userId, folder.id)
      .first<{ n: number }>(),
  ]);
  if ((subfolders?.n ?? 0) > 0 || (files?.n ?? 0) > 0) throw notEmpty;

  try {
    await db.batch([
      db
        .prepare(
          "UPDATE files SET folder_id = NULL WHERE user_id = ?1 AND folder_id = ?2 AND deleted_at IS NOT NULL",
        )
        .bind(userId, folder.id),
      db.prepare("DELETE FROM folders WHERE id = ?1 AND user_id = ?2").bind(folder.id, userId),
    ]);
  } catch (error) {
    // Alguém acrescentou conteúdo entre a verificação e o apagar: a chave estrangeira impede-o.
    if (isForeignKeyViolation(error)) throw notEmpty;
    throw error;
  }
  return c.body(null, 204);
});
