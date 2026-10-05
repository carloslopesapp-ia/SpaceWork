export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Espera um email já normalizado. */
export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}

/** A quota máxima que o administrador pode dar: 1 PiB (muito mais do que qualquer conta precisa, e dentro dos inteiros exatos do JavaScript). */
export const MAX_QUOTA_BYTES = 2 ** 50;

/** Uma quota em bytes: um inteiro seguro entre 0 e `MAX_QUOTA_BYTES`. */
export function isValidQuota(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_QUOTA_BYTES;
}
