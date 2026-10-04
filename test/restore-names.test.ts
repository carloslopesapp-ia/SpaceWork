import { describe, expect, it } from "vitest";
import { NAME_MAX_LENGTH, validateName } from "../src/shared/names";
import { RESTORE_ATTEMPTS, restoreCandidates } from "../src/worker/lib/restore-names";

describe("restoreCandidates", () => {
  it("começa pelo nome original e depois acrescenta o sufixo, numerado a partir do segundo", () => {
    const candidates = restoreCandidates("relatório.pdf");
    expect(candidates).toHaveLength(RESTORE_ATTEMPTS);
    expect(candidates.slice(0, 4)).toEqual([
      "relatório.pdf",
      "relatório.pdf (restaurado)",
      "relatório.pdf (restaurado 2)",
      "relatório.pdf (restaurado 3)",
    ]);
    expect(candidates[9]).toBe("relatório.pdf (restaurado 9)");
    expect(new Set(candidates).size).toBe(RESTORE_ATTEMPTS);
  });

  it("corta o nome para o sufixo caber nos 255 caracteres, sem partir um emoji ao meio", () => {
    // 241 letras e 7 emojis: 255 unidades UTF-16 (cada emoji conta 2)
    const name = "a".repeat(241) + "😀".repeat(7);
    expect(validateName(name)).toBeNull();
    for (const candidate of restoreCandidates(name)) {
      expect(candidate.length).toBeLessThanOrEqual(NAME_MAX_LENGTH);
      expect(validateName(candidate), candidate).toBeNull(); // sem surrogates isolados
    }
    // " (restaurado)" tem 13 unidades: sobram 242, e o 1.º emoji (unidades 242 e 243) já não cabe, por isso sai inteiro
    expect(restoreCandidates(name)[1]).toBe("a".repeat(241) + " (restaurado)");
  });

  it("um nome curto não é cortado", () => {
    expect(restoreCandidates("a")[1]).toBe("a (restaurado)");
  });
});
