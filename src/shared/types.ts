export type Role = "admin" | "user";
export type UserStatus = "active" | "suspended" | "deleting";

/** Utilizador tal como a API o devolve ao frontend. */
export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  quotaBytes: number;
  usedBytes: number;
  /** Só para um administrador: quantas contas aguardam a sua aprovação (registo por aprovação). */
  pendingApprovals?: number;
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

/** Limites do servidor que o browser precisa de conhecer (`GET /api/config`). */
export interface ClientConfig {
  /** Tamanho máximo de um ficheiro, em bytes. */
  maxUploadBytes: number;
}

/** Resultado de uma pesquisa por nome; `path` é o caminho da pasta onde o item está (vazio = raiz). */
export type SearchResult = { path: BreadcrumbItem[] } & (
  | { kind: "folder"; folder: FolderItem }
  | { kind: "file"; file: FileItem }
);

/** Ficheiro na lixeira. */
export interface TrashItem {
  id: string;
  name: string;
  size: number;
  mime: string;
  /** Pasta onde estava (null = raiz) e o caminho até lá. */
  folderId: string | null;
  path: BreadcrumbItem[];
  deletedAt: number;
  /** Quando o cron o elimina de vez: `deletedAt` mais os dias de retenção. */
  purgeAt: number;
}

/** A lixeira (`GET /api/trash`): os mais recentes primeiro, no máximo 200; `total` conta todos. */
export interface TrashContents {
  items: TrashItem[];
  total: number;
  retentionDays: number;
}

/** Um link de partilha ativo (nunca inclui o token, que só se mostra na criação). */
export interface ShareItem {
  id: string;
  fileId: string;
  createdAt: number;
  /** null = sem validade. */
  expiresAt: number | null;
}

/** O que a página pública de um link mostra. */
export interface PublicShare {
  name: string;
  size: number;
}

/** Uma conta tal como o painel de administração a vê (nunca inclui a senha). */
export interface AdminUser {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  quotaBytes: number;
  usedBytes: number;
  createdAt: number;
}
