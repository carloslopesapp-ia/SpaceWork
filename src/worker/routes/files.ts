import { formatBytes } from "../../shared/format";
import { searchKey } from "../../shared/names";
import { previewContentType } from "../../shared/preview";
import type { FileItem } from "../../shared/types";
import { getConfig } from "../config";
import { ApiError, rethrowConstraint } from "../errors";
import {
  contentDisposition,
  fileNameTaken,
  parseRange,
  r2KeyFor,
  requireFile,
  sanitizeMime,
  toFileItem,
} from "../lib/files";
import { parseFolderRef, requireFolder } from "../lib/folders";
import { readJsonObject, readString } from "../lib/http";
import { parseName } from "../lib/names";
import { attachmentResponse, missingObject } from "../lib/serve";
import { createAuthedRouter } from "./authed";
import { addFileShareRoutes } from "./file-shares";

export const files = createAuthedRouter();
addFileShareRoutes(files);

function parseContentLength(raw: string | undefined): number {
  const size = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(size)) {
    throw new ApiError(
      411,
      "length_required",
      "O pedido tem de indicar o tamanho do ficheiro (Content-Length).",
    );
  }
  return size;
}

/**
 * Upload: `PUT /api/files?name=<nome>&folder=<id|omitido>` com o ficheiro no corpo.
 *
 * 1. Reserva atómica numa só `batch`: insere a linha `pending` só se couber na quota e, só então,
 *    soma o tamanho a `used_bytes` (pedidos em paralelo não conseguem ultrapassar a quota).
 * 2. Grava os bytes no R2 em *stream* (o R2 exige o tamanho conhecido, por isso o Content-Length é obrigatório).
 * 3. Passa a linha a `ready`. Se o passo 2 ou 3 falhar, tenta libertar a reserva, mas só se a linha ainda
 *    estiver `pending` (apaga-a, devolve o espaço e só então apaga o objeto do R2). Se já está `ready`, o
 *    ficheiro existe e nada se desfaz (ver `releaseReservation`).
 */
files.put("/", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const config = getConfig(c.env);

  const name = parseName(c.req.query("name") ?? "");
  const folderId = parseFolderRef(c.req.query("folder"));
  if (folderId !== null) await requireFolder(db, user.id, folderId);
  const size = parseContentLength(c.req.header("content-length"));
  if (size > config.maxUploadBytes) {
    throw new ApiError(
      413,
      "file_too_large",
      `O ficheiro excede o tamanho máximo de ${formatBytes(config.maxUploadBytes)}.`,
    );
  }

  const id = crypto.randomUUID();
  const r2Key = r2KeyFor(user.id, id);
  const mime = sanitizeMime(c.req.header("content-type"));
  const createdAt = Date.now();

  let reserved;
  try {
    reserved = await db.batch([
      db
        .prepare(
          `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9
           WHERE EXISTS (
             SELECT 1 FROM users
             WHERE id = ?2 AND status = 'active' AND used_bytes + ?6 <= quota_bytes
           )`,
        )
        .bind(id, user.id, folderId, name, searchKey(name), size, mime, r2Key, createdAt),
      db
        .prepare(
          "UPDATE users SET used_bytes = used_bytes + ?1 WHERE id = ?2 AND EXISTS (SELECT 1 FROM files WHERE id = ?3)",
        )
        .bind(size, user.id, id),
    ]);
  } catch (error) {
    rethrowConstraint(error, {
      unique: fileNameTaken(),
      // A pasta foi apagada entre a verificação e a reserva.
      foreignKey: new ApiError(404, "folder_not_found", "Pasta não encontrada."),
    });
  }
  if (reserved[0].meta.changes !== 1) {
    throw new ApiError(413, "quota_exceeded", "Sem espaço suficiente na sua quota.");
  }

  try {
    const object = await c.env.FILES.put(r2Key, c.req.raw.body, {
      httpMetadata: { contentType: mime },
    });
    if (object === null || object.size !== size) {
      throw new Error("O tamanho gravado no R2 é diferente do declarado.");
    }
    await db.prepare("UPDATE files SET status = 'ready' WHERE id = ?1").bind(id).run();
  } catch (error) {
    await releaseReservation(c.env, user.id, id, size, r2Key);
    throw error;
  }

  return c.json({ file: { id, name, folderId, size, mime, createdAt } satisfies FileItem }, 201);
});

/**
 * Desfaz a reserva de um upload que falhou: devolve o espaço e apaga a linha `pending`, numa só
 * `batch` (o espaço só se devolve se a linha `pending` ainda existe).
 *
 * O objeto do R2 só se apaga se a linha `pending` foi mesmo apagada. Se a linha já está `ready` (a D1
 * confirmou o `UPDATE` mas a resposta perdeu-se), o objeto é o conteúdo do ficheiro e não se toca;
 * se a `batch` falhou, a linha `pending` e o objeto ficam para o cron de manutenção (Plano 4) limpar.
 * Falhas aqui são registadas e nunca substituem o erro original do upload.
 */
