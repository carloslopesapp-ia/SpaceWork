import type { MiddlewareHandler } from "hono";
import { ApiError } from "../errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Cabeçalhos de segurança em todas as respostas do Worker (os assets estáticos usam public/_headers). */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("Referrer-Policy", "same-origin");
  c.header("Cache-Control", "no-store");
};

/** Proteção CSRF: pedidos que alteram dados têm de trazer um Origin igual à origem do pedido. */
export const originCheck: MiddlewareHandler = async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header("Origin");
    if (!origin || origin !== new URL(c.req.url).origin) {
      throw new ApiError(403, "forbidden_origin", "Origem do pedido inválida.");
    }
  }
  await next();
};
