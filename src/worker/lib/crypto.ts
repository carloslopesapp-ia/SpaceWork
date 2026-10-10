// Só usa WebCrypto, btoa/atob e TextEncoder, disponíveis no Workers e no Node:
// o script scripts/seed-master.ts importa este ficheiro para gerar hashes no mesmo formato.
// Não usar sintaxe TypeScript que exija transformação (enums, parameter properties).

const SCHEME = "pbkdf2-sha256";
const SALT_BYTES = 16;
const HASH_BYTES = 32;

/** Máximo aceite pelo WebCrypto do Workers em produção. O valor usado fica guardado no hash. */
export const PBKDF2_ITERATIONS = 100_000;

/**
 * Hash de uma senha aleatória que ninguém guardou: o login de um email que não existe verifica a senha contra ele, para demorar o mesmo
 * que o de uma conta verdadeira. É uma constante e não se calcula ao arrancar (o primeiro login falhado de cada arranque pagava dois PBKDF2).
 * Se `PBKDF2_ITERATIONS` mudar, gerar outra: `node --input-type=module -e "import { hashPassword } from './src/worker/lib/crypto.ts'; console.log(await hashPassword(crypto.randomUUID()))"`.
 */
export const DUMMY_PASSWORD_HASH = "pbkdf2-sha256$100000$YqDRIeztG1fRfciEoiKX4w==$W5k+I9f7cNX1XwE1S680ChLPrMCT1HEX8HV5aP+Ru/Y=";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Devolve `pbkdf2-sha256$<iterações>$<salt_b64>$<hash_b64>`. */
export async function hashPassword(
  password: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return `${SCHEME}$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** Verifica a senha contra um hash guardado. Qualquer hash malformado devolve false. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== SCHEME) return false;
  if (!/^\d+$/.test(parts[1])) return false;
  const iterations = Number(parts[1]);
  if (iterations < 1 || iterations > PBKDF2_ITERATIONS) return false;
  let salt: Uint8Array<ArrayBuffer>;
  let expected: Uint8Array<ArrayBuffer>;
  try {
    salt = fromBase64(parts[2]);
    expected = fromBase64(parts[3]);
  } catch {
    return false;
  }
  if (expected.length !== HASH_BYTES) return false;
  const actual = await derive(password, salt, iterations);
  return constantTimeEqual(actual, expected);
}

/** Token aleatório em base64url (sem `=`), com `byteLength` bytes de entropia. */
export function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}
