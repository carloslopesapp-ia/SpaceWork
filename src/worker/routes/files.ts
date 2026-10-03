import { formatBytes } from "../../shared/format";
import { searchKey } from "../../shared/names";
import { getConfig } from "../config";
import { ApiError, isForeignKeyViolation, isUniqueViolation } from "../errors";
import {
  contentDisposition,
  previewContentType,
  r2KeyFor,
  requireFile,
  sanitizeMime,
} from "../lib/files";
import { parseFolderRef, requireFolder } from "../lib/folders";
import { parseName } from "../lib/names";
import { createAuthedRouter } from "./authed";

export const files = createAuthedRouter();

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
 * 3. Passa a linha a `ready`. Se o passo 2 ou 3 falhar, liberta a reserva.
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
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "name_taken", "Já existe um ficheiro com esse nome neste local.");
    }
    // A pasta foi apagada entre a verificação e a reserva.
    if (isForeignKeyViolation(error)) {
      throw new ApiError(404, "folder_not_found", "Pasta não encontrada.");
    }
    throw error;
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

  return c.json({ file: { id, name, folderId, size, mime, createdAt } }, 201);
});

/**
 * Desfaz a reserva de um upload que falhou: apaga a linha `pending` e devolve o espaço, numa só
 * `batch` (o `changes()` garante que o espaço só é devolvido se a linha foi mesmo apagada).
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
    const [deleted] = await env.DB.batch([
      env.DB.prepare("DELETE FROM files WHERE id = ?1 AND status = 'pending'").bind(fileId),
      env.DB.prepare(
        "UPDATE users SET used_bytes = MAX(used_bytes - ?1, 0) WHERE id = ?2 AND changes() = 1",
      ).bind(size, userId),
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

function missingObject(fileId: string): ApiError {
  console.error(`O ficheiro ${fileId} existe na D1 mas não tem objeto no R2.`);
  return new ApiError(404, "file_missing", "O conteúdo do ficheiro não está disponível.");
}

/** Descarrega o ficheiro em *stream*, sempre como anexo (nunca é interpretado pelo browser). */
files.get("/:id/download", async (c) => {
  const file = await requireFile(c.env.DB, c.get("user").id, c.req.param("id"));
  const object = await c.env.FILES.get(file.r2Key);
  if (!object) throw missingObject(file.id);

  return new Response(object.body, {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(object.size),
      "Content-Disposition": contentDisposition("attachment", file.name),
      ETag: object.httpEtag,
    },
  });
});

/** Posição e tamanho de um intervalo já resolvido pelo R2. */
function resolveRange(range: R2Range | undefined, size: number): { offset: number; length: number } {
  const r = (range ?? {}) as { offset?: number; length?: number; suffix?: number };
  const offset = r.offset ?? (r.suffix !== undefined ? Math.max(size - r.suffix, 0) : 0);
  return { offset, length: r.length ?? size - offset };
}

/**
 * Pré-visualização inline, só para imagens e PDF (lista fixa por extensão). O Content-Type vem
 * dessa lista e não do valor guardado. Suporta um único intervalo (`Range: bytes=a-b`, `a-`, `-n`).
 */
files.get("/:id/preview", async (c) => {
  const file = await requireFile(c.env.DB, c.get("user").id, c.req.param("id"));
  const contentType = previewContentType(file.name);
  if (!contentType) {
    throw new ApiError(415, "preview_unsupported", "Este tipo de ficheiro não tem pré-visualização.");
  }

  // Só um intervalo simples conta; qualquer outro formato é ignorado e devolve-se o ficheiro todo.
  const match = /^bytes=(\d*)-(\d*)$/.exec((c.req.header("range") ?? "").trim());
  const ranged = match !== null && (match[1] !== "" || match[2] !== "");
  const object = await c.env.FILES.get(file.r2Key, ranged ? { range: c.req.raw.headers } : undefined);
  if (!object) throw missingObject(file.id);

  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": contentDisposition("inline", file.name),
    "Accept-Ranges": "bytes",
    ETag: object.httpEtag,
  });
  if (contentType.startsWith("image/")) {
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  }

  if (ranged && match) {
    // O R2 devolve o ficheiro todo quando o intervalo começa depois do fim; aqui é 416.
    if (match[1] !== "" && Number(match[1]) >= object.size) {
      await object.body.cancel();
      headers.set("Content-Range", `bytes */${object.size}`);
      return new Response(null, { status: 416, headers });
    }
    const { offset, length } = resolveRange(object.range, object.size);
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
});
