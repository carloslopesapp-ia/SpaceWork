import { describe, expect, it } from "vitest";
import { isValidEmail, isValidPassword, normalizeEmail } from "../src/shared/validation";

describe("normalizeEmail", () => {
  it("remove espaços e passa para minúsculas", () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });
});

describe("isValidEmail", () => {
  it("aceita emails normais", () => {
    expect(isValidEmail("ana@example.com")).toBe(true);
    expect(isValidEmail("ana.silva+drive@mail.example.pt")).toBe(true);
  });

  it("rejeita emails sem arroba, sem domínio ou com espaços", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("ana")).toBe(false);
    expect(isValidEmail("ana@")).toBe(false);
    expect(isValidEmail("ana@example")).toBe(false);
    expect(isValidEmail("a na@example.com")).toBe(false);
  });

  it("rejeita emails com mais de 254 caracteres", () => {
    expect(isValidEmail(`${"a".repeat(250)}@b.co`)).toBe(false);
    expect(isValidEmail(`${"a".repeat(240)}@b.co`)).toBe(true);
  });
});

describe("isValidPassword", () => {
  it("exige entre 8 e 128 caracteres", () => {
    expect(isValidPassword("1234567")).toBe(false);
    expect(isValidPassword("12345678")).toBe(true);
    expect(isValidPassword("x".repeat(128))).toBe(true);
    expect(isValidPassword("x".repeat(129))).toBe(false);
  });
});
