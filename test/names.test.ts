import { describe, expect, it } from "vitest";
import { NAME_MAX_LENGTH, normalizeName, searchKey, validateName } from "../src/shared/names";

// Os nomes com acentos decompostos (NFD) escrevem-se com escapes: um editor podia compô-los sem avisar.
const RELATORIO_NFD = "Relato\u0301rio"; // o + acento agudo combinado
const RELATORIO_NFC = "Relatório"; // ó

describe("normalizeName", () => {
  it("remove espaços nas pontas e passa para Unicode NFC", () => {
    expect(normalizeName("  Relatório  ")).toBe("Relatório");
    expect(RELATORIO_NFD).not.toBe(RELATORIO_NFD.normalize("NFC")); // guarda: o literal tem de continuar decomposto
    expect(normalizeName(RELATORIO_NFD)).toBe(RELATORIO_NFC);
  });

  it("o trim também tira o NBSP e o BOM das pontas, mas não do meio (comportamento atual)", () => {
    expect(normalizeName(" a\ufeff")).toBe("a");
    expect(normalizeName("\u00a0a\u00a0")).toBe("a");
    expect(normalizeName("a\u00a0b")).toBe("a\u00a0b");
    expect(validateName(normalizeName("a\u00a0b"))).toBeNull();
  });
});

describe("validateName", () => {
  it("aceita nomes normais, com espaços, acentos, pontos e emojis", () => {
    for (const name of ["Fotos", "Relatório final 2026.pdf", ".gitignore", "a", "férias 🏖️"]) {
      expect(validateName(name)).toBeNull();
    }
  });

  it("rejeita nomes vazios", () => {
    expect(validateName("")).toBe("O nome não pode estar vazio.");
  });

  it("rejeita nomes com mais de 255 caracteres e aceita exatamente 255", () => {
    expect(validateName("a".repeat(NAME_MAX_LENGTH))).toBeNull();
    expect(validateName("a".repeat(NAME_MAX_LENGTH + 1))).toMatch(/mais de 255/);
  });

  it("conta o limite em unidades UTF-16: um emoji vale 2", () => {
    expect(validateName("🏖".repeat(127) + "a")).toBeNull(); // 254 + 1 = 255
    expect(validateName("🏖".repeat(128))).toMatch(/mais de 255/); // 256
  });

  it("rejeita '.' e '..'", () => {
    expect(validateName(".")).toBe("Nome inválido.");
    expect(validateName("..")).toBe("Nome inválido.");
  });

  it("rejeita a barra e os caracteres de controlo", () => {
    expect(validateName("a/b")).toMatch(/barra/);
    expect(validateName("a\u0000b")).toMatch(/controlo/);
    expect(validateName("a\nb")).toMatch(/controlo/);
    expect(validateName("a\u007fb")).toMatch(/controlo/);
  });

  it("rejeita os controlos C0 e C1 e aceita o que está logo ao lado dos limites", () => {
    expect(validateName("a\u001fb")).toMatch(/controlo/); // último C0
    expect(validateName("a b")).toBeNull(); // U+0020, o espaço
    expect(validateName("a\u0080b")).toMatch(/controlo/); // primeiro C1
    expect(validateName("a\u009fb")).toMatch(/controlo/); // último C1
    expect(validateName("a\u00a0b")).toBeNull(); // U+00A0, o NBSP
  });

  it("rejeita os controlos de direção do texto (um nome como 'ab\\u202etxt.exe' apareceria no ecrã como 'abexe.txt')", () => {
    for (const char of ["\u061c", "\u200e", "\u200f", "\u202a", "\u202b", "\u202c", "\u202d", "\u202e", "\u2066", "\u2067", "\u2068", "\u2069"]) {
      expect(validateName(`ab${char}txt.exe`), `U+${char.codePointAt(0)?.toString(16)}`).toMatch(/controlo/);
    }
    expect(validateName("a\u200db")).toBeNull(); // o ZWJ (emojis compostos) não é um controlo de direção
  });

  it("rejeita surrogates isolados (a D1 gravava-os como U+FFFD) e aceita pares válidos", () => {
    for (const name of ["\ud800", "a\ud800b", "a\udfffb", "a\udfd6\ud83cb", "ab\ud83c"]) {
      expect(validateName(name), JSON.stringify(name)).toMatch(/inválidos/);
    }
    expect(validateName("a🏖b")).toBeNull(); // 🏖 como par substituto válido
  });
});

describe("searchKey", () => {
  it("põe em minúsculas e tira os acentos", () => {
    expect(searchKey("Relatório.PDF")).toBe("relatorio.pdf");
    expect(searchKey("Ação Çedilha")).toBe("acao cedilha");
  });

  it("dá a mesma chave para texto composto e decomposto", () => {
    expect(RELATORIO_NFD).not.toBe(RELATORIO_NFD.normalize("NFC")); // guarda: o literal tem de continuar decomposto
    expect(searchKey(RELATORIO_NFD)).toBe(searchKey(RELATORIO_NFC));
    expect(searchKey(RELATORIO_NFD)).toBe("relatorio");
  });
});
