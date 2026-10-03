import { env } from "cloudflare:workers";

// Ordem segura para as chaves estrangeiras (filhos primeiro).
const TABLES = ["shares", "files", "folders", "sessions", "login_failures", "users"];

export async function resetDb(): Promise<void> {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
}
