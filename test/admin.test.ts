import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { AdminUser } from "../src/shared/types";
import { MAX_QUOTA_BYTES } from "../src/shared/validation";
import { app } from "../src/worker/app";
import { runMaintenance } from "../src/worker/cron";
import { insertUser, login, registerAdmin, registerPending, registerUser } from "./auth-helpers";
import { dbWithBatchHook, dbWithStatementHook, fetchWithEnv } from "./db-helpers";
import { uploadFile, uploadOk, usedBytes } from "./file-helpers";
import { api, buildRequest, resetState, sessionCookie } from "./helpers";

beforeEach(resetState);

const listUsers = async (cookie: string): Promise<AdminUser[]> => {
  const res = await api("/api/admin/users", { cookie });
  expect(res.status).toBe(200);
  return ((await res.json()) as { users: AdminUser[] }).users;
};
const patch = (cookie: string, id: string, json: unknown) => api(`/api/admin/users/${id}`, { method: "PATCH", cookie, json });
const remove = (cookie: string, id: string) => api(`/api/admin/users/${id}`, { method: "DELETE", cookie });
const statusOf = async (id: string): Promise<string | undefined> =>
  (await env.DB.prepare("SELECT status FROM users WHERE id = ?1").bind(id).first<{ status: string }>())?.status;

describe("/api/admin: quem pode entrar", () => {
  it("um utilizador normal recebe 403 `forbidden` em todas as rotas, e sem sessão é 401", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const attempts: Array<[string, string, unknown?]> = [
      ["GET", "/api/admin/users"],
      ["PATCH", `/api/admin/users/${bob.user.id}`, { quotaBytes: 1 }],
      ["DELETE", `/api/admin/users/${bob.user.id}`],
    ];
    for (const [method, path, json] of attempts) {
      const res = await api(path, { method, cookie: ana.cookie, json });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await res.json()).toMatchObject({ error: "forbidden" });
      expect((await api(path, { method, json })).status, `${method} ${path} sem sessão`).toBe(401);
    }
    expect(await statusOf(bob.user.id)).toBe("active"); // nada mudou
  });

  it("o admin só tem três rotas: gere contas e quotas e não vê ficheiros de ninguém", () => {
    const routes = app.routes.filter((route) => route.path.startsWith("/api/admin") && route.method !== "ALL");
    expect(routes.map((route) => `${route.method} ${route.path}`).sort()).toEqual([
      "DELETE /api/admin/users/:id",
      "GET /api/admin/users",
      "PATCH /api/admin/users/:id",
    ]);
  });
});

describe("GET /api/admin/users", () => {
  it("lista todas as contas, da mais antiga para a mais recente, sem a senha nem mais nada além destes campos", async () => {
    const admin = await registerAdmin("admin@example.com");
    await insertUser("velha@example.com", { createdAt: 5, usedBytes: 7, quotaBytes: 100 });
    await insertUser("em-remocao@example.com", { createdAt: 6, status: "deleting" });

    const users = await listUsers(admin.cookie);

    expect(users.map((user) => user.email)).toEqual(["velha@example.com", "em-remocao@example.com", "admin@example.com"]);
    expect(users[0]).toMatchObject({ role: "user", status: "active", quotaBytes: 100, usedBytes: 7, createdAt: 5 });
    expect(users[1].status).toBe("deleting");
    expect(users[2]).toMatchObject({ role: "admin", status: "active", id: admin.user.id });
    for (const user of users) {
      expect(Object.keys(user).sort()).toEqual(["approved", "createdAt", "email", "id", "quotaBytes", "role", "status", "usedBytes"]);
    }
  });

  it("mostra primeiro as contas por aprovar (da mais antiga para a mais recente) e marca `approved`", async () => {
    const admin = await registerAdmin("admin@example.com");
    await insertUser("velha@example.com", { createdAt: 5 });
    const bob = await registerPending("bob@example.com");
    const eva = await registerPending("eva@example.com");
    await env.DB.prepare("UPDATE users SET created_at = 20 WHERE id = ?1").bind(bob.id).run();
    await env.DB.prepare("UPDATE users SET created_at = 10 WHERE id = ?1").bind(eva.id).run();

    const users = await listUsers(admin.cookie);

    expect(users.map((user) => [user.email, user.approved])).toEqual([
      ["eva@example.com", false],
      ["bob@example.com", false],
      ["velha@example.com", true],
      ["admin@example.com", true],
    ]);
  });

  it("mostra o espaço usado que o upload acumulou", async () => {
    const admin = await registerAdmin("admin@example.com");
    const ana = await registerUser("ana@example.com");
    await uploadOk(ana.cookie, "a.txt", "12345");

    const found = (await listUsers(admin.cookie)).find((user) => user.email === "ana@example.com");

    expect(found?.usedBytes).toBe(5);
  });
});

