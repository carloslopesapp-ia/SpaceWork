import { ApiError } from "../errors";
import { createAuthedRouter } from "./authed";

export const shares = createAuthedRouter();

/** Revoga um link: deixa de funcionar logo (`revoked_at`). A linha fica até o cron de manutenção a limpar (Plano 4). */
shares.delete("/:id", async (c) => {
  const revoked = await c.env.DB.prepare(
    "UPDATE shares SET revoked_at = ?1 WHERE id = ?2 AND user_id = ?3 AND revoked_at IS NULL",
  )
    .bind(Date.now(), c.req.param("id"), c.get("user").id)
    .run();
  if (revoked.meta.changes !== 1) throw new ApiError(404, "share_not_found", "Link não encontrado.");
  return c.body(null, 204);
});
