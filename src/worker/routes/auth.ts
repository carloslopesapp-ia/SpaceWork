import { Hono, type Context } from "hono";
import { getConfig } from "../config";
import { ApiError, isUniqueViolation } from "../errors";
import { setSessionCookie } from "../lib/cookies";
import { hashPassword } from "../lib/crypto";
import { createSession } from "../lib/sessions";
import { rowToAuthUser, toPublicUser } from "../lib/users";
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

auth.get("/me", requireAuth, (c) => {
  return c.json({ user: toPublicUser(c.get("user")) });
});
