import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(ME_KEY, null);
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (values: { currentPassword: string; newPassword: string }) =>
      apiFetch("/api/auth/password", { method: "POST", json: values }),
  });
}
