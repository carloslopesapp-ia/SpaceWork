import type { ShareItem } from "../../shared/types";
import { ApiError } from "../errors";

/** Links ativos por ficheiro: um teto simples contra linhas a mais (as contas abertas não têm outro limite). */
export const MAX_ACTIVE_SHARES_PER_FILE = 20;

/** Teto da validade: a interface formata a data com `Intl`, que lança acima de 8,64e15 ms; 100 anos ficam muito aquém e chegam para qualquer validade razoável. */
const HUNDRED_YEARS_MS = 100 * 365 * 86_400_000;

/** Colunas de `shares` tal como vêm da D1. */
export interface ShareRow {
  id: string;
  file_id: string;
  created_at: number;
  expires_at: number | null;
}

export const SHARE_COLUMNS = "id, file_id, created_at, expires_at";

export function rowToShare(row: ShareRow): ShareItem {
  return { id: row.id, fileId: row.file_id, createdAt: row.created_at, expiresAt: row.expires_at };
}

/** Condição SQL "a partilha `alias` está ativa": não revogada e não expirada; `now` é o parâmetro (ex.: "?3") com o instante atual. */
export function activeShare(alias: string, now: string): string {
  return `${alias}.revoked_at IS NULL AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > ${now})`;
}

/** O `expiresAt` do pedido: ausente ou null = sem validade; senão um instante no futuro, até 100 anos (milissegundos Unix). */
export function parseExpiry(value: unknown, now: number): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= now || value > now + HUNDRED_YEARS_MS) {
    throw new ApiError(400, "invalid_expiry", "A validade tem de ser um instante no futuro.");
  }
  return value;
}
