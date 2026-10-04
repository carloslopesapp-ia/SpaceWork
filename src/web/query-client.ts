import { QueryClient } from "@tanstack/react-query";
import { ApiRequestError, setUnauthorizedHandler } from "./api";
import { ME_KEY } from "./auth";

/** Repete só falhas de rede e erros 5xx, no máximo duas vezes: um 404 ou um 409 não se resolvem a repetir. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const clientError = error instanceof ApiRequestError && error.status >= 400 && error.status < 500;
  return failureCount < 2 && !clientError;
}

export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: shouldRetry } },
  });
  // Sessão expirada (401 `unauthorized` em qualquer pedido): esquece os dados da conta e deixa o layout
  // redirecionar para o login (o AppLayout vê `me === null`).
  setUnauthorizedHandler(() => {
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] });
    client.setQueryData(ME_KEY, null);
  });
  return client;
}
