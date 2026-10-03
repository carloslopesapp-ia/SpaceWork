import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { login, registerUser, setUserStatus, type UserBody } from "./auth-helpers";
import { api, resetDb, sessionCookie } from "./helpers";

beforeEach(resetDb);

describe("POST /api/auth/login", () => {
  it("inicia sessão com as credenciais certas, ignorando maiúsculas no email", async () => {
    await registerUser("ana@example.com", "senha-segura-123");
    const res = await login("ANA@example.com", "senha-segura-123");
    expect(res.status).toBe(200);
    expect(((await res.json()) as UserBody).user.email).toBe("ana@example.com");
    const cookie = sessionCookie(res);
    expect(cookie).not.toBeNull();
    expect((await api("/api/auth/me", { cookie: cookie! })).status).toBe(200);
  });

  it("dá o mesmo erro para senha errada e para email inexistente", async () => {
    await registerUser("ana@example.com", "senha-segura-123");
    const wrongPassword = await login("ana@example.com", "senha-errada-123");
    const unknownEmail = await login("ninguem@example.com", "senha-segura-123");
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    const expected = { error: "invalid_credentials", message: "Email ou senha inválidos." };
    expect(await wrongPassword.json()).toEqual(expected);
    expect(await unknownEmail.json()).toEqual(expected);
  });

  it("bloqueia o email com 429 depois de 5 falhas, mesmo com a senha certa", async () => {
    await registerUser("ana@example.com", "senha-segura-123");
    for (let i = 0; i < 5; i++) {
      expect((await login("ana@example.com", "errada-errada")).status).toBe(401);
    }
    const blocked = await login("ana@example.com", "senha-segura-123");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ error: "too_many_attempts" });
  });

  it("deixa de bloquear quando as falhas têm mais de 15 minutos", async () => {
    await registerUser("ana@example.com", "senha-segura-123");
    for (let i = 0; i < 5; i++) await login("ana@example.com", "errada-errada");
    await env.DB.prepare("UPDATE login_failures SET failed_at = failed_at - ?1")
      .bind(16 * 60_000)
      .run();
    expect((await login("ana@example.com", "senha-segura-123")).status).toBe(200);
  });

  it("apaga as falhas quando o login tem sucesso", async () => {
    await registerUser("ana@example.com", "senha-segura-123");
    for (let i = 0; i < 4; i++) await login("ana@example.com", "errada-errada");
    expect((await login("ana@example.com", "senha-segura-123")).status).toBe(200);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures").first<{
      n: number;
    }>();
    expect(row?.n).toBe(0);
  });

  it("conta suspensa: 403 só com a senha certa, 401 com a errada", async () => {
    await registerUser("ana@example.com", "senha-segura-123");
    await setUserStatus("ana@example.com", "suspended");
    const right = await login("ana@example.com", "senha-segura-123");
    expect(right.status).toBe(403);
    expect(await right.json()).toMatchObject({ error: "account_suspended" });
    expect(sessionCookie(right)).toBeNull();
    expect((await login("ana@example.com", "senha-errada-123")).status).toBe(401);
  });

  it("conta em remoção é tratada como inexistente", async () => {
    await registerUser("ana@example.com", "senha-segura-123");
    await setUserStatus("ana@example.com", "deleting");
    const res = await login("ana@example.com", "senha-segura-123");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "invalid_credentials" });
  });
});
