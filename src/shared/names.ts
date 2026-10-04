// Regras dos nomes de pastas e ficheiros (spec, secção 3). Sem imports: é usado no Worker e no browser.

export const NAME_MAX_LENGTH = 255;

/** Normaliza um nome vindo do utilizador: Unicode NFC e sem espaços nas pontas. */
export function normalizeName(raw: string): string {
  return raw.normalize("NFC").trim();
}

// Controlos C0 e C1 (incluindo o DEL) e os de direção do texto (ALM, LRM, RLM, LRE..RLO, LRI..PDI): com eles
// "ab\u202etxt.exe" apareceria no ecrã como "abexe.txt". Os surrogates isolados não são texto válido (a D1
// grava-os como U+FFFD e a resposta e a base ficariam diferentes); com a flag `u` só apanha os isolados.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const LONE_SURROGATE = /[\ud800-\udfff]/u;

/** Mensagem de erro (em português) para um nome já normalizado, ou null se o nome é válido. */
export function validateName(name: string): string | null {
  if (name.length === 0) return "O nome não pode estar vazio.";
  if (name.length > NAME_MAX_LENGTH) {
    return `O nome não pode ter mais de ${NAME_MAX_LENGTH} caracteres.`;
  }
  if (name === "." || name === "..") return "Nome inválido.";
  if (name.includes("/")) return "O nome não pode conter a barra (/).";
  if (CONTROL_CHARACTERS.test(name)) return "O nome não pode conter caracteres de controlo.";
  if (LONE_SURROGATE.test(name)) return "O nome contém caracteres Unicode inválidos.";
  return null;
}

/** Chave de pesquisa: minúsculas e sem acentos ("Relatório.PDF" -> "relatorio.pdf"). */
export function searchKey(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().normalize("NFC");
}
