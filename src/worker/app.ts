import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiError } from "./errors";
import { jsonBodyLimit } from "./middleware/body-limit";
import { originCheck, securityHeaders } from "./middleware/security";
import { auth } from "./routes/auth";
import { clientConfig } from "./routes/config";
import { files } from "./routes/files";
import { folders } from "./routes/folders";
import { search } from "./routes/search";
import type { AppEnv } from "./types";

export const app = new Hono<AppEnv>();

app.use("/api/*", securityHeaders);
app.use("/api/*", originCheck);
// O limite de 64 KiB vale para toda a API, menos o upload (`PUT /api/files`), que vai em stream e tem o seu próprio limite.
// Montado aqui e não rota a rota: uma rota nova não se pode esquecer dele.
app.use("/api/*", (c, next) =>
  c.req.method === "PUT" && /^\/api\/files\/?$/.test(c.req.path) ? next() : jsonBodyLimit(c, next),
);

app.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return c.json({ ok: row?.ok === 1 });
});

app.route("/api/auth", auth);
app.route("/api/config", clientConfig);
app.route("/api/folders", folders);
app.route("/api/files", files);
app.route("/api/search", search);

app.notFound((c) => c.json({ error: "not_found", message: "Não encontrado." }, 404));

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  if (error instanceof HTTPException) {
    return c.json({ error: "http_error", message: error.message }, error.status);
  }
  console.error(error);
  return c.json({ error: "internal_error", message: "Erro interno do servidor." }, 500);
});