describe("PATCH /api/admin/users/:id: quota", () => {
  it("muda a quota, e uma quota abaixo do uso atual só impede novos uploads", async () => {
    const admin = await registerAdmin("admin@example.com");
    const ana = await registerUser("ana@example.com");
    const file = await uploadOk(ana.cookie, "a.txt", "12345");

    const res = await patch(admin.cookie, ana.user.id, { quotaBytes: 3 });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: AdminUser }).user).toMatchObject({ id: ana.user.id, quotaBytes: 3, usedBytes: 5, status: "active" });
    expect((await uploadFile(ana.cookie, "b.txt", "x")).status).toBe(413);
    const download = await api(`/api/files/${file.id}/download`, { cookie: ana.cookie });
    expect(download.status).toBe(200); // o que já lá estava continua a poder-se descarregar
    expect(await usedBytes(ana.cookie)).toBe(5);
  });

  it("aceita 0 e MAX_QUOTA_BYTES e recusa o resto (negativos, fracionários, texto, nulo, acima do máximo)", async () => {
    const admin = await registerAdmin("admin@example.com");
    const ana = await registerUser("ana@example.com");
    for (const quotaBytes of [0, MAX_QUOTA_BYTES]) {
      expect((await patch(admin.cookie, ana.user.id, { quotaBytes })).status, String(quotaBytes)).toBe(200);
    }
    for (const quotaBytes of [-1, 1.5, "10", null, MAX_QUOTA_BYTES + 1, Number.NaN]) {
      const res = await patch(admin.cookie, ana.user.id, { quotaBytes });
      expect(res.status, JSON.stringify(quotaBytes)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_quota" });
    }
  });

  it("pede a quota e/ou o estado, e só aceita `active` e `suspended`", async () => {
    const admin = await registerAdmin("admin@example.com");
    const ana = await registerUser("ana@example.com");
    const empty = await patch(admin.cookie, ana.user.id, {});
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ error: "invalid_body" });
    for (const status of ["deleting", "admin", "", 1, null]) {
      const res = await patch(admin.cookie, ana.user.id, { status });
      expect(res.status, JSON.stringify(status)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_status" });
    }
    expect(await statusOf(ana.user.id)).toBe("active");
  });

  it("um utilizador que não existe é 404 e uma conta em remoção é 409", async () => {
    const admin = await registerAdmin("admin@example.com");
    const deleting = await insertUser("bob@example.com", { status: "deleting" });
    const unknown = await patch(admin.cookie, "nao-existe", { quotaBytes: 1 });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: "user_not_found" });
    const busy = await patch(admin.cookie, deleting, { quotaBytes: 1 });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ error: "account_deleting" });
  });
});

describe("PATCH /api/admin/users/:id: aprovar", () => {
  it("`approved: true` aprova a conta, que passa a entrar, e o contador de contas por aprovar baixa", async () => {
    const admin = await registerAdmin("admin@example.com");
    const ana = await registerPending("ana@example.com", "senha-segura-123");
    const pendingOf = async () =>
      ((await (await api("/api/auth/me", { cookie: admin.cookie })).json()) as { user: { pendingApprovals: number } }).user.pendingApprovals;
    expect(await pendingOf()).toBe(1);
    expect((await login("ana@example.com", "senha-segura-123")).status).toBe(403);

    const res = await patch(admin.cookie, ana.id, { approved: true });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: AdminUser }).user).toMatchObject({ email: "ana@example.com", approved: true, status: "active" });
    expect((await login("ana@example.com", "senha-segura-123")).status).toBe(200);
    expect(await pendingOf()).toBe(0);
  });

  it("é idempotente e pode ir com a quota no mesmo pedido", async () => {
    const admin = await registerAdmin("admin@example.com");
    const ana = await registerPending("ana@example.com");

    const first = await patch(admin.cookie, ana.id, { approved: true, quotaBytes: 42 });
    expect(((await first.json()) as { user: AdminUser }).user).toMatchObject({ approved: true, quotaBytes: 42 });
    const second = await patch(admin.cookie, ana.id, { approved: true });

    expect(second.status).toBe(200);
    expect(((await second.json()) as { user: AdminUser }).user).toMatchObject({ approved: true, quotaBytes: 42 });
  });

  it("só aceita `approved: true`: a aprovação não se desfaz (para parar uma conta, suspende-se)", async () => {
    const admin = await registerAdmin("admin@example.com");
    const ana = await registerUser("ana@example.com");
    for (const approved of [false, 0, 1, "true", null]) {
      const res = await patch(admin.cookie, ana.user.id, { approved });
      expect(res.status, JSON.stringify(approved)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_approved" });
    }
    expect(await env.DB.prepare("SELECT approved FROM users WHERE id = ?1").bind(ana.user.id).first()).toEqual({ approved: 1 });
  });

  it("uma conta em remoção não se aprova (409)", async () => {
    const admin = await registerAdmin("admin@example.com");
    const ana = await registerPending("ana@example.com");
    await env.DB.prepare("UPDATE users SET status = 'deleting' WHERE id = ?1").bind(ana.id).run();

    const res = await patch(admin.cookie, ana.id, { approved: true });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "account_deleting" });
  });
});

