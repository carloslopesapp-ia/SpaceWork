import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getConfig } from "../src/worker/config";

describe("getConfig", () => {
  it("lê os valores de wrangler.jsonc", () => {
    expect(getConfig(env)).toEqual({
      defaultQuotaBytes: 1_073_741_824,
      maxUploadBytes: 104_857_600,
      trashRetentionDays: 30,
      sessionTtlDays: 14,
      registrationMode: "open",
    });
  });

  it("converte valores válidos para números", () => {
    const custom = {
      DEFAULT_QUOTA_BYTES: "2048",
      MAX_UPLOAD_BYTES: "10",
      TRASH_RETENTION_DAYS: "7",
      SESSION_TTL_DAYS: "1",
      REGISTRATION_OPEN: "false",
    } as unknown as Env;
    expect(getConfig(custom)).toEqual({
      defaultQuotaBytes: 2048,
      maxUploadBytes: 10,
      trashRetentionDays: 7,
      sessionTtlDays: 1,
      registrationMode: "closed",
    });
  });

  it("usa os valores por defeito quando faltam ou são inválidos", () => {
    const broken = {
      DEFAULT_QUOTA_BYTES: "abc",
      MAX_UPLOAD_BYTES: "-5",
      TRASH_RETENTION_DAYS: "0",
    } as unknown as Env;
    expect(getConfig(broken)).toEqual({
      defaultQuotaBytes: 1_073_741_824,
      maxUploadBytes: 104_857_600,
      trashRetentionDays: 30,
      sessionTtlDays: 14,
      registrationMode: "open",
    });
  });

  it("rejeita valores malformados (com sufixos, decimais ou underscores)", () => {
    const malformed = {
      DEFAULT_QUOTA_BYTES: "100MB",
      MAX_UPLOAD_BYTES: "1.5",
      TRASH_RETENTION_DAYS: "12abc",
      SESSION_TTL_DAYS: "1_000",
    } as unknown as Env;
    expect(getConfig(malformed)).toEqual({
      defaultQuotaBytes: 1_073_741_824,
      maxUploadBytes: 104_857_600,
      trashRetentionDays: 30,
      sessionTtlDays: 14,
      registrationMode: "open",
    });
  });
});

describe("getConfig: registrationMode", () => {
  it("o registo está aberto sem a variável, `true` abre-o, `approval` abre-o por aprovação e qualquer outro valor fecha-o", () => {
    const mode = (value: string | undefined) => getConfig({ REGISTRATION_OPEN: value } as unknown as Env).registrationMode;
    expect(mode(undefined)).toBe("open");
    expect(mode("true")).toBe("open");
    expect(mode("approval")).toBe("approval");
    expect(mode("false")).toBe("closed");
    expect(mode("flase")).toBe("closed");
    expect(mode("Approval")).toBe("closed"); // só o valor exato conta: um erro de escrita fecha o registo em vez de o abrir
    expect(mode("")).toBe("closed");
  });
});
