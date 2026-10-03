export type Role = "admin" | "user";
export type UserStatus = "active" | "suspended" | "deleting";

/** Utilizador tal como a API o devolve ao frontend. */
export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  quotaBytes: number;
  usedBytes: number;
}

/** Pasta tal como a API a devolve ao frontend. */
export interface FolderItem {
  id: string;
  name: string;
  /** null = pasta na raiz. */
  parentId: string | null;
  createdAt: number;
}

/** Ficheiro pronto (já gravado) tal como a API o devolve ao frontend. */
export interface FileItem {
  id: string;
  name: string;
  /** null = ficheiro na raiz. */
  folderId: string | null;
  size: number;
  mime: string;
  createdAt: number;
}

export interface BreadcrumbItem {
  id: string;
  name: string;
}

/** Conteúdo de uma pasta (ou da raiz, com `folder: null`). */
export interface FolderContents {
  folder: FolderItem | null;
  /** Da raiz até à pasta, inclusive; vazio na raiz. */
  breadcrumb: BreadcrumbItem[];
  folders: FolderItem[];
  files: FileItem[];
}