describe("PATCH /api/admin/users/:id: suspender e reativar", () => {
  it("suspender termina as sessões e recusa o login; reativar não ressuscita as sessões antigas", async () => {
    const admin = await registerAdmin("admin@example.com");
    const ana = await registerUser("ana@example.com", "senha-segura-123");
    const second = sessionCookie(await login("ana@example.com", "senha-segura-123"))!;

    const suspended = await patch(admin.cookie, ana.user.id, { status: "suspended" });

    expect(suspended.status).toBe(200);
    expect(((await suspended.json()) as { user: AdminUser }).user.status).toBe("suspended");
    expect((await api("/api/auth/me", { cookie: ana.cookie })).status).toBe(401);
    const refused = await login("ana@example.com", "senha-segura-123");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "account_suspended" });

    expect((await patch(admin.cookie, ana.user.id, { status: "active" })).status).toBe(200);

    // as sessões de antes foram apagadas (não basta o filtro por estado): continuam mortas depois de reativar
    expect((await api("/api/auth/me", { cookie: ana.cookie })).status).toBe(401);
    expect((await api("/api/auth/me", { cookie: second })).status).toBe(401);
    expect((await login("ana@example.com", "senha-segura-123")).status).toBe(200);
  });

  it("estado e quota podem ir no mesmo pedido, e o UPDATE e o fim das sessões são uma só batch", async () => {
    const admin = await registerAdmin("admin@example.com");
    const ana = await registerUser("ana@example.com");
    const batches: number[] = [];
    const db = dbWithBatchHook(async (call, runReal) => {
      batches.push(call);
      return runReal();
    });

    const res = await fetchWithEnv(
      buildRequest(`/api/admin/users/${ana.user.id}`, { method: "PATCH", cookie: admin.cookie, json: { status: "suspended", quotaBytes: 42 } }),
      { DB: db },
    );

    expect(res.status).toBe(200);
    expect(batches).toEqual([1]);
    expect(((await res.json()) as { user: AdminUser }).user).toMatchObject({ status: "suspended", quotaBytes: 42 });
    expect((await api("/api/auth/me", { cookie: ana.cookie })).status).toBe(401);
  });

  it("uma conta de administrador não se suspende, mas a quota muda-se", async () => {
    const admin = await registerAdmin("admin@example.com");
    const other = await registerAdmin("outro@example.com");
    const refused = await patch(admin.cookie, other.user.id, { status: "suspended" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "admin_protected" });
    expect(await statusOf(other.user.id)).toBe("active");
    expect((await api("/api/auth/me", { cookie: other.cookie })).status).toBe(200);

    expect((await patch(admin.cookie, admin.user.id, { quotaBytes: 5 })).status).toBe(200);
  });

  it("«Reativar» a competir com «Apagar»: a conta passa a `deleting` entre a leitura e o UPDATE e continua `deleting` (409 account_deleting)", async () => {
    const admin = await registerAdmin("admin@example.com");
    const ana = await insertUser("ana@example.com", { status: "suspended" });
    // `before` corre imediatamente antes do UPDATE do pedido, depois de a rota ter lido a conta como `suspended`
    const racingDb = dbWithStatementHook(/^\s*UPDATE users SET quota_bytes = COALESCE/, async () => {
      await env.DB.prepare("UPDATE users SET status = 'deleting' WHERE id = ?1").bind(ana).run();
    });

    const res = await fetchWithEnv(
      buildRequest(`/api/admin/users/${ana}`, { method: "PATCH", cookie: admin.cookie, json: { status: "active" } }),
      { DB: racingDb },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "account_deleting" });
    expect(await statusOf(ana)).toBe("deleting"); // `deleting` é terminal: o cron vai varrer a conta
  });
});

