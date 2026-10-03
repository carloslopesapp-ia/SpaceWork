import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { getConfig } from "../config";
import { ApiError, isUniqueViolation } from "../errors";
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from "../lib/cookies";
import { hashPassword, sha256Hex, verifyPassword } from "../lib/crypto";
import { clearFailures, tryRecordAttempt } from "../lib/login-limit";
import { createSession, deleteSessionByHash, deleteUserSessions } from "../lib/sessions";
import { rowToAuthUser, toPublicUser, type UserRow } from "../lib/users";
import { isValidEmail, isValidPassword, normalizeEmail } from "../lib/validation";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const auth = new Hono<AppEnv>();

async function readBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "invalid_body", "Corpo do pedido inválido.");
  }
  return body as Record<string, unknown>;
}

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

const INVALID_CREDENTIALS = ["invalid_credentials", "Email ou senha inválidos."] as const;
const LOCKED_OUT = [
  "too_many_attempts",
  "Demasiadas tentativas. Tente novamente dentro de 15 minutos.",
] as const;

// Hash de uma senha qualquer, para que um email inexistente demore o mesmo a responder que um existente.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("spacework-dummy-password");
  return dummyHash;
}

auth.post("/register", async (c) => {
  const body = await readBody(c);
  const email = normalizeEmail(readString(body, "email"));
  const password = readString(body, "password");
  if (!isValidEmail(email)) throw new ApiError(400, "invalid_email", "Email inválido.");
  if (!isValidPassword(password)) {
    throw new ApiError(400, "invalid_password", "A senha deve ter entre 8 e 128 caracteres.");
  }

  const config = getConfig(c.env);
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  try {
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, role, status, quota_bytes, used_bytes, created_at)
       VALUES (?1, ?2, ?3, 'user', 'active', ?4, 0, ?5)`,
    )
      .bind(id, email, passwordHash, config.defaultQuotaBytes, Date.now())
      .run();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "email_taken", "Este email já está registado.");
    }
    throw error;
  }

  const { token } = await createSession(c.env.DB, id, config.sessionTtlDays);
  setSessionCookie(c, token, config.sessionTtlDays);
  const user = rowToAuthUser({
    id,
    email,
    role: "user",
    status: "active",
    quota_bytes: config.defaultQuotaBytes,
    used_bytes: 0,
  });
  return c.json({ user: toPublicUser(user) }, 201);
});

auth.post("/login", async (c) => {
  const body = await readBody(c);
  const email = normalizeEmail(readString(body, "email"));
  const password = readString(body, "password");
  const db = c.env.DB;

  // A tentativa fica registada antes de verificar a senha: assim pedidos em paralelo não escapam ao limite.
  if (!(await tryRecordAttempt(db, email))) throw new ApiError(429, ...LOCKED_OUT);

  const row = await db
    .prepare(
      "SELECT id, email, password_hash, role, status, quota_bytes, used_bytes FROM users WHERE email = ?1",
    )
    .bind(email)
    .first<UserRow & { password_hash: string }>();

  // Contas inexistentes ou em remoção gastam o mesmo tempo de CPU e dão o mesmo erro genérico.
  const usable = row !== null && row.status !== "deleting";
  const passwordOk = await verifyPassword(
    password,
    usable ? row.password_hash : await getDummyHash(),
  );
  if (!usable || !passwordOk) throw new ApiError(401, ...INVALID_CREDENTIALS);

  // Uma senha certa não é uma tentativa falhada, mesmo que a conta esteja suspensa.
  await clearFailures(db, email);
  if (row.status === "suspended") {
    throw new ApiError(403, "account_suspended", "Conta suspensa. Contacte o administrador.");
  }

  const config = getConfig(c.env);
  const { token } = await createSession(db, row.id, config.sessionTtlDays);
  setSessionCookie(c, token, config.sessionTtlDays);
  return c.json({ user: toPublicUser(rowToAuthUser(row)) });
});

auth.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await deleteSessionByHash(c.env.DB, await sha256Hex(token));
  clearSessionCookie(c);
  return c.body(null, 204);
});

auth.get("/me", requireAuth, (c) => {
  return c.json({ user: toPublicUser(c.get("user")) });
});

auth.post("/password", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await readBody(c);
  const currentPassword = readString(body, "currentPassword");
  const newPassword = readString(body, "newPassword");
  if (!isValidPassword(newPassword)) {
    throw new ApiError(400, "invalid_password", "A senha deve ter entre 8 e 128 caracteres.");
  }

  const db = c.env.DB;
  // Regista a tentativa antes de verificar a senha, numa só instrução atómica (ver login-limit.ts).
  if (!(await tryRecordAttempt(db, user.email))) throw new ApiError(429, ...LOCKED_OUT);

  const row = await db
    .prepare("SELECT password_hash FROM users WHERE id = ?1")
    .bind(user.id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
    throw new ApiError(400, "invalid_current_password", "A senha atual está incorreta.");
  }

  await clearFailures(db, user.email);
  await db
    .prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2")
    .bind(await hashPassword(newPassword), user.id)
    .run();
  await deleteUserSessions(db, user.id, c.get("sessionTokenHash"));
  return c.body(null, 204);
});
