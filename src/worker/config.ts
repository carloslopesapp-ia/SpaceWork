export interface AppConfig {
  defaultQuotaBytes: number;
  maxUploadBytes: number;
  trashRetentionDays: number;
  sessionTtlDays: number;
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Lê as variáveis de wrangler.jsonc (sempre strings) e aplica os valores por defeito da especificação. */
export function getConfig(env: Env): AppConfig {
  return {
    defaultQuotaBytes: toPositiveInt(env.DEFAULT_QUOTA_BYTES, 1_073_741_824),
    maxUploadBytes: toPositiveInt(env.MAX_UPLOAD_BYTES, 104_857_600),
    trashRetentionDays: toPositiveInt(env.TRASH_RETENTION_DAYS, 30),
    sessionTtlDays: toPositiveInt(env.SESSION_TTL_DAYS, 14),
  };
}
