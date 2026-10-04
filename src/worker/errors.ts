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

/**
 * Num `catch` à volta de uma escrita na D1: converte a violação de unicidade e/ou a de chave estrangeira
 * nos erros indicados; qualquer outro erro (ou uma violação sem correspondência) é relançado tal como veio.
 */
export function rethrowConstraint(
  error: unknown,
  mapping: { unique?: ApiError; foreignKey?: ApiError },
): never {
  if (mapping.unique && isUniqueViolation(error)) throw mapping.unique;
  if (mapping.foreignKey && isForeignKeyViolation(error)) throw mapping.foreignKey;
  throw error;
}
