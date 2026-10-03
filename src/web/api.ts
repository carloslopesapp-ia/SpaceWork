export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
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
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body,
    credentials: "same-origin",
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      data?.error ?? "unknown_error",
      data?.message ?? "Ocorreu um erro. Tente novamente.",
    );
  }
  return data as T;
}
