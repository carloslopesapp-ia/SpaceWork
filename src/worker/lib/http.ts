import type { Context } from "hono";
import { ApiError } from "../errors";
import type { AppEnv } from "../types";

/** Lê o corpo do pedido como um objeto JSON; qualquer outra coisa é 400 `invalid_body`. */
export async function readJsonObject(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "invalid_body", "Corpo do pedido inválido.");
  }
  return body as Record<string, unknown>;
}

/** O valor de `key` se for uma string; senão "". */
export function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}
