import type { Hono } from "hono";
import type { ShareItem } from "../../shared/types";
import { ApiError } from "../errors";
import { randomToken, sha256Hex } from "../lib/crypto";
import { requireFile } from "../lib/files";
import { readJsonObject } from "../lib/http";
import {
  activeShare,
  MAX_ACTIVE_SHARES_PER_FILE,
  parseExpiry,
  rowToShare,
  SHARE_COLUMNS,
  type ShareRow,
} from "../lib/shares";
import type { AppEnv } from "../types";

/**
 * As rotas de partilha de um ficheiro. Acrescentam-se ao router de `/api/files` (e não a um router à parte montado no mesmo
 * prefixo) para cada pedido passar por um só `requireAuth`.
 */
export function addFileShareRoutes(router: Hono<AppEnv>): void {
  /**
   * Cria um link (`{ expiresAt? }`). O token tem 32 bytes aleatórios; a D1 guarda só o hash e o token só sai nesta resposta.
   * O teto de links ativos é verificado na própria instrução do `INSERT`, por isso pedidos em paralelo não o passam.
   */
  router.post("/:id/shares", async (c) => {
    const db = c.env.DB;
    const user = c.get("user");
    const file = await requireFile(db, user.id, c.req.param("id"));
    const body = await readJsonObject(c);
    const now = Date.now();
    const expiresAt = parseExpiry(body.expiresAt, now);

    const token = randomToken();
    const id = crypto.randomUUID();
    const inserted = await db
      .prepare(
        `INSERT INTO shares (id, token_hash, file_id, user_id, created_at, expires_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6
         WHERE (SELECT COUNT(*) FROM shares s WHERE s.file_id = ?3 AND ${activeShare("s", "?5")}) < ?7`,
      )
      .bind(id, await sha256Hex(token), file.id, user.id, now, expiresAt, MAX_ACTIVE_SHARES_PER_FILE)
      .run();
    if (inserted.meta.changes !== 1) {
      throw new ApiError(
        409,
        "too_many_shares",
        `Este ficheiro já tem ${MAX_ACTIVE_SHARES_PER_FILE} links ativos. Revogue algum antes de criar outro.`,
      );
    }
    return c.json({ share: { id, fileId: file.id, createdAt: now, expiresAt } satisfies ShareItem, token }, 201);
  });

  /** Os links ativos do ficheiro (não revogados nem expirados), do mais recente para o mais antigo. Nunca incluem o token. */
  router.get("/:id/shares", async (c) => {
    const user = c.get("user");
    const file = await requireFile(c.env.DB, user.id, c.req.param("id"));
    const { results } = await c.env.DB.prepare(
      `SELECT ${SHARE_COLUMNS} FROM shares s
       WHERE s.file_id = ?1 AND s.user_id = ?2 AND ${activeShare("s", "?3")}
       ORDER BY s.created_at DESC, s.id`,
    )
      .bind(file.id, user.id, Date.now())
      .all<ShareRow>();
    return c.json({ shares: results.map(rowToShare) });
  });
}
