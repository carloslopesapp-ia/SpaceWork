import { describe, expect, it } from "vitest";
import { migrateCommand } from "../scripts/seed-hints";

describe("migrateCommand (a dica do seed do master)", () => {
  it("manda aplicar as migrações no destino certo", () => {
    expect(migrateCommand("--local")).toBe("npm run db:migrate:local");
    expect(migrateCommand("--remote")).toBe("npm run db:migrate:remote");
  });
});
