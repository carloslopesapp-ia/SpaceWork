import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminUser } from "../shared/types";
import { isValidQuota, MAX_QUOTA_BYTES } from "../shared/validation";
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

/** Muda a quota (em bytes) e/ou o estado (`active` ou `suspended`) de uma conta, ou aprova-a (`approved: true`; a aprovação não se desfaz). */
export function useUpdateUser() {
  return useAdminMutation(({ id, ...changes }: { id: string; quotaBytes?: number; status?: "active" | "suspended"; approved?: true }) =>
    apiFetch<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", json: changes }),
  );
}

/**
 * Apaga uma conta: passa a «em remoção» e o cron elimina-a (os ficheiros e o utilizador) na hora seguinte. Uma conta por aprovar
 * (rejeitar o pedido) apaga-se logo, porque não tem ficheiros.
 */
export function useDeleteUser() {
  return useAdminMutation((id: string) => apiFetch(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

const GB = 1024 ** 3;
/** A quota máxima em GB (1 PiB), para a mensagem de erro. */
const MAX_QUOTA_GB = MAX_QUOTA_BYTES / GB;

/** A quota que o administrador escreveu, em GB (com vírgula ou ponto), em bytes; `null` se não for um número entre 0 e o máximo. */
export function parseQuotaGb(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const bytes = Math.round(Number(normalized) * GB);
  return isValidQuota(bytes) ? bytes : null;
}

/** A quota em GB para o campo de texto, com vírgula e no máximo duas casas decimais (1073741824 -> "1", 1610612736 -> "1,5"). */
export function quotaToGbText(bytes: number): string {
  return String(Math.round((bytes / GB) * 100) / 100).replace(".", ",");
}

export const QUOTA_HINT = `Indique a quota em GB, um número de 0 a ${MAX_QUOTA_GB} (por exemplo 1,5).`;
