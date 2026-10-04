import type { FileItem } from "../shared/types";
import { ApiRequestError, errorFromResponse, networkError } from "./api";

/** Código do erro com que a promessa de um envio cancelado falha. */
export const ABORTED_CODE = "aborted";

export interface UploadHandle {
  promise: Promise<FileItem>;
  /** Cancela o envio; a promessa falha com o código `aborted`. */
  abort: () => void;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null; // resposta sem JSON (ex.: o 413 da própria Cloudflare)
  }
}

function isFileBody(data: unknown): data is { file: FileItem } {
  return typeof data === "object" && data !== null && "file" in data;
}

/**
 * Envia um ficheiro para `PUT /api/files` com `XMLHttpRequest`: o `fetch` não dá o progresso do envio. O nome e a pasta
 * vão no URL, construído com `URLSearchParams` (o servidor decodifica `+` como espaço, por isso um nome com `+` tem de
 * ir como `%2B`). O browser acrescenta sozinho o `Content-Length` (que a API exige) e o `Content-Type` do `File`; sem
 * `Content-Type` a API assume `application/octet-stream`.
 */
export function uploadFile(
  file: File,
  folderId: string | null,
  onProgress: (loaded: number, total: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const query = new URLSearchParams({ name: file.name });
  if (folderId !== null) query.set("folder", folderId);

  const promise = new Promise<FileItem>((resolve, reject) => {
    xhr.open("PUT", `/api/files?${query}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onload = () => {
      const data = parseJson(xhr.responseText);
      if (xhr.status === 201 && isFileBody(data)) resolve(data.file);
      else reject(errorFromResponse(xhr.status, data));
    };
    xhr.onerror = () => reject(networkError());
    xhr.onabort = () => reject(new ApiRequestError(0, ABORTED_CODE, "Envio cancelado."));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
