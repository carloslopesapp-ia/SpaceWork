import { env, exports } from "cloudflare:workers";

export const ORIGIN = "http://example.com";

// Ordem segura para as chaves estrangeiras (filhos primeiro).
const TABLES = ["shares", "files", "folders", "sessions", "login_failures", "users"];

export async function resetDb(): Promise<void> {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
}

/** Apaga todos os objetos do R2 de teste (o estado do R2 também não é isolado entre testes do mesmo ficheiro). */
export async function resetStorage(): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ cursor });
    if (page.objects.length > 0) await env.FILES.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

/** D1 e R2 limpos: usar em `beforeEach` nos testes que gravam ficheiros. */
export async function resetState(): Promise<void> {
  await resetDb();
  await resetStorage();
}

interface ApiInit {
  method?: string;
  json?: unknown;
  body?: BodyInit;
  cookie?: string;
  /** Por defeito ORIGIN. `null` omite o cabeçalho Origin. */
  origin?: string | null;
  headers?: Record<string, string>;
}

/** Chama o Worker como um browser: caminho relativo ou URL absoluta. */
export function api(path: string, init: ApiInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const origin = init.origin === undefined ? ORIGIN : init.origin;
  if (origin !== null) headers.set("Origin", origin);
  if (init.cookie) headers.set("Cookie", init.cookie);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const url = path.startsWith("http") ? path : `${ORIGIN}${path}`;
  return exports.default.fetch(new Request(url, { method: init.method ?? "GET", headers, body }));
}

/** Extrai `sw_session=<token>` do Set-Cookie; null se não houver token (ex.: cookie apagado). */
export function sessionCookie(res: Response): string | null {
  const match = /sw_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
  return match ? `sw_session=${match[1]}` : null;
}
