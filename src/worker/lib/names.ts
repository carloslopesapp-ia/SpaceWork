import { normalizeName, validateName } from "../../shared/names";
import { ApiError } from "../errors";

/** Normaliza e valida um nome vindo do pedido; nome inválido é 400 `invalid_name`. */
export function parseName(raw: string): string {
  const name = normalizeName(raw);
  const problem = validateName(name);
  if (problem) throw new ApiError(400, "invalid_name", problem);
  return name;
}
