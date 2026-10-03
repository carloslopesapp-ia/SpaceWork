import { describe, expect, it } from "vitest";
import { formatBytes } from "../src/shared/format";

describe("formatBytes", () => {
  it("devolve '0 B' para zero, negativos e valores inválidos", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });

  it("mostra bytes até 1023", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("converte em base 1024 com vírgula decimal (pt-PT)", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(1_048_576)).toBe("1 MB");
    expect(formatBytes(1_572_864)).toBe("1,5 MB");
    expect(formatBytes(1_073_741_824)).toBe("1 GB");
    expect(formatBytes(10_737_418_240)).toBe("10 GB");
    expect(formatBytes(1_099_511_627_776)).toBe("1 TB");
  });

  it("sobe de unidade quando o arredondamento chegaria a 1024", () => {
    expect(formatBytes(1_048_575)).toBe("1 MB");
  });
});
