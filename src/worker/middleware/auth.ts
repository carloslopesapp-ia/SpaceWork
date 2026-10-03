import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { ApiError } from "../errors";
import { clearSessionCookie, SESSION_COOKIE } from "../lib/cookies";
import { findSession } from "../lib/sessions";
import type { AppEnv } from "../types";

/** Exige sessão válida e põe `user` e `sessionTokenHash` no contexto. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const session = token ? await findSession(c.env.DB, token) : null;
  if (!session) {
    if (token) clearSessionCookie(c);
    throw new ApiError(401, "unauthorized", "Sessão inválida ou expirada.");
  }
  c.set("user", session.user);
  c.set("sessionTokenHash", session.tokenHash);
  await next();
};
