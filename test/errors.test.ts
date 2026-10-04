import { describe, expect, it } from "vitest";
import { ApiError, isForeignKeyViolation, isUniqueViolation, rethrowConstraint } from "../src/worker/errors";

const UNIQUE =
  "D1_ERROR: UNIQUE constraint failed: index 'folders_unique_name': SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)";
const FOREIGN_KEY =
  "D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)";

describe("deteção de erros de restrição da D1", () => {
  it("isUniqueViolation reconhece a mensagem real da D1", () => {
    expect(isUniqueViolation(new Error(UNIQUE))).toBe(true);
    expect(isUniqueViolation(new Error(FOREIGN_KEY))).toBe(false);
  });

  it("isForeignKeyViolation reconhece a mensagem real da D1", () => {
    expect(isForeignKeyViolation(new Error(FOREIGN_KEY))).toBe(true);
    expect(isForeignKeyViolation(new Error(UNIQUE))).toBe(false);
  });

  it("valores que não são Error dão false", () => {
    for (const value of [UNIQUE, FOREIGN_KEY, null, undefined, { message: UNIQUE }]) {
      expect(isUniqueViolation(value)).toBe(false);
      expect(isForeignKeyViolation(value)).toBe(false);
    }
  });
});

describe("rethrowConstraint", () => {
  const taken = new ApiError(409, "name_taken", "repetido");
  const missing = new ApiError(404, "folder_not_found", "em falta");
  const mapping = { unique: taken, foreignKey: missing };

  it("converte a violação de unicidade e a de chave estrangeira nos erros indicados", () => {
    expect(() => rethrowConstraint(new Error(UNIQUE), mapping)).toThrow(taken);
    expect(() => rethrowConstraint(new Error(FOREIGN_KEY), mapping)).toThrow(missing);
  });

  it("relança o erro original quando não há correspondência (ou o mapeamento não a cobre)", () => {
    const other = new Error("d1 em baixo");
    expect(() => rethrowConstraint(other, mapping)).toThrow(other);
    expect(() => rethrowConstraint(new Error(UNIQUE), { foreignKey: missing })).toThrow(UNIQUE);
    expect(() => rethrowConstraint(new Error(FOREIGN_KEY), { unique: taken })).toThrow(FOREIGN_KEY);
    expect(() => rethrowConstraint("texto", {})).toThrow("texto");
  });
});
