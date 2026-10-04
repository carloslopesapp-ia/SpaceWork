import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClientConfig, FileItem, FolderContents, FolderItem } from "../shared/types";
import { apiFetch } from "./api";
import { ME_KEY } from "./auth";

const FOLDER = "folder";

/** Chave da listagem de uma pasta (`null` = a raiz). */
export const folderKey = (folderId: string | null) => [FOLDER, folderId ?? "root"] as const;
export const TREE_KEY = ["tree"] as const;
export const CONFIG_KEY = ["config"] as const;

export function useContents(folderId: string | null) {
  return useQuery({
    queryKey: folderKey(folderId),
    queryFn: () => apiFetch<FolderContents>(`/api/folders/${encodeURIComponent(folderId ?? "root")}/contents`),
  });
}

/** Todas as pastas do utilizador, para o diálogo "Mover". */
export function useTree() {
  return useQuery({
    queryKey: TREE_KEY,
    queryFn: async () => (await apiFetch<{ folders: FolderItem[] }>("/api/folders/tree")).folders,
  });
}

/** Os limites do servidor (não mudam durante a sessão). */
export function useConfig() {
  return useQuery({
    queryKey: CONFIG_KEY,
    queryFn: () => apiFetch<ClientConfig>("/api/config"),
    staleTime: Infinity,
  });
}

/**
 * Depois de qualquer alteração ao espaço: as pastas listadas, a árvore do diálogo "Mover" e a quota usada
 * (barra lateral) ficam desatualizadas. Devolve a função que as invalida.
 */
export function useRefreshSpace() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [FOLDER] }),
      queryClient.invalidateQueries({ queryKey: TREE_KEY }),
      queryClient.invalidateQueries({ queryKey: ME_KEY }),
    ]);
}

/** Mutação que atualiza o resto da interface quando termina, com êxito ou não (um erro pode vir de dados já velhos). */
function useSpaceMutation<Variables, Data = void>(mutationFn: (variables: Variables) => Promise<Data>) {
  const refresh = useRefreshSpace();
  return useMutation({ mutationFn, onSettled: () => refresh() });
}

export function useCreateFolder() {
  return useSpaceMutation((values: { name: string; parentId: string | null }) =>
    apiFetch<{ folder: FolderItem }>("/api/folders", { method: "POST", json: values }),
  );
}

/** Renomeia e/ou move uma pasta (`parentId: null` = raiz). */
export function useUpdateFolder() {
  return useSpaceMutation(({ id, ...changes }: { id: string; name?: string; parentId?: string | null }) =>
    apiFetch<{ folder: FolderItem }>(`/api/folders/${encodeURIComponent(id)}`, { method: "PATCH", json: changes }),
  );
}

export function useDeleteFolder() {
  return useSpaceMutation((id: string) =>
    apiFetch(`/api/folders/${encodeURIComponent(id)}`, { method: "DELETE" }),
  );
}

/** Renomeia e/ou move um ficheiro (`folderId: null` = raiz). */
export function useUpdateFile() {
  return useSpaceMutation(({ id, ...changes }: { id: string; name?: string; folderId?: string | null }) =>
    apiFetch<{ file: FileItem }>(`/api/files/${encodeURIComponent(id)}`, { method: "PATCH", json: changes }),
  );
}

/** Exclui um ficheiro (vai para a lixeira). */
export function useDeleteFile() {
  return useSpaceMutation((id: string) =>
    apiFetch(`/api/files/${encodeURIComponent(id)}`, { method: "DELETE" }),
  );
}
