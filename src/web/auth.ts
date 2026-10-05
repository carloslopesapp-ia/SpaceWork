import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { PublicUser } from "../shared/types";
import { ApiRequestError, apiFetch } from "./api";

export const ME_KEY = ["me"] as const;

interface Credentials {
  email: string;
  password: string;
}

/** O utilizador da sessão, ou `null` quando não há sessão (401). */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<PublicUser | null> => {
      try {
        return (await apiFetch<{ user: PublicUser }>("/api/auth/me")).user;
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 30_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: Credentials) =>
      apiFetch<{ user: PublicUser }>("/api/auth/login", { method: "POST", json: credentials }),
    onSuccess: ({ user }) => queryClient.setQueryData(ME_KEY, user),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: Credentials) =>
      apiFetch<{ user: PublicUser }>("/api/auth/register", { method: "POST", json: credentials }),
    onSuccess: ({ user }) => queryClient.setQueryData(ME_KEY, user),
  });
}

/**
 * Fim de sessão (terminar a sessão ou um 401): esquece tudo o que era da conta e deixa a sessão a `null`.
 * Não usa `clear()`, que tirava a consulta da sessão da cache e só quem voltasse a renderizar dava pela nova; faz à mão o que ele
 * garantia: cancela um pedido da sessão ainda a decorrer (uma resposta tardia repunha o utilizador por cima do `null`) e esvazia
 * a cache das mutações (guarda as variáveis do login e da troca de senha, e o token de uma partilha, durante o `gcTime`).
 */
export function forgetAccount(client: QueryClient): void {
  void client.cancelQueries({ queryKey: ME_KEY });
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] });
  client.getMutationCache().clear();
  client.setQueryData(ME_KEY, null);
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/api/auth/logout", { method: "POST" }),
    // Ver forgetAccount.
    onSuccess: () => forgetAccount(queryClient),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (values: { currentPassword: string; newPassword: string }) =>
      apiFetch("/api/auth/password", { method: "POST", json: values }),
  });
}
