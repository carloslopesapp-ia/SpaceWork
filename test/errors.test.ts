import { describe, expect, it } from "vitest";
import { isForeignKeyViolation, isUniqueViolation } from "../src/worker/errors";

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
