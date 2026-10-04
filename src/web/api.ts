export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const NETWORK_ERROR_MESSAGE = "Sem ligação ao servidor. Verifique a internet e tente novamente.";

/** Mensagem para uma resposta de erro sem o JSON da API (ex.: o 413 da própria Cloudflare ou um 502). */
export function fallbackMessage(status: number): string {
  if (status === 413) return "O ficheiro é demasiado grande.";
  if (status >= 500) return "Erro do servidor. Tente novamente dentro de instantes.";
  return "Ocorreu um erro. Tente novamente.";
}

let onUnauthorized: (() => void) | null = null;

/** Regista o que fazer quando a sessão deixa de valer (resposta 401 `unauthorized`); ver `createQueryClient`. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** O erro de uma resposta falhada; `data` é o JSON da resposta (ou null). Avisa o handler se a sessão expirou. */
export function errorFromResponse(status: number, data: unknown): ApiRequestError {
  const body = (data ?? {}) as { error?: unknown; message?: unknown };
  const code = typeof body.error === "string" ? body.error : "unknown_error";
  const message = typeof body.message === "string" ? body.message : fallbackMessage(status);
  if (code === "unauthorized") onUnauthorized?.();
  return new ApiRequestError(status, code, message);
}

export function networkError(): ApiRequestError {
  return new ApiRequestError(0, "network_error", NETWORK_ERROR_MESSAGE);
}

/** Texto para mostrar ao utilizador a partir de qualquer erro apanhado (as mutações guardam-no como `unknown`). */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : fallbackMessage(0);
}

interface RequestOptions {
  method?: string;
  json?: unknown;
}

/** Chama a API. Devolve o JSON da resposta, `undefined` em 204, e lança `ApiRequestError` em erros. */
export async function apiFetch<T = void>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body,
      credentials: "same-origin",
    });
  } catch {
    throw networkError();
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw errorFromResponse(response.status, data);
  return data as T;
}
