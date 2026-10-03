import { formatBytes } from "../../shared/format";
import { searchKey } from "../../shared/names";
import { getConfig } from "../config";
import { ApiError, isForeignKeyViolation, isUniqueViolation } from "../errors";
import { r2KeyFor, sanitizeMime } from "../lib/files";
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
