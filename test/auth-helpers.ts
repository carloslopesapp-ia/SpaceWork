import { env } from "cloudflare:workers";
import type { PublicUser } from "../src/shared/types";
import { api, sessionCookie } from "./helpers";

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

export function login(email: string, password: string): Promise<Response> {
  return api("/api/auth/login", { method: "POST", json: { email, password } });
}

export async function setUserStatus(email: string, status: string): Promise<void> {
  await env.DB.prepare("UPDATE users SET status = ?1 WHERE email = ?2").bind(status, email).run();
}
