import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Erro esperado da API: vira `{ "error": <code>, "message": <message> }` com o estado HTTP indicado. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** A D1 reporta violações de unicidade como "D1_ERROR: UNIQUE constraint failed: ...". */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

/** A D1 reporta violações de chave estrangeira como "D1_ERROR: FOREIGN KEY constraint failed: ...". */
export function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Error && /FOREIGN KEY constraint failed/i.test(error.message);
}
