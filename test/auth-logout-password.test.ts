import { beforeEach, describe, expect, it } from "vitest";
import { login, registerUser } from "./auth-helpers";
import { api, resetDb, sessionCookie } from "./helpers";

beforeEach(resetDb);

describe("POST /api/auth/logout", () => {
  it("termina a sessão e limpa o cookie", async () => {
    const { cookie } = await registerUser();
    const res = await api("/api/auth/logout", { method: "POST", cookie });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await api("/api/auth/me", { cookie })).status).toBe(401);
  });

  it("responde 204 mesmo sem sessão", async () => {
    expect((await api("/api/auth/logout", { method: "POST" })).status).toBe(204);
  });
});

describe("POST /api/auth/password", () => {
  const change = (cookie: string, currentPassword: string, newPassword: string) =>
    api("/api/auth/password", { method: "POST", cookie, json: { currentPassword, newPassword } });

  it("exige sessão", async () => {
    const res = await api("/api/auth/password", {
      method: "POST",
      json: { currentPassword: "a", newPassword: "senha-nova-123" },
    });
    expect(res.status).toBe(401);
  });

  it("recusa a senha atual errada", async () => {
    const { cookie } = await registerUser("ana@example.com", "senha-segura-123");
    const res = await change(cookie, "senha-errada-123", "senha-nova-123");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_current_password" });
  });

  it("recusa uma senha nova inválida", async () => {
    const { cookie } = await registerUser("ana@example.com", "senha-segura-123");
    const res = await change(cookie, "senha-segura-123", "curta");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_password" });
  });

  it("troca a senha e termina as outras sessões, mantendo a atual", async () => {
    const { cookie } = await registerUser("ana@example.com", "senha-segura-123");
    const otherCookie = sessionCookie(await login("ana@example.com", "senha-segura-123"))!;

    expect((await change(cookie, "senha-segura-123", "senha-nova-123")).status).toBe(204);

    expect((await api("/api/auth/me", { cookie })).status).toBe(200);
    expect((await api("/api/auth/me", { cookie: otherCookie })).status).toBe(401);
    expect((await login("ana@example.com", "senha-segura-123")).status).toBe(401);
    expect((await login("ana@example.com", "senha-nova-123")).status).toBe(200);
  });

  it("conta as senhas atuais erradas para o bloqueio de tentativas", async () => {
    const { cookie } = await registerUser("ana@example.com", "senha-segura-123");
    for (let i = 0; i < 5; i++) await change(cookie, "errada-errada", "senha-nova-123");
    const res = await change(cookie, "senha-segura-123", "senha-nova-123");
    expect(res.status).toBe(429);
  });
});
