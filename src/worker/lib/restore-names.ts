import { NAME_MAX_LENGTH } from "../../shared/names";

/** Tentativas ao restaurar um ficheiro cujo nome já está ocupado: o nome original e nove com sufixo. */
export const RESTORE_ATTEMPTS = 10;

/** Corta `text` a `max` unidades UTF-16 sem partir um par de substituição (um emoji conta 2). */
function truncateUnits(text: string, max: number): string {
  let result = "";
  for (const char of text) {
    if (result.length + char.length > max) break;
    result += char;
  }
  return result;
}

/**
 * Os nomes que o restauro experimenta, por ordem: o original, depois " (restaurado)", " (restaurado 2)", ... Todos cabem em
 * `NAME_MAX_LENGTH`: se for preciso, o nome original é cortado para o sufixo caber.
 */
export function restoreCandidates(name: string): string[] {
  const candidates = [name];
  for (let attempt = 1; attempt < RESTORE_ATTEMPTS; attempt++) {
    const suffix = attempt === 1 ? " (restaurado)" : ` (restaurado ${attempt})`;
    candidates.push(truncateUnits(name, NAME_MAX_LENGTH - suffix.length) + suffix);
  }
  return candidates;
}
