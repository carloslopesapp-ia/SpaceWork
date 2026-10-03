import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiError } from "./errors";
import { jsonBodyLimit } from "./middleware/body-limit";
import { originCheck, securityHeaders } from "./middleware/security";
import { auth } from "./routes/auth";
import { files } from "./routes/files";
import { folders } from "./routes/folders";
import type { AppEnv } from "./types";

export const app = new Hono<AppEnv>();

app.use("/api/*", securityHeaders);
app.use("/api/*", originCheck);
app.use("/api/auth/*", jsonBodyLimit);
app.use("/api/folders/*", jsonBodyLimit);

app.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return c.json({ ok: row?.ok === 1 });
});

app.route("/api/auth", auth);
app.route("/api/folders", folders);
app.route("/api/files", files);

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
