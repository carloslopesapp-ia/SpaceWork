import { Hono } from "hono";

export const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return c.json({ ok: row?.ok === 1 });
});
