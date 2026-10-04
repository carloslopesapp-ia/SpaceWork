import type { FolderItem } from "../shared/types";

export const ROOT_LABEL = "Meu espaço";

/** Uma linha do seletor de pastas: a raiz (`id: null`) ou uma pasta, com o nível de recuo. */
export interface FolderOption {
  id: string | null;
  name: string;
  depth: number;
}

function childrenByParent(folders: FolderItem[]): Map<string | null, FolderItem[]> {
  const children = new Map<string | null, FolderItem[]>();
  for (const folder of folders) {
    const siblings = children.get(folder.parentId);
    if (siblings) siblings.push(folder);
    else children.set(folder.parentId, [folder]);
  }
  return children;
}

/** O id da pasta e os de todas as suas descendentes (as pastas que não podem ser o destino de um movimento dela). */
export function subtreeIds(folders: FolderItem[], folderId: string): Set<string> {
  const children = childrenByParent(folders);
  const found = new Set<string>();
  const pending = [folderId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (found.has(id)) continue; // protege contra um ciclo
    found.add(id);
    for (const child of children.get(id) ?? []) pending.push(child.id);
  }
  return found;
}

/**
 * A raiz seguida de todas as pastas em pré-ordem (cada pasta antes das suas subpastas), cada uma com o seu nível.
 * A ordem entre irmãs é a da lista recebida (a API já a manda por nome, sem acentos).
 */
export function folderOptions(folders: FolderItem[]): FolderOption[] {
  const children = childrenByParent(folders);
  const options: FolderOption[] = [{ id: null, name: ROOT_LABEL, depth: 0 }];
  const seen = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of children.get(parentId) ?? []) {
      if (seen.has(folder.id)) continue; // protege contra um ciclo
      seen.add(folder.id);
      options.push({ id: folder.id, name: folder.name, depth });
      visit(folder.id, depth + 1);
    }
  };
  visit(null, 1);
  return options;
}
