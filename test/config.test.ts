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
    });
  });

  it("converte valores válidos para números", () => {
    const custom = {
      DEFAULT_QUOTA_BYTES: "2048",
      MAX_UPLOAD_BYTES: "10",
      TRASH_RETENTION_DAYS: "7",
      SESSION_TTL_DAYS: "1",
    } as unknown as Env;
    expect(getConfig(custom)).toEqual({
      defaultQuotaBytes: 2048,
      maxUploadBytes: 10,
      trashRetentionDays: 7,
      sessionTtlDays: 1,
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
    });
  });
});
