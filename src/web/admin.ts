import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminUser } from "../shared/types";
import { apiFetch } from "./api";
import { ME_KEY } from "./auth";

export const ADMIN_USERS_KEY = ["admin-users"] as const;

/** Todas as contas (só o administrador a pode pedir). `enabled` evita pedi-la a quem não é administrador. */
export function useAdminUsers({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ADMIN_USERS_KEY,
    queryFn: async () => (await apiFetch<{ users: AdminUser[] }>("/api/admin/users")).users,
    enabled,
  });
}

/**
 * Mutação do painel: no fim, com êxito ou não (a lista pode estar velha), refaz a lista de contas e a sessão (o administrador também
 * pode mudar a sua própria quota, que a barra lateral mostra).
 */
function useAdminMutation<Variables, Data = void>(mutationFn: (variables: Variables) => Promise<Data>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ADMIN_USERS_KEY }),
        queryClient.invalidateQueries({ queryKey: ME_KEY }),
      ]),
  });
}

/** Muda a quota (em bytes) e/ou o estado (`active` ou `suspended`) de uma conta. */
export function useUpdateUser() {
  return useAdminMutation(({ id, ...changes }: { id: string; quotaBytes?: number; status?: "active" | "suspended" }) =>
    apiFetch<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", json: changes }),
  );
}

/** Apaga uma conta: passa a «em remoção» e o cron elimina-a (os ficheiros e o utilizador) na hora seguinte. */
export function useDeleteUser() {
  return useAdminMutation((id: string) => apiFetch(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" }));
}
