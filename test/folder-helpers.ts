import type { FolderContents, FolderItem } from "../src/shared/types";
import { api } from "./helpers";

/** Cria uma pasta pela API; falha o teste se não der 201. */
export async function createFolder(
  cookie: string,
  name: string,
  parentId: string | null = null,
): Promise<FolderItem> {
  const res = await api("/api/folders", { method: "POST", cookie, json: { name, parentId } });
  if (res.status !== 201) throw new Error(`createFolder falhou: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { folder: FolderItem }).folder;
}

/** Lista o conteúdo de uma pasta (ou da raiz, com "root"); falha o teste se não der 200. */
export async function getContents(cookie: string, folderId = "root"): Promise<FolderContents> {
  const res = await api(`/api/folders/${folderId}/contents`, { cookie });
  if (res.status !== 200) throw new Error(`getContents falhou: ${res.status} ${await res.text()}`);
  return (await res.json()) as FolderContents;
}
