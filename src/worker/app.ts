import { Hono } from "hono";
import { ApiError } from "./errors";
import { originCheck, securityHeaders } from "./middleware/security";

export const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", securityHeaders);
app.use("/api/*", originCheck);

app.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return c.json({ ok: row?.ok === 1 });
});

app.notFound((c) => c.json({ error: "not_found", message: "Não encontrado." }, 404));

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  console.error(error);
  return c.json({ error: "internal_error", message: "Erro interno do servidor." }, 500);
});
