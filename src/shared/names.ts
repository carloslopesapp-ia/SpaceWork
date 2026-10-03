// Regras dos nomes de pastas e ficheiros (spec, secção 3). Sem imports: é usado no Worker e no browser.

export const NAME_MAX_LENGTH = 255;

/** Normaliza um nome vindo do utilizador: Unicode NFC e sem espaços nas pontas. */
export function normalizeName(raw: string): string {
  return raw.normalize("NFC").trim();
}

/** Mensagem de erro (em português) para um nome já normalizado, ou null se o nome é válido. */
export function validateName(name: string): string | null {
  if (name.length === 0) return "O nome não pode estar vazio.";
  if (name.length > NAME_MAX_LENGTH) {
    return `O nome não pode ter mais de ${NAME_MAX_LENGTH} caracteres.`;
  }
  if (name === "." || name === "..") return "Nome inválido.";
  if (name.includes("/")) return "O nome não pode conter a barra (/).";
  if (/[\u0000-\u001f\u007f]/.test(name)) return "O nome não pode conter caracteres de controlo.";
  return null;
}

/** Chave de pesquisa: minúsculas e sem acentos ("Relatório.PDF" -> "relatorio.pdf"). */
export function searchKey(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().normalize("NFC");
}
