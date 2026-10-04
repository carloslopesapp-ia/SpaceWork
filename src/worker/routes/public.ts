import { Hono } from "hono";
import type { PublicShare } from "../../shared/types";
import { ApiError } from "../errors";
import { sha256Hex } from "../lib/crypto";
import { activeShare } from "../lib/shares";
import { attachmentResponse, missingObject } from "../lib/serve";
import type { AppEnv } from "../types";

/** Rotas públicas (sem sessão): só servem ficheiros partilhados por um link ativo. */
export const publicRoutes = new Hono<AppEnv>();

interface SharedFile {
  fileId: string;
  name: string;
  size: number;
  mime: string;
  r2Key: string;
}

/**
 * O ficheiro de um link, ou 404 `share_not_found`, sempre com a mesma resposta (nada diz se o link nunca existiu, foi revogado, expirou
 * ou o ficheiro está na lixeira). Só vale se o link está ativo, o ficheiro está pronto e fora da lixeira e a conta do dono está ativa.
 */
async function requireSharedFile(db: D1Database, token: string): Promise<SharedFile> {
  const row = await db
    .prepare(
      `SELECT f.id, f.name, f.size, f.mime, f.r2_key
       FROM shares s
       JOIN files f ON f.id = s.file_id
       JOIN users u ON u.id = f.user_id
       WHERE s.token_hash = ?1 AND ${activeShare("s", "?2")}
         AND f.status = 'ready' AND f.deleted_at IS NULL AND u.status = 'active'`,
    )
    .bind(await sha256Hex(token), Date.now())
    .first<{ id: string; name: string; size: number; mime: string; r2_key: string }>();
  if (!row) throw new ApiError(404, "share_not_found", "Este link não existe ou já não está disponível.");
  return { fileId: row.id, name: row.name, size: row.size, mime: row.mime, r2Key: row.r2_key };
}

/** O que a página pública mostra: o nome e o tamanho. */
publicRoutes.get("/shares/:token", async (c) => {
  const file = await requireSharedFile(c.env.DB, c.req.param("token"));
  return c.json({ name: file.name, size: file.size } satisfies PublicShare);
});

/** Descarrega o ficheiro partilhado, sempre como anexo. */
publicRoutes.get("/shares/:token/download", async (c) => {
  const file = await requireSharedFile(c.env.DB, c.req.param("token"));
  const object = await c.env.FILES.get(file.r2Key);
  if (!object) throw missingObject(file.fileId);
  return attachmentResponse(object, file);
});
