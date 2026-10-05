import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { FileItem, TrashContents } from "../shared/types";
import { apiFetch } from "./api";
import { TRASH_KEY, useRefreshSpace, useSpaceMutation } from "./space";

/** A lixeira: no máximo os 200 ficheiros mais recentes; `total` conta todos. */
export function useTrash() {
  return useQuery({ queryKey: TRASH_KEY, queryFn: () => apiFetch<TrashContents>("/api/trash") });
}

/** Restaura um ficheiro (o servidor acrescenta " (restaurado)" ao nome se já existir um igual no destino). */
export function useRestoreFile() {
  return useSpaceMutation((id: string) =>
    apiFetch<{ file: FileItem }>(`/api/trash/${encodeURIComponent(id)}/restore`, { method: "POST" }),
  );
}

/** Elimina um ficheiro de vez (devolve o espaço). */
export function usePurgeFile() {
  return useSpaceMutation((id: string) => apiFetch(`/api/trash/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

export interface EmptyTrashResult {
  purged: number;
  /** Ficheiros que ficaram: só é maior do que 0 se o servidor deixou de conseguir eliminar. */
  remaining: number;
}

/**
 * Esvazia a lixeira. O servidor elimina um bloco de cada vez (`DELETE /api/trash` responde `{ purged, remaining }`):
 * repete-se até não ficar nenhum ou até um pedido não eliminar nada (outro pedido mexeu na lixeira, ou algo falha).
 * `purged` é o que já foi eliminado, para mostrar o progresso.
 */
export function useEmptyTrash() {
  const refresh = useRefreshSpace();
  const [purged, setPurged] = useState(0);
  const mutation = useMutation({
    mutationFn: async (): Promise<EmptyTrashResult> => {
      let total = 0;
      setPurged(0);
      for (;;) {
        const step = await apiFetch<EmptyTrashResult>("/api/trash", { method: "DELETE" });
        total += step.purged;
        setPurged(total);
        if (step.remaining === 0 || step.purged === 0) return { purged: total, remaining: step.remaining };
      }
    },
    onSettled: () => refresh(),
  });
  return { ...mutation, purged };
}