describe("DELETE /api/admin/users/:id", () => {
  it("põe a conta em remoção e termina as sessões numa só batch, e o login passa a dar o erro genérico", async () => {
    const admin = await registerAdmin("admin@example.com");
    const ana = await registerUser("ana@example.com", "senha-segura-123");
    await uploadOk(ana.cookie, "a.txt", "12345");
    const batches: number[] = [];
    const db = dbWithBatchHook(async (call, runReal) => {
      batches.push(call);
      return runReal();
    });

    const res = await fetchWithEnv(buildRequest(`/api/admin/users/${ana.user.id}`, { method: "DELETE", cookie: admin.cookie }), { DB: db });

    expect(res.status).toBe(204);
    expect(batches).toEqual([1]);
    expect(await statusOf(ana.user.id)).toBe("deleting");
    expect((await api("/api/auth/me", { cookie: ana.cookie })).status).toBe(401);
    const loginAttempt = await login("ana@example.com", "senha-segura-123");
    expect(loginAttempt.status).toBe(401);
    expect(await loginAttempt.json()).toMatchObject({ error: "invalid_credentials" });
    expect((await listUsers(admin.cookie)).find((user) => user.id === ana.user.id)?.status).toBe("deleting");
    // os ficheiros ainda lá estão: quem os apaga é o cron
    expect((await env.FILES.list({ prefix: `u/${ana.user.id}/` })).objects).toHaveLength(1);
  });

  it("rejeitar uma conta por aprovar apaga-a de imediato (não tem ficheiros nem sessões) e liberta o email", async () => {
    const admin = await registerAdmin("admin@example.com");
    const ana = await registerPending("ana@example.com");

    const res = await remove(admin.cookie, ana.id);

    expect(res.status).toBe(204);
    expect(await statusOf(ana.id)).toBeUndefined(); // a linha desapareceu: não ficou em `deleting` à espera do cron
    expect((await listUsers(admin.cookie)).map((user) => user.email)).toEqual(["admin@example.com"]);
    await registerPending("ana@example.com"); // o email ficou livre já
  });

  it("«Rejeitar» a competir com «Aprovar»: a conta aprovada entre a leitura e a escrita passa a `deleting` em vez de desaparecer", async () => {
    const admin = await registerAdmin("admin@example.com");
    const ana = await registerPending("ana@example.com");
    const db = dbWithBatchHook(async (_call, runReal) => {
      await env.DB.prepare("UPDATE users SET approved = 1 WHERE id = ?1").bind(ana.id).run(); // outro administrador aprovou
      return runReal();
    });

    const res = await fetchWithEnv(buildRequest(`/api/admin/users/${ana.id}`, { method: "DELETE", cookie: admin.cookie }), { DB: db });

    expect(res.status).toBe(204);
    expect(await statusOf(ana.id)).toBe("deleting"); // aprovada, por isso segue o caminho normal (o cron remove-a)
  });

  it("é idempotente, não apaga administradores e responde 404 a quem não existe", async () => {
    const admin = await registerAdmin("admin@example.com");
    const other = await registerAdmin("outro@example.com");
    const ana = await registerUser("ana@example.com");
    expect((await remove(admin.cookie, ana.user.id)).status).toBe(204);
    expect((await remove(admin.cookie, ana.user.id)).status).toBe(204);
    const refused = await remove(admin.cookie, other.user.id);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "admin_protected" });
    expect(await statusOf(other.user.id)).toBe("active");
    expect((await remove(admin.cookie, "nao-existe")).status).toBe(404);
  });

  it("de ponta a ponta: o cron remove a conta, os ficheiros e as sessões, e o email fica livre", async () => {
    const admin = await registerAdmin("admin@example.com");
    const ana = await registerUser("ana@example.com", "senha-segura-123");
    await uploadOk(ana.cookie, "a.txt", "12345");
    const register = () => api("/api/auth/register", { method: "POST", json: { email: "ana@example.com", password: "senha-nova-456" } });
    await remove(admin.cookie, ana.user.id);
    expect((await register()).status).toBe(409); // o email continua ocupado até a remoção acabar

    const report = await runMaintenance(env, Date.now());

    expect(report).toMatchObject({ accountsRemoved: 1, errors: [] });
    expect(await statusOf(ana.user.id)).toBeUndefined();
    expect((await env.FILES.list({ prefix: `u/${ana.user.id}/` })).objects).toHaveLength(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM files").first<{ n: number }>())?.n).toBe(0);
    expect((await register()).status).toBe(201);
    expect((await listUsers(admin.cookie)).map((user) => user.email).sort()).toEqual(["admin@example.com", "ana@example.com"]);
  });
});
