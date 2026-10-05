import { env } from "cloudflare:workers";
import type { FileItem } from "../src/shared/types";
import { fetchWithEnv } from "./db-helpers";
import { ORIGIN, api } from "./helpers";

interface UploadOptions {
  folder?: string | null;
  /** Content-Type do pedido; por defeito text/plain. */
  type?: string;
  headers?: Record<string, string>;
}

/** Faz upload de um ficheiro (texto ou bytes) pela API e devolve a resposta tal como veio. */
export function uploadFile(
  cookie: string,
  name: string,
  content: string | Uint8Array,
  options: UploadOptions = {},
): Promise<Response> {
  const body = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const query = new URLSearchParams({ name });
  if (options.folder) query.set("folder", options.folder);
  return api(`/api/files?${query}`, {
    method: "PUT",
    cookie,
    body,
    headers: { "Content-Type": options.type ?? "text/plain", ...options.headers },
  });
}

/** Como `uploadFile`, mas falha o teste se não der 201 e devolve o ficheiro criado. */
export async function uploadOk(
  cookie: string,
  name: string,
  content: string | Uint8Array,
  options: UploadOptions = {},
): Promise<FileItem> {
  const res = await uploadFile(cookie, name, content, options);
  if (res.status !== 201) throw new Error(`uploadOk falhou: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { file: FileItem }).file;
}

/** Bytes usados pelo utilizador, lidos de `/api/auth/me`. */
export async function usedBytes(cookie: string): Promise<number> {
  const res = await api("/api/auth/me", { cookie });
  return ((await res.json()) as { user: { usedBytes: number } }).user.usedBytes;
}

export async function setQuota(userId: string, quotaBytes: number): Promise<void> {
  await env.DB.prepare("UPDATE users SET quota_bytes = ?1 WHERE id = ?2").bind(quotaBytes, userId).run();
}

export async function countFiles(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM files").first<{ n: number }>();
  return row?.n ?? 0;
}

/** Lê o corpo de uma resposta como texto UTF-8 sem o aviso do workerd para tipos binários (PNG, PDF...). */
export async function bodyText(res: Response): Promise<string> {
  return new TextDecoder().decode(await res.arrayBuffer());
}

/** Insere uma linha em `files` por SQL direto (sem passar pela API); devolve o id. */
export async function insertFileRow(
  userId: string,
  folderId: string | null,
  options: { name?: string; status?: string; deletedAt?: number | null } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at, deleted_at)
     VALUES (?1, ?2, ?3, ?4, ?4, 1, 'text/plain', ?5, ?6, 1, ?7)`,
  )
    .bind(
      id,
      userId,
      folderId,
      options.name ?? "a.txt",
      `u/${userId}/${id}`,
      options.status ?? "ready",
      options.deletedAt ?? null,
    )
    .run();
  return id;
}

/**
 * Faz um upload chamando a app diretamente com bindings/variáveis alterados (o resto vem de `env`). O Content-Length tem de ser posto
 * à mão (`lengthHeader: null` omite-o).
 */
export function rawUpload(
  name: string,
  body: Uint8Array,
  cookie: string,
  override: Record<string, unknown>,
  lengthHeader: string | null = String(body.length),
): Promise<Response> {
  const request = new Request(`${ORIGIN}/api/files?name=${name}`, {
    method: "PUT",
    body,
    headers: {
      Origin: ORIGIN,
      Cookie: cookie,
      "Content-Type": "application/octet-stream",
      ...(lengthHeader === null ? {} : { "Content-Length": lengthHeader }),
    },
  });
  return fetchWithEnv(request, override);
}

export interface SeedFile {
  id: string;
  size?: number;
  status?: "ready" | "pending";
  /** Na lixeira desde este instante. */
  deletedAt?: number;
  /** Criado neste instante (por defeito 1, ou seja, há muito tempo). */
  createdAt?: number;
}

/** Insere linhas em `files` com o objeto no R2 e soma os tamanhos à quota do dono (como o upload e a lixeira deixam o estado). */
export async function seedFiles(userId: string, files: SeedFile[]): Promise<void> {
  await env.DB.batch([
    ...files.map((file) =>
      env.DB.prepare(
        `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at, deleted_at)
         VALUES (?1, ?2, NULL, ?1, ?1, ?3, 'text/plain', ?4, ?5, ?7, ?6)`,
      ).bind(
        file.id,
        userId,
        file.size ?? 10,
        `u/${userId}/${file.id}`,
        file.status ?? "ready",
        file.deletedAt ?? null,
        file.createdAt ?? 1,
      ),
    ),
    env.DB.prepare("UPDATE users SET used_bytes = used_bytes + ?1 WHERE id = ?2").bind(
      files.reduce((sum, file) => sum + (file.size ?? 10), 0),
      userId,
    ),
  ]);
  await Promise.all(files.map((file) => env.FILES.put(`u/${userId}/${file.id}`, "x")));
}