async function releaseReservation(
  env: Env,
  userId: string,
  fileId: string,
  size: number,
  r2Key: string,
): Promise<void> {
  let removed = false;
  try {
    const [, deleted] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE users SET used_bytes = MAX(used_bytes - ?1, 0)
         WHERE id = ?2 AND EXISTS (SELECT 1 FROM files WHERE id = ?3 AND status = 'pending')`,
      ).bind(size, userId, fileId),
      env.DB.prepare("DELETE FROM files WHERE id = ?1 AND status = 'pending'").bind(fileId),
    ]);
    removed = deleted.meta.changes === 1;
  } catch (error) {
    console.error("Não foi possível libertar a reserva de um upload falhado", error);
  }
  // O objeto só se apaga se a linha `pending` foi mesmo apagada. Se a linha já está `ready`, o objeto é o
  // conteúdo do ficheiro; se a batch falhou, o cron de manutenção (Plano 4) limpa a linha e o objeto.
  if (removed) {
    await env.FILES.delete(r2Key).catch((error) => console.error(`Objeto órfão no R2: ${r2Key}`, error));
  }
}

/** Descarrega o ficheiro em *stream*, sempre como anexo (nunca é interpretado pelo browser). */
files.get("/:id/download", async (c) => {
  const file = await requireFile(c.env.DB, c.get("user").id, c.req.param("id"));
  const object = await c.env.FILES.get(file.r2Key);
  if (!object) throw missingObject(file.id);
  return attachmentResponse(object, file);
});

/**
 * Pré-visualização inline, só para imagens e PDF (lista fixa por extensão). O Content-Type vem
 * dessa lista e não do valor guardado. Suporta um único intervalo (`Range: bytes=a-b`, `a-`, `-n`),
 * resolvido contra o tamanho da D1 (ver `parseRange`).
 */
files.get("/:id/preview", async (c) => {
  const file = await requireFile(c.env.DB, c.get("user").id, c.req.param("id"));
  const contentType = previewContentType(file.name);
  if (!contentType) {
    throw new ApiError(415, "preview_unsupported", "Este tipo de ficheiro não tem pré-visualização.");
  }

  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": contentDisposition("inline", file.name),
    "Accept-Ranges": "bytes",
  });
  if (contentType.startsWith("image/")) {
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  }

  const range = parseRange(c.req.header("range"), file.size);
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${file.size}`);
    return new Response(null, { status: 416, headers });
  }

  const object = await c.env.FILES.get(file.r2Key, range ? { range } : undefined);
  if (!object) throw missingObject(file.id);
  headers.set("ETag", object.httpEtag);

  if (range) {
    headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${file.size}`);
    headers.set("Content-Length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
});

/**
 * Renomeia e/ou move um ficheiro (`folderId: null` ou "root" = raiz). Só mexe na D1: a chave do R2 não muda.
 * O `UPDATE` só grava as colunas pedidas (um pedido concorrente do mesmo utilizador não é desfeito) e a
 * resposta vem de uma releitura depois dele.
 */
files.patch("/:id", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const file = await requireFile(db, userId, c.req.param("id"));
  const body = await readJsonObject(c);
  const hasName = "name" in body;
  const hasFolder = "folderId" in body;
  if (!hasName && !hasFolder) {
    throw new ApiError(400, "invalid_body", "Indique o novo nome e/ou a nova pasta.");
  }

  const name = hasName ? parseName(readString(body, "name")) : null;
  const folderId = hasFolder ? parseFolderRef(body.folderId) : null;
  if (folderId !== null) await requireFolder(db, userId, folderId);

  let updated;
  try {
    updated = await db
      .prepare(
        `UPDATE files SET name = COALESCE(?1, name), name_norm = COALESCE(?2, name_norm),
           folder_id = CASE WHEN ?3 = 1 THEN ?4 ELSE folder_id END
         WHERE id = ?5 AND user_id = ?6 AND status = 'ready' AND deleted_at IS NULL`,
      )
      .bind(name, name === null ? null : searchKey(name), hasFolder ? 1 : 0, folderId, file.id, userId)
      .run();
  } catch (error) {
    rethrowConstraint(error, {
      unique: fileNameTaken(),
      // O destino foi apagado entre a verificação e o UPDATE.
      foreignKey: new ApiError(404, "folder_not_found", "Pasta não encontrada."),
    });
  }
  if (updated.meta.changes !== 1) {
    throw new ApiError(404, "file_not_found", "Ficheiro não encontrado.");
  }
  return c.json({ file: toFileItem(await requireFile(db, userId, file.id)) satisfies FileItem });
});

/**
 * Exclui um ficheiro: manda-o para a lixeira (`deleted_at`). O objeto no R2 e a quota ficam como
 * estão até o ficheiro ser eliminado de vez (lixeira e limpeza automática: planos seguintes).
 */
files.delete("/:id", async (c) => {
  const result = await c.env.DB.prepare(
    `UPDATE files SET deleted_at = ?1
     WHERE id = ?2 AND user_id = ?3 AND status = 'ready' AND deleted_at IS NULL`,
  )
    .bind(Date.now(), c.req.param("id"), c.get("user").id)
    .run();
  if (result.meta.changes !== 1) {
    throw new ApiError(404, "file_not_found", "Ficheiro não encontrado.");
  }
  return c.body(null, 204);
});
