import { describe, expect, it } from "vitest";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  PBKDF2_ITERATIONS,
  randomToken,
  sha256Hex,
  verifyPassword,
} from "../src/worker/lib/crypto";

describe("hashPassword / verifyPassword", () => {
  it("gera o formato pbkdf2-sha256$<iterações>$<salt>$<hash>", async () => {
    const hash = await hashPassword("senha-segura-123");
    const parts = hash.split("$");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("pbkdf2-sha256");
    expect(parts[1]).toBe(String(PBKDF2_ITERATIONS));
    expect(PBKDF2_ITERATIONS).toBe(100_000);
    expect(atob(parts[2])).toHaveLength(16);
    expect(atob(parts[3])).toHaveLength(32);
  });

  it("aceita a senha certa e rejeita a errada", async () => {
    const hash = await hashPassword("senha-segura-123");
    expect(await verifyPassword("senha-segura-123", hash)).toBe(true);
    expect(await verifyPassword("senha-segura-124", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("usa um salt diferente de cada vez", async () => {
    const a = await hashPassword("mesma-senha");
    const b = await hashPassword("mesma-senha");
    expect(a).not.toBe(b);
    expect(await verifyPassword("mesma-senha", a)).toBe(true);
    expect(await verifyPassword("mesma-senha", b)).toBe(true);
  });

  it("verifica com as iterações guardadas no hash", async () => {
    const hash = await hashPassword("senha-segura-123", 1_000);
    expect(hash.split("$")[1]).toBe("1000");
    expect(await verifyPassword("senha-segura-123", hash)).toBe(true);
    expect(await verifyPassword("outra", hash)).toBe(false);
  });

  it("devolve false para hashes malformados em vez de lançar erro", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "texto-qualquer")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$10$abc$def")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$0$abc$def")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$100$!!!$!!!")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$100$AAAA$AAAA")).toBe(false);

    // Formato válido, mas com o campo das iterações fora de gama ou mal formado.
    const [scheme, , salt, hash] = (await hashPassword("x", 1_000)).split("$");
    for (const iterations of ["5000000000", "100001", "1000abc", " 1000", "1000.7"]) {
      const stored = [scheme, iterations, salt, hash].join("$");
      expect(await verifyPassword("x", stored), `iterações "${iterations}"`).toBe(false);
    }
  });
});

describe("randomToken", () => {
  it("devolve base64url de 32 bytes (43 caracteres) e sem repetições", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("respeita o tamanho pedido", () => {
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("sha256Hex", () => {
  it("coincide com o vetor de teste conhecido para 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("DUMMY_PASSWORD_HASH", () => {
  it("tem o formato e as iterações de um hash verdadeiro, para a verificação gastar o mesmo CPU", () => {
    const parts = DUMMY_PASSWORD_HASH.split("$");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("pbkdf2-sha256");
    // Se as iterações mudarem, a constante tem de ser gerada outra vez (ver o comentário em crypto.ts).
    expect(parts[1]).toBe(String(PBKDF2_ITERATIONS));
    // O `verifyPassword` devolve false logo à entrada se o salt ou o hash estiverem malformados, e isso saltaria em silêncio o PBKDF2
    // para os emails que não existem: o salt e o hash fictícios têm de ter o mesmo tamanho dos verdadeiros.
    expect(atob(parts[2])).toHaveLength(16);
    expect(atob(parts[3])).toHaveLength(32);
  });

  it("não corresponde a nenhuma senha que um utilizador possa escolher", async () => {
    for (const password of ["", "spacework-dummy-password", "senha-segura-123"]) {
      expect(await verifyPassword(password, DUMMY_PASSWORD_HASH), password).toBe(false);
    }
  });
});
