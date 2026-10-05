import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicShare, ShareItem } from "../shared/types";
import { apiFetch } from "./api";

const sharesKey = (fileId: string) => ["shares", fileId] as const;

/** Os links ativos de um ficheiro (nunca incluem o token: só se vê na criação). */
export function useShares(fileId: string) {
  return useQuery({
    queryKey: sharesKey(fileId),
    queryFn: async () =>
      (await apiFetch<{ shares: ShareItem[] }>(`/api/files/${encodeURIComponent(fileId)}/shares`)).shares,
  });
}

/** Cria um link; a variável é o fim da validade em milissegundos Unix (`null` = sem validade). O `token` só vem nesta resposta. */
export function useCreateShare(fileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (expiresAt: number | null) =>
      apiFetch<{ share: ShareItem; token: string }>(`/api/files/${encodeURIComponent(fileId)}/shares`, {
        method: "POST",
        json: expiresAt === null ? {} : { expiresAt },
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: sharesKey(fileId) }),
  });
}

/** Revoga um link (a variável é o id da partilha): deixa de funcionar logo. */
export function useRevokeShare(fileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => apiFetch(`/api/shares/${encodeURIComponent(shareId)}`, { method: "DELETE" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: sharesKey(fileId) }),
  });
}

/** O que a página pública de um link mostra (o nome e o tamanho do ficheiro). Um link inválido é 404 `share_not_found`. */
export function usePublicShare(token: string) {
  return useQuery({
    queryKey: ["public-share", token],
    queryFn: () => apiFetch<PublicShare>(`/api/public/shares/${encodeURIComponent(token)}`),
  });
}

/** O endereço da página pública de um link, para o dono o enviar a quem quer. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/s/${encodeURIComponent(token)}`;
}

/** O endereço do descarregamento de um link. */
export function shareDownloadUrl(token: string): string {
  return `/api/public/shares/${encodeURIComponent(token)}/download`;
}
