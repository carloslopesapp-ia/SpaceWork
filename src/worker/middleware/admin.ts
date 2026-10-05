import type { MiddlewareHandler } from "hono";
import { ApiError } from "../errors";
import type { AppEnv } from "../types";

/** Só o administrador passa. Vem depois de `requireAuth` (o `user` já está no contexto). */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("user").role !== "admin") {
    throw new ApiError(403, "forbidden", "Só o administrador pode fazer isto.");
  }
  await next();
};
