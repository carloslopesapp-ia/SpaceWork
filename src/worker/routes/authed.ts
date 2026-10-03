import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

/** Router em que TODAS as rotas exigem sessão: uma rota nova não pode esquecer-se de `requireAuth`. */
export function createAuthedRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  router.use("*", requireAuth);
  return router;
}
