import { describe, expect, it } from "vitest";
import { NAME_MAX_LENGTH, normalizeName, searchKey, validateName } from "../src/shared/names";

describe("normalizeName", () => {
  it("remove espaços nas pontas e passa para Unicode NFC", () => {
    expect(normalizeName("  Relatório  ")).toBe("Relatório");
    const decomposed = "Relatório"; // o + acento combinado
    const composed = "Relatório";
    expect(decomposed).not.toBe(composed);
    expect(normalizeName(decomposed)).toBe(composed);
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
});

describe("searchKey", () => {
  it("põe em minúsculas e tira os acentos", () => {
    expect(searchKey("Relatório.PDF")).toBe("relatorio.pdf");
    expect(searchKey("Ação Çedilha")).toBe("acao cedilha");
  });

  it("dá a mesma chave para texto composto e decomposto", () => {
    expect(searchKey("Relatório")).toBe(searchKey("Relatório"));
  });
});
