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
      registrationOpen: true,
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
      registrationOpen: false,
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
      registrationOpen: true,
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
      registrationOpen: true,
    });
  });
});

describe("getConfig: registrationOpen", () => {
  it("o registo está aberto sem a variável e só `true` o mantém aberto (qualquer outro valor fecha-o)", () => {
    const open = (value: string | undefined) =>
      getConfig({ REGISTRATION_OPEN: value } as unknown as Env).registrationOpen;
    expect(open(undefined)).toBe(true);
    expect(open("true")).toBe(true);
    expect(open("false")).toBe(false);
    expect(open("flase")).toBe(false);
    expect(open("")).toBe(false);
  });
});
