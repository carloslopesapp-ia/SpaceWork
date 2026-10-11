import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { insertUser, registerAdmin, registerPending, registerUser, setUserStatus, type UserBody } from "./auth-helpers";
import { fetchWithEnv } from "./db-helpers";
import { api, buildRequest, resetDb } from "./helpers";

beforeEach(resetDb);

describe("POST /api/auth/register", () => {
  it("cria o utilizador (role user, quota por defeito) e inicia sessão", async () => {
    const res = await api("/api/auth/register", {
      method: "POST",
      json: { email: " Ana@Example.com ", password: "senha-segura-123" },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as UserBody;
    expect(body.user).toMatchObject({
      email: "ana@example.com",
      role: "user",
      quotaBytes: 1_073_741_824,
      usedBytes: 0,
    });

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("sw_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=1209600");
    expect(setCookie).not.toContain("Secure");

    const row = await env.DB.prepare("SELECT status, password_hash FROM users WHERE email = ?1")
      .bind("ana@example.com")
      .first<{ status: string; password_hash: string }>();
    expect(row?.status).toBe("active");
    expect(row?.password_hash.startsWith("pbkdf2-sha256$100000$")).toBe(true);
  });

  it("marca o cookie como Secure quando o pedido é HTTPS", async () => {
    const res = await api("https://example.com/api/auth/register", {
      method: "POST",
      json: { email: "ana@example.com", password: "senha-segura-123" },
      origin: "https://example.com",
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toContain("Secure");
  });

  it("ignora qualquer role enviada no corpo", async () => {
    const res = await api("/api/auth/register", {
      method: "POST",
      json: { email: "ana@example.com", password: "senha-segura-123", role: "admin" },
    });
    expect(((await res.json()) as UserBody).user.role).toBe("user");
  });

  it("devolve 409 para um email já registado, mesmo com maiúsculas", async () => {
    await registerUser("ana@example.com");
    const res = await api("/api/auth/register", {
      method: "POST",
      json: { email: "ANA@example.com", password: "outra-senha-123" },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "email_taken" });
  });

  it("valida o email e a senha", async () => {
    const badEmail = await api("/api/auth/register", {
      method: "POST",
      json: { email: "nao-e-email", password: "senha-segura-123" },
    });
    expect(badEmail.status).toBe(400);
    expect(await badEmail.json()).toMatchObject({ error: "invalid_email" });

    for (const password of ["curta", "x".repeat(129), 12345678]) {
      const res = await api("/api/auth/register", {
        method: "POST",
        json: { email: "ana@example.com", password },
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_password" });
    }
  });

  it("rejeita um corpo que não seja um objeto JSON", async () => {
    const res = await api("/api/auth/register", {
      method: "POST",
      body: "isto não é json",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_body" });
  });
});

describe("GET /api/auth/me", () => {
  it("devolve o utilizador da sessão", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const res = await api("/api/auth/me", { cookie });
    expect(res.status).toBe(200);
    expect(((await res.json()) as UserBody).user.email).toBe("ana@example.com");
  });

  it("devolve 401 sem cookie ou com um cookie inventado", async () => {
    expect((await api("/api/auth/me")).status).toBe(401);
    expect((await api("/api/auth/me", { cookie: "sw_session=inventado" })).status).toBe(401);
  });

  it("devolve 401 quando a sessão expirou", async () => {
    const { cookie } = await registerUser();
    await env.DB.prepare("UPDATE sessions SET expires_at = 1").run();
    expect((await api("/api/auth/me", { cookie })).status).toBe(401);
  });

  it("devolve 401 quando a conta foi suspensa depois do login", async () => {
    const { cookie } = await registerUser("ana@example.com");
    await setUserStatus("ana@example.com", "suspended");
    expect((await api("/api/auth/me", { cookie })).status).toBe(401);
  });

  it("uma sessão de uma conta por aprovar não autentica (a autenticação exige `approved = 1`)", async () => {
    const { cookie } = await registerUser("ana@example.com");
    await env.DB.prepare("UPDATE users SET approved = 0 WHERE email = 'ana@example.com'").run();
    expect((await api("/api/auth/me", { cookie })).status).toBe(401);
  });

  it("para um administrador, diz quantas contas aguardam aprovação (as por aprovar, e só essas); para os outros não leva o campo", async () => {
    const admin = await registerAdmin("admin@example.com");
    const ana = await registerUser("ana@example.com");
    expect(((await (await api("/api/auth/me", { cookie: admin.cookie })).json()) as UserBody).user).toMatchObject({ pendingApprovals: 0 });

    await registerPending("bob@example.com");
    await registerPending("eva@example.com");
    await insertUser("fred@example.com", { status: "suspended" }); // suspensa não é por aprovar

    const adminMe = ((await (await api("/api/auth/me", { cookie: admin.cookie })).json()) as UserBody).user;
    expect(adminMe.pendingApprovals).toBe(2);
    const anaMe = ((await (await api("/api/auth/me", { cookie: ana.cookie })).json()) as UserBody).user;
    expect(anaMe).not.toHaveProperty("pendingApprovals");
  });
});

describe("POST /api/auth/register com o registo por aprovação", () => {
  const approval = { REGISTRATION_OPEN: "approval" };
  const register = (email = "ana@example.com") =>
    fetchWithEnv(buildRequest("/api/auth/register", { method: "POST", json: { email, password: "senha-segura-123" } }), approval);

  it("cria a conta por aprovar, responde 202 e não inicia sessão", async () => {
    const res = await register();

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ pending: true, message: "Conta criada. Aguarde a aprovação do administrador." });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await env.DB.prepare("SELECT status, role, approved, quota_bytes FROM users WHERE email = 'ana@example.com'").first()).toEqual({
      status: "active",
      role: "user",
      approved: 0,
      quota_bytes: 1_073_741_824,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first()).toEqual({ n: 0 });
  });

  it("um email já registado continua a dar 409, aprovado ou não", async () => {
    await registerUser("ana@example.com");
    await registerPending("bob@example.com");

    for (const email of ["ana@example.com", "bob@example.com"]) {
      const res = await register(email);
      expect(res.status, email).toBe(409);
      expect(await res.json()).toMatchObject({ error: "email_taken" });
    }
  });

  it("valida o email e a senha como no registo aberto", async () => {
    const res = await fetchWithEnv(
      buildRequest("/api/auth/register", { method: "POST", json: { email: "ana@example.com", password: "curta" } }),
      approval,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_password" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).toEqual({ n: 0 });
  });

  it("com o registo aberto (`true`) a conta nasce aprovada e entra logo", async () => {
    const ana = await registerUser("ana@example.com");
    expect(await env.DB.prepare("SELECT approved FROM users WHERE id = ?1").bind(ana.user.id).first()).toEqual({ approved: 1 });
  });
});

describe("POST /api/auth/register com o registo fechado", () => {
  const closed = { REGISTRATION_OPEN: "false" };

  it("responde 403 `registration_closed` sem criar a conta, e quem já tem conta continua a entrar", async () => {
    const ana = await registerUser("ana@example.com");

    const res = await fetchWithEnv(
      buildRequest("/api/auth/register", { method: "POST", json: { email: "bob@example.com", password: "senha-segura-123" } }),
      closed,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "registration_closed" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).toEqual({ n: 1 });

    const login = await fetchWithEnv(
      buildRequest("/api/auth/login", { method: "POST", json: { email: "ana@example.com", password: ana.password } }),
      closed,
    );
    expect(login.status).toBe(200);
  });

  it("responde antes de olhar para o corpo (nem o PBKDF2 da senha arranca)", async () => {
    const res = await fetchWithEnv(
      buildRequest("/api/auth/register", { method: "POST", body: "isto não é JSON", headers: { "Content-Type": "application/json" } }),
      closed,
    );
    expect(res.status).toBe(403);
  });
});
