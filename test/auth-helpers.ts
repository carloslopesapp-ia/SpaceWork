import { env } from "cloudflare:workers";
import type { PublicUser } from "../src/shared/types";
import { fetchWithEnv } from "./db-helpers";
import { api, buildRequest, sessionCookie } from "./helpers";

export interface UserBody {
  user: PublicUser;
}

/** Regista um utilizador pela API e devolve o cookie de sessão que ficou ativo. */
export async function registerUser(
  email = "ana@example.com",
  password = "senha-segura-123",
): Promise<{ cookie: string; user: PublicUser; password: string }> {
  const res = await api("/api/auth/register", { method: "POST", json: { email, password } });
  const cookie = sessionCookie(res);
  if (res.status !== 201 || !cookie) {
    throw new Error(`registerUser falhou: ${res.status} ${await res.text()}`);
  }
  const { user } = (await res.json()) as UserBody;
  return { cookie, user, password };
}

/** Regista uma conta com o registo por aprovação (`REGISTRATION_OPEN=approval`): fica por aprovar e sem sessão. Devolve o id. */
export async function registerPending(
  email = "ana@example.com",
  password = "senha-segura-123",
): Promise<{ id: string; password: string }> {
  const res = await fetchWithEnv(buildRequest("/api/auth/register", { method: "POST", json: { email, password } }), {
    REGISTRATION_OPEN: "approval",
  });
  if (res.status !== 202) throw new Error(`registerPending falhou: ${res.status} ${await res.text()}`);
  const row = await env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(email).first<{ id: string }>();
  return { id: row!.id, password };
}

export function login(email: string, password: string): Promise<Response> {
  return api("/api/auth/login", { method: "POST", json: { email, password } });
}

export async function setUserStatus(email: string, status: string): Promise<void> {
  await env.DB.prepare("UPDATE users SET status = ?1 WHERE email = ?2").bind(status, email).run();
}

interface UserRowOptions {
  role?: string;
  status?: string;
  quotaBytes?: number;
  usedBytes?: number;
  createdAt?: number;
}

/** Insere um utilizador por SQL, sem passar pela API nem gastar o PBKDF2: para os testes que precisam de vários. Devolve o id. */
export async function insertUser(email: string, options: UserRowOptions = {}): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, role, status, quota_bytes, used_bytes, created_at)
     VALUES (?1, ?2, 'x', ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(
      id,
      email,
      options.role ?? "user",
      options.status ?? "active",
      options.quotaBytes ?? 1_000_000,
      options.usedBytes ?? 0,
      options.createdAt ?? 1,
    )
    .run();
  return id;
}

/** Regista um utilizador e promove-o a administrador (o registo só cria utilizadores normais). O cookie devolvido continua válido. */
export async function registerAdmin(
  email = "admin@example.com",
  password = "senha-admin-123",
): Promise<{ cookie: string; user: PublicUser; password: string }> {
  const result = await registerUser(email, password);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?1").bind(result.user.id).run();
  return result;
}
