import { vi } from "vitest";
import type { PublicUser } from "../../shared/types";

export interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  /** Os `:segmentos` da rota que casou. */
  params: Record<string, string>;
  /** O corpo JSON do pedido; `undefined` se não havia corpo. */
  body: unknown;
  /** A chave da rota que casou (ex.: "PATCH /api/files/:id"), ou null se nenhuma casou. */
  route: string | null;
}

type Handler = (request: MockRequest) => Response | Promise<Response>;

export const json = (data: unknown, status = 200): Response => Response.json(data, { status });
export const apiError = (status: number, error: string, message: string): Response =>
  Response.json({ error, message }, { status });
export const noContent = (): Response => new Response(null, { status: 204 });

export const ME: PublicUser = {
  id: "u1",
  email: "ana@example.com",
  role: "user",
  quotaBytes: 1_073_741_824,
  usedBytes: 0,
};

/** A rota de sessão que quase todos os testes de páginas precisam. */
export const SESSION = {
  "GET /api/auth/me": () => json({ user: ME }),
  "GET /api/config": () => json({ maxUploadBytes: 104_857_600 }),
};

/**
 * Substitui o `fetch` global por um servidor falso: `routes` mapeia "MÉTODO /caminho/:param" para uma função
 * que devolve a resposta. Um pedido sem rota recebe 404 (e fica em `calls` com `route: null`).
 */
export function mockApi(routes: Record<string, Handler>) {
  const compiled = Object.entries(routes).map(([key, handler]) => {
    const [method, pattern] = key.split(" ");
    const names: string[] = [];
    const source = pattern.replace(/:(\w+)/g, (_match, name: string) => {
      names.push(name);
      return "([^/]+)";
    });
    return { key, method, regex: new RegExp(`^${source}$`), names, handler };
  });
  const calls: MockRequest[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const match = compiled.find((route) => route.method === method && route.regex.test(url.pathname));
      const params: Record<string, string> = {};
      match?.regex.exec(url.pathname)?.slice(1).forEach((value, index) => {
        params[match.names[index]] = decodeURIComponent(value);
      });
      const request: MockRequest = { method, path: url.pathname, query: url.searchParams, params, body, route: match?.key ?? null };
      calls.push(request);
      if (!match) return apiError(404, "not_found", `Sem rota no mock: ${method} ${url.pathname}`);
      return match.handler(request);
    }),
  );

  return {
    calls,
    /** Os pedidos que casaram com a rota indicada (a mesma chave que se deu em `routes`). */
    callsTo: (key: string) => calls.filter((call) => call.route === key),
  };
}
