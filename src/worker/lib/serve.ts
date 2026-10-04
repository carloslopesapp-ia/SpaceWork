import { ApiError } from "../errors";
import { contentDisposition } from "./files";

/** O ficheiro existe na D1 mas o R2 não tem o objeto: fica registado e a resposta é 404 `file_missing`. */
export function missingObject(fileId: string): ApiError {
  console.error(`O ficheiro ${fileId} existe na D1 mas não tem objeto no R2.`);
  return new ApiError(404, "file_missing", "O conteúdo do ficheiro não está disponível.");
}

/** Resposta de descarga: o conteúdo em *stream*, sempre como anexo (nunca é interpretado pelo browser). */
export function attachmentResponse(object: R2ObjectBody, file: { name: string; mime: string }): Response {
  return new Response(object.body, {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(object.size),
      "Content-Disposition": contentDisposition("attachment", file.name),
      ETag: object.httpEtag,
    },
  });
}
