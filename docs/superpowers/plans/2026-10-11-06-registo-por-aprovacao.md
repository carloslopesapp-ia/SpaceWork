# SpaceWork — Plano 6: registo por aprovação (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o registo aberto mas **por aprovação**: com `REGISTRATION_OPEN=approval` uma conta nova fica por aprovar, sem sessão, até um administrador a aprovar no painel (ou a rejeitar), e a produção passa a usar esse modo. Quem já tem conta não nota nada.

**Architecture:** Uma coluna nova, `users.approved` (0 ou 1, por defeito 1), em vez de um estado novo: a restrição do `status` não se altera sem recriar a tabela `users`, e na D1 isso arrisca apagar em cascata as sessões, as pastas e os ficheiros. O registo por aprovação cria a conta com `approved = 0` e responde 202 sem sessão; o login só revela «por aprovar» depois de a senha estar certa (403 `account_pending`); a autenticação por sessão exige `approved = 1`. O administrador aprova (`PATCH` com `approved: true`) ou rejeita (`DELETE`, que apaga logo uma conta por aprovar, porque não tem ficheiros nem sessões). `GET /api/auth/me` de um administrador traz `pendingApprovals`, que a barra lateral mostra. Os testes do Worker e os de ponta a ponta continuam a partir do registo aberto: a produção usa `approval` em `wrangler.jsonc`, e cada suíte põe o registo aberto na sua configuração.

**Tech Stack:** o dos planos anteriores; nenhuma dependência nova.

**Spec:** [docs/superpowers/specs/2026-10-03-spacework-design.md](../specs/2026-10-03-spacework-design.md) (secção 2, a variável `REGISTRATION_OPEN`; secção 3, `users`; secção 4, registo e login; secção 6, API; secção 8, interface; secção 11, deploy). Índice dos planos: [README.md](README.md). A especificação já descreve este comportamento (commit anterior ao plano).

## Global Constraints

Valores da especificação e dos planos anteriores; todas as tarefas os cumprem implicitamente.

- Interface em português europeu; as mensagens de erro da API já vêm em português e a interface mostra o `message` tal como vem.
- `REGISTRATION_OPEN`: `true` (ou sem a variável) = registo aberto; `approval` = registo aberto com as contas **por aprovar**; qualquer outro valor = fechado (`403 registration_closed`). Só o valor exato conta: um erro de escrita (`Approval`, `flase`) fecha o registo em vez de o abrir.
- O registo por aprovação responde `202 { pending: true, message }` **sem cookie de sessão**. O login de uma conta por aprovar dá `403 account_pending` **só com a senha certa** (com a errada, o erro genérico `401`), antes do aviso de conta suspensa; uma senha certa apaga as falhas de login, como na conta suspensa.
- A autenticação por sessão exige `status = 'active'` **e** `approved = 1`. Aprovar não se desfaz (`approved` só aceita `true`; para parar uma conta, suspende-se). Rejeitar uma conta por aprovar apaga-a de imediato; as outras continuam a passar por `deleting` e pelo cron.
- A migração `0004` só **acrescenta** uma coluna: as contas que existem ficam aprovadas. **Em produção, a migração tem de ser aplicada à D1 antes do push que traz o código que a usa** (`npm run db:migrate:remote`): o deploy automático não corre migrações, e o Worker novo falharia contra a base antiga.
- As rotas de administração continuam a ser só três (`GET`, `PATCH` e `DELETE /api/admin/users`): nenhuma rota nova.
- Os testes do Worker (`npx vitest run`), os da interface (`npx vitest run -c vitest.web.config.ts`) e os de ponta a ponta (`npm run test:e2e`) mostram só o resumo: qualquer outra saída (avisos de `act`, `console.error`) é um defeito do teste a corrigir. Nenhum teste espera por temporizadores falsos.
- Este plano não instala nada, não toca na conta da Cloudflare, no GitHub nem em credenciais, e **não faz push**. A migração da D1 de produção e o push são do utilizador.
- IDs `crypto.randomUUID()`; datas em milissegundos Unix. Vitest `^4.1`.
- **Nenhum `git push` sem confirmação explícita do utilizador.**

## Ambiente

- Node 24 e npm 11; todos os comandos correm na raiz do repositório (`~/Developer/SpaceWork`, fora do iCloud). Ramo de trabalho: `plano-6-contas-por-aprovar`.
- Commits: mensagem curta em português; cada commit termina com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (nos comandos abaixo, é o segundo `-m`). Escrever **exatamente** esse trailer, "Claude Sonnet 5.5", mesmo que o modelo que executa seja outro.
- As Tasks 1 e 2 tocam no Worker (`npx vitest run`); as Tasks 3 e 4 na interface (`npx vitest run -c vitest.web.config.ts`); a Task 5 muda a configuração de produção, as das suítes e a documentação, e corre os testes de ponta a ponta (`npm run test:e2e`, porta 4180 livre; o Chromium do Playwright já deve estar instalado).
- A verificação manual (Task 5) usa contas **fictícias** numa base local limpa. Nunca se usam as credenciais do utilizador master, nem se escrevem em ficheiros.

## Estrutura de ficheiros deste plano

```
migrations/0004_account_approval.sql        + users.approved (0 ou 1, por defeito 1)
src/worker/config.ts                        registrationMode: open | approval | closed
src/worker/routes/auth.ts                   registo por aprovação (202), login 403 account_pending, /me com pendingApprovals
src/worker/lib/users.ts                     toSessionUser (o utilizador com o contador, para um administrador)
src/worker/lib/sessions.ts                  a sessão exige approved = 1
src/worker/routes/admin.ts                  approved na lista e no PATCH; rejeitar apaga logo uma conta por aprovar
src/shared/types.ts                         PublicUser.pendingApprovals, AdminUser.approved
src/web/auth.ts                             useRegister devolve a conta entrada ou o pedido pendente
src/web/pages/RegisterPage.tsx              o ecrã «Conta criada» do registo por aprovação
src/web/components/AppLayout.tsx            «Admin» com o número de contas por aprovar
src/web/admin.ts                            useUpdateUser aceita approved: true
src/web/components/PendingActions.tsx       «Aprovar» e «Rejeitar…» (novo)
src/web/pages/AdminPage.tsx                 estado «Aguarda aprovação», as ações e a mensagem
wrangler.jsonc, worker-configuration.d.ts   REGISTRATION_OPEN = "approval" (produção)
vitest.config.ts, vite.config.ts            cada suíte põe o registo aberto na sua configuração
playwright.config.ts                        a construção dos testes de ponta a ponta também
README.md, plans/README.md                  a documentação e o índice
test/, src/web/                             + os testes acima
```

---


### Task 1: O Worker: o registo por aprovação, o login de uma conta por aprovar e a sessão que exige a aprovação

**Files:**
- Create: `migrations/0004_account_approval.sql`
- Modify: `src/worker/config.ts`, `src/shared/types.ts`, `src/worker/lib/users.ts`, `src/worker/lib/sessions.ts`, `src/worker/routes/auth.ts`
- Test: `test/config.test.ts`, `test/schema.test.ts`, `test/auth-helpers.ts`, `test/auth-register.test.ts`, `test/auth-login.test.ts`

**Interfaces:**
- Consumes: `getConfig`, `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `findSession` (planos 1 a 5A) e os ajudantes de teste `registerUser`, `registerAdmin`, `insertUser`, `login`, `fetchWithEnv`, `buildRequest`.
- Produces: `AppConfig.registrationMode` (`"open" | "approval" | "closed"`, no lugar de `registrationOpen`); a coluna `users.approved`; o registo por aprovação (`202 { pending: true, message }`, sem sessão); `403 account_pending` no login; a sessão que exige `approved = 1`; `PublicUser.pendingApprovals?` e `toSessionUser(db, user)`; o ajudante de teste `registerPending(email?, password?)`.

- [ ] **Step 1: Os testes primeiro**

Os testes do que o Worker passa a fazer, escritos antes do código: o modo do registo (`config.test.ts`), a coluna nova (`schema.test.ts`), o registo por aprovação e o contador de `/me` (`auth-register.test.ts`) e o login de uma conta por aprovar (`auth-login.test.ts`). `registerPending` é um ajudante novo: regista uma conta com `REGISTRATION_OPEN=approval` (a variável chega ao Worker por `fetchWithEnv`) e devolve o `id`. O teste que olha para `wrangler.jsonc` passa a esperar `registrationMode: "open"` (o valor de hoje) em vez de `registrationOpen: true`; a Task 5 muda a produção e põe o registo aberto na configuração dos testes.

Em `test/auth-helpers.ts`, trocar:

```ts
import { env } from "cloudflare:workers";
import type { PublicUser } from "../src/shared/types";
import { api, sessionCookie } from "./helpers";

export interface UserBody {
  user: PublicUser;
```

por:

```ts
import { env } from "cloudflare:workers";
import type { PublicUser } from "../src/shared/types";
import { fetchWithEnv } from "./db-helpers";
import { api, buildRequest, sessionCookie } from "./helpers";

export interface UserBody {
  user: PublicUser;
```

Em `test/auth-helpers.ts`, trocar:

```ts
  }
  const { user } = (await res.json()) as UserBody;
  return { cookie, user, password };
}

export function login(email: string, password: string): Promise<Response> {
```

por:

```ts
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
```

Em `test/auth-login.test.ts`, trocar:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { login, registerUser, setUserStatus, type UserBody } from "./auth-helpers";
import { api, resetDb, sessionCookie } from "./helpers";

beforeEach(resetDb);
```

por:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { login, registerPending, registerUser, setUserStatus, type UserBody } from "./auth-helpers";
import { api, resetDb, sessionCookie } from "./helpers";

beforeEach(resetDb);
```

Em `test/auth-login.test.ts`, trocar:

```ts
    expect(await right.json()).toMatchObject({ error: "account_suspended" });
    expect(sessionCookie(right)).toBeNull();
    expect((await login("ana@example.com", "senha-errada-123")).status).toBe(401);
  });

  it("conta em remoção é tratada como inexistente", async () => {
```

por:

```ts
    expect(await right.json()).toMatchObject({ error: "account_suspended" });
    expect(sessionCookie(right)).toBeNull();
    expect((await login("ana@example.com", "senha-errada-123")).status).toBe(401);
  });

  it("conta por aprovar: 403 `account_pending` só com a senha certa (sem sessão), 401 com a errada", async () => {
    await registerPending("ana@example.com", "senha-segura-123");

    const right = await login("ana@example.com", "senha-segura-123");
    expect(right.status).toBe(403);
    expect(await right.json()).toEqual({ error: "account_pending", message: "A sua conta aguarda a aprovação do administrador." });
    expect(sessionCookie(right)).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first()).toEqual({ n: 0 });

    const wrong = await login("ana@example.com", "senha-errada-123");
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ error: "invalid_credentials" });
  });

  it("uma senha certa apaga as falhas, mesmo numa conta por aprovar", async () => {
    await registerPending("ana@example.com", "senha-segura-123");
    await login("ana@example.com", "errada-errada");
    await login("ana@example.com", "errada-errada");

    expect((await login("ana@example.com", "senha-segura-123")).status).toBe(403);

    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures").first()).toEqual({ n: 0 });
  });

  it("uma conta por aprovar e suspensa dá primeiro `account_pending`", async () => {
    await registerPending("ana@example.com", "senha-segura-123");
    await setUserStatus("ana@example.com", "suspended");
    expect(await (await login("ana@example.com", "senha-segura-123")).json()).toMatchObject({ error: "account_pending" });
  });

  it("depois de aprovada, a mesma conta entra", async () => {
    await registerPending("ana@example.com", "senha-segura-123");
    expect((await login("ana@example.com", "senha-segura-123")).status).toBe(403);

    await env.DB.prepare("UPDATE users SET approved = 1 WHERE email = 'ana@example.com'").run();

    const res = await login("ana@example.com", "senha-segura-123");
    expect(res.status).toBe(200);
    expect(sessionCookie(res)).not.toBeNull();
  });

  it("conta em remoção é tratada como inexistente", async () => {
```

Em `test/auth-register.test.ts`, trocar:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { registerUser, setUserStatus, type UserBody } from "./auth-helpers";
import { fetchWithEnv } from "./db-helpers";
import { api, buildRequest, resetDb } from "./helpers";
```

por:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { insertUser, registerAdmin, registerPending, registerUser, setUserStatus, type UserBody } from "./auth-helpers";
import { fetchWithEnv } from "./db-helpers";
import { api, buildRequest, resetDb } from "./helpers";
```

Em `test/auth-register.test.ts`, trocar:

```ts
    await setUserStatus("ana@example.com", "suspended");
    expect((await api("/api/auth/me", { cookie })).status).toBe(401);
  });
});

describe("POST /api/auth/register com o registo fechado", () => {
```

por:

```ts
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
```

Em `test/config.test.ts`, trocar:

```ts
      defaultQuotaBytes: 1_073_741_824,
      maxUploadBytes: 104_857_600,
      trashRetentionDays: 30,
      sessionTtlDays: 14,
      registrationOpen: true,
    });
  });

  it("converte valores válidos para números", () => {
```

por:

```ts
      defaultQuotaBytes: 1_073_741_824,
      maxUploadBytes: 104_857_600,
      trashRetentionDays: 30,
      sessionTtlDays: 14,
      registrationMode: "open",
    });
  });

  it("converte valores válidos para números", () => {
```

Em `test/config.test.ts`, trocar:

```ts
      defaultQuotaBytes: 2048,
      maxUploadBytes: 10,
      trashRetentionDays: 7,
      sessionTtlDays: 1,
      registrationOpen: false,
    });
  });

  it("usa os valores por defeito quando faltam ou são inválidos", () => {
```

por:

```ts
      defaultQuotaBytes: 2048,
      maxUploadBytes: 10,
      trashRetentionDays: 7,
      sessionTtlDays: 1,
      registrationMode: "closed",
    });
  });

  it("usa os valores por defeito quando faltam ou são inválidos", () => {
```

Em `test/config.test.ts`, trocar:

```ts
      defaultQuotaBytes: 1_073_741_824,
      maxUploadBytes: 104_857_600,
      trashRetentionDays: 30,
      sessionTtlDays: 14,
      registrationOpen: true,
    });
  });

  it("rejeita valores malformados (com sufixos, decimais ou underscores)", () => {
```

por:

```ts
      defaultQuotaBytes: 1_073_741_824,
      maxUploadBytes: 104_857_600,
      trashRetentionDays: 30,
      sessionTtlDays: 14,
      registrationMode: "open",
    });
  });

  it("rejeita valores malformados (com sufixos, decimais ou underscores)", () => {
```

Em `test/config.test.ts`, trocar:

```ts
      defaultQuotaBytes: 1_073_741_824,
      maxUploadBytes: 104_857_600,
      trashRetentionDays: 30,
      sessionTtlDays: 14,
      registrationOpen: true,
    });
  });
});

describe("getConfig: registrationOpen", () => {
  it("o registo está aberto sem a variável e só `true` o mantém aberto (qualquer outro valor fecha-o)", () => {
    const open = (value: string | undefined) =>
      getConfig({ REGISTRATION_OPEN: value } as unknown as Env).registrationOpen;
    expect(open(undefined)).toBe(true);
    expect(open("true")).toBe(true);
    expect(open("false")).toBe(false);
    expect(open("flase")).toBe(false);
    expect(open("")).toBe(false);
  });
});
```

por:

```ts
      defaultQuotaBytes: 1_073_741_824,
      maxUploadBytes: 104_857_600,
      trashRetentionDays: 30,
      sessionTtlDays: 14,
      registrationMode: "open",
    });
  });
});

describe("getConfig: registrationMode", () => {
  it("o registo está aberto sem a variável, `true` abre-o, `approval` abre-o por aprovação e qualquer outro valor fecha-o", () => {
    const mode = (value: string | undefined) => getConfig({ REGISTRATION_OPEN: value } as unknown as Env).registrationMode;
    expect(mode(undefined)).toBe("open");
    expect(mode("true")).toBe("open");
    expect(mode("approval")).toBe("approval");
    expect(mode("false")).toBe("closed");
    expect(mode("flase")).toBe("closed");
    expect(mode("Approval")).toBe("closed"); // só o valor exato conta: um erro de escrita fecha o registo em vez de o abrir
    expect(mode("")).toBe("closed");
  });
});
```

Em `test/schema.test.ts`, trocar:

```ts
  it("impede emails repetidos", async () => {
    await insertUser("u1", "ana@example.com");
    await expect(insertUser("u2", "ana@example.com")).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("só aceita os papéis admin e user", async () => {
```

por:

```ts
  it("impede emails repetidos", async () => {
    await insertUser("u1", "ana@example.com");
    await expect(insertUser("u2", "ana@example.com")).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("a coluna `approved` vale 1 por defeito (as contas que já existiam ficam aprovadas) e só aceita 0 ou 1", async () => {
    await insertUser("u1", "ana@example.com");
    expect(await env.DB.prepare("SELECT approved FROM users WHERE id = 'u1'").first()).toEqual({ approved: 1 });
    await expect(env.DB.prepare("UPDATE users SET approved = 2 WHERE id = 'u1'").run()).rejects.toThrow(/CHECK constraint failed/);
  });

  it("só aceita os papéis admin e user", async () => {
```

Run: `npx vitest run test/config.test.ts test/schema.test.ts test/auth-register.test.ts test/auth-login.test.ts`
Expected: FAIL (Test Files  4 failed (4); Tests  16 failed | 33 passed (49)). Falham os testes novos (e os de `config.test.ts`, que já esperam `registrationMode`).

- [ ] **Step 2: A implementação**

**Migração:** uma coluna, `approved INTEGER NOT NULL DEFAULT 1` com `CHECK (approved IN (0, 1))`: as contas que existem ficam aprovadas. Não se acrescenta um estado `pending` ao `status`, porque a restrição do `status` não se altera sem recriar a tabela `users`, e na D1 isso arrisca apagar em cascata as sessões, as pastas e os ficheiros. **Configuração:** `registrationMode` (`open`, `approval` ou `closed`); sem a variável o registo está aberto e só os valores exatos `true` e `approval` o abrem. **Registo:** em modo `approval` a conta cria-se com `approved = 0` e o pedido responde 202, **sem sessão e sem cookie**. **Login:** só depois de a senha estar certa (e de as falhas serem apagadas) responde `403 account_pending`, antes do aviso de conta suspensa; com a senha errada, o erro genérico de sempre. **Sessão:** `findSession` exige `approved = 1` (uma conta por aprovar nunca autentica, mesmo que apareça uma sessão). **`/me` e o login:** para um administrador, o utilizador leva `pendingApprovals` (as contas por aprovar), calculado por `toSessionUser`; para os outros, nada muda.

Criar `migrations/0004_account_approval.sql`:

```sql
-- Registo por aprovação (REGISTRATION_OPEN = approval): 0 = a conta aguarda que um administrador a aprove; 1 = aprovada.
-- As contas que já existem ficam aprovadas (DEFAULT 1). É uma coluna nova, e não um estado novo, porque a restrição do `status`
-- não se altera sem recriar a tabela `users`, e na D1 isso arrisca apagar em cascata as sessões, as pastas e os ficheiros.
ALTER TABLE users ADD COLUMN approved INTEGER NOT NULL DEFAULT 1 CHECK (approved IN (0, 1));
```

Em `src/shared/types.ts`, trocar:

```ts
  role: Role;
  quotaBytes: number;
  usedBytes: number;
}

/** Pasta tal como a API a devolve ao frontend. */
```

por:

```ts
  role: Role;
  quotaBytes: number;
  usedBytes: number;
  /** Só para um administrador: quantas contas aguardam a sua aprovação (registo por aprovação). */
  pendingApprovals?: number;
}

/** Pasta tal como a API a devolve ao frontend. */
```

Em `src/worker/config.ts`, trocar:

```ts
export interface AppConfig {
  defaultQuotaBytes: number;
  maxUploadBytes: number;
  trashRetentionDays: number;
  sessionTtlDays: number;
  /** Se `false`, `POST /api/auth/register` responde 403 (o dono fecha o registo depois de criar as contas). */
  registrationOpen: boolean;
}

function toPositiveInt(value: string | undefined, fallback: number): number {
```

por:

```ts
/** Como se regista uma conta: `open` (entra logo), `approval` (fica por aprovar até um administrador a ativar) ou `closed` (403). */
export type RegistrationMode = "open" | "approval" | "closed";

export interface AppConfig {
  defaultQuotaBytes: number;
  maxUploadBytes: number;
  trashRetentionDays: number;
  sessionTtlDays: number;
  /** `REGISTRATION_OPEN`: ver `RegistrationMode`. Fechado, `POST /api/auth/register` responde 403. */
  registrationMode: RegistrationMode;
}

/** Sem a variável o registo está aberto (decisão do dono); com ela, só `true` e `approval` o abrem: um erro de escrita fecha-o. */
function toRegistrationMode(value: string | undefined): RegistrationMode {
  if (value === undefined || value === "true") return "open";
  return value === "approval" ? "approval" : "closed";
}

function toPositiveInt(value: string | undefined, fallback: number): number {
```

Em `src/worker/config.ts`, trocar:

```ts
    maxUploadBytes: toPositiveInt(env.MAX_UPLOAD_BYTES, 104_857_600),
    trashRetentionDays: toPositiveInt(env.TRASH_RETENTION_DAYS, 30),
    sessionTtlDays: toPositiveInt(env.SESSION_TTL_DAYS, 14),
    // Sem a variável o registo está aberto (decisão do dono); com ela, só `true` o mantém aberto: um erro de escrita fecha-o.
    registrationOpen: env.REGISTRATION_OPEN === undefined || env.REGISTRATION_OPEN === "true",
  };
}
```

por:

```ts
    maxUploadBytes: toPositiveInt(env.MAX_UPLOAD_BYTES, 104_857_600),
    trashRetentionDays: toPositiveInt(env.TRASH_RETENTION_DAYS, 30),
    sessionTtlDays: toPositiveInt(env.SESSION_TTL_DAYS, 14),
    registrationMode: toRegistrationMode(env.REGISTRATION_OPEN),
  };
}
```

Em `src/worker/lib/sessions.ts`, trocar:

```ts
  return { token };
}

/** Devolve o utilizador da sessão, ou null se o token não existir, tiver expirado ou a conta não estiver ativa. */
export async function findSession(
  db: D1Database,
  token: string,
```

por:

```ts
  return { token };
}

/** Devolve o utilizador da sessão, ou null se o token não existir, tiver expirado ou a conta não estiver ativa e aprovada. */
export async function findSession(
  db: D1Database,
  token: string,
```

Em `src/worker/lib/sessions.ts`, trocar:

```ts
    .prepare(
      `SELECT u.id, u.email, u.role, u.status, u.quota_bytes, u.used_bytes
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?1 AND s.expires_at > ?2 AND u.status = 'active'`,
    )
    .bind(tokenHash, now)
    .first<UserRow>();
```

por:

```ts
    .prepare(
      `SELECT u.id, u.email, u.role, u.status, u.quota_bytes, u.used_bytes
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?1 AND s.expires_at > ?2 AND u.status = 'active' AND u.approved = 1`,
    )
    .bind(tokenHash, now)
    .first<UserRow>();
```

Em `src/worker/lib/users.ts`, trocar:

```ts
    usedBytes: user.usedBytes,
  };
}
```

por:

```ts
    usedBytes: user.usedBytes,
  };
}

/** O utilizador como o frontend o recebe ao entrar e em `/me`; para um administrador, com o número de contas por aprovar. */
export async function toSessionUser(db: D1Database, user: AuthUser): Promise<PublicUser> {
  const publicUser = toPublicUser(user);
  if (user.role !== "admin") return publicUser;
  const row = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE approved = 0 AND status != 'deleting'").first<{ n: number }>();
  return { ...publicUser, pendingApprovals: row?.n ?? 0 };
}
```

Em `src/worker/routes/auth.ts`, trocar:

```ts
import { readJsonObject, readString } from "../lib/http";
import { clearFailures, tryRecordAttempt } from "../lib/login-limit";
import { createSession, deleteSessionByHash, deleteUserSessionsStatement } from "../lib/sessions";
import { rowToAuthUser, toPublicUser, type UserRow } from "../lib/users";
import {
  isValidEmail,
  isValidPassword,
```

por:

```ts
import { readJsonObject, readString } from "../lib/http";
import { clearFailures, tryRecordAttempt } from "../lib/login-limit";
import { createSession, deleteSessionByHash, deleteUserSessionsStatement } from "../lib/sessions";
import { rowToAuthUser, toSessionUser, type UserRow } from "../lib/users";
import {
  isValidEmail,
  isValidPassword,
```

Em `src/worker/routes/auth.ts`, trocar:

```ts
  "Demasiadas tentativas. Tente novamente dentro de 15 minutos.",
] as const;

auth.post("/register", async (c) => {
  const config = getConfig(c.env);
  if (!config.registrationOpen) {
    throw new ApiError(403, "registration_closed", "O registo está fechado. Peça uma conta ao administrador.");
  }
  const body = await readJsonObject(c);
```

por:

```ts
  "Demasiadas tentativas. Tente novamente dentro de 15 minutos.",
] as const;

const PENDING_MESSAGE = "Conta criada. Aguarde a aprovação do administrador.";

auth.post("/register", async (c) => {
  const config = getConfig(c.env);
  if (config.registrationMode === "closed") {
    throw new ApiError(403, "registration_closed", "O registo está fechado. Peça uma conta ao administrador.");
  }
  const body = await readJsonObject(c);
```

Em `src/worker/routes/auth.ts`, trocar:

```ts

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
```

por:

```ts

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const pending = config.registrationMode === "approval";
  try {
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, role, status, approved, quota_bytes, used_bytes, created_at)
       VALUES (?1, ?2, ?3, 'user', 'active', ?4, ?5, 0, ?6)`,
    )
      .bind(id, email, passwordHash, pending ? 0 : 1, config.defaultQuotaBytes, Date.now())
      .run();
  } catch (error) {
    if (isUniqueViolation(error)) {
```

Em `src/worker/routes/auth.ts`, trocar:

```ts
    }
    throw error;
  }

  const { token } = await createSession(c.env.DB, id, config.sessionTtlDays);
  setSessionCookie(c, token, config.sessionTtlDays);
```

por:

```ts
    }
    throw error;
  }

  // Por aprovar: sem sessão. A pessoa só entra depois de um administrador aprovar a conta.
  if (pending) return c.json({ pending: true, message: PENDING_MESSAGE }, 202);

  const { token } = await createSession(c.env.DB, id, config.sessionTtlDays);
  setSessionCookie(c, token, config.sessionTtlDays);
```

Em `src/worker/routes/auth.ts`, trocar:

```ts
    quota_bytes: config.defaultQuotaBytes,
    used_bytes: 0,
  });
  return c.json({ user: toPublicUser(user) }, 201);
});

auth.post("/login", async (c) => {
```

por:

```ts
    quota_bytes: config.defaultQuotaBytes,
    used_bytes: 0,
  });
  return c.json({ user: await toSessionUser(c.env.DB, user) }, 201);
});

auth.post("/login", async (c) => {
```

Em `src/worker/routes/auth.ts`, trocar:

```ts

  const row = await db
    .prepare(
      "SELECT id, email, password_hash, role, status, quota_bytes, used_bytes FROM users WHERE email = ?1",
    )
    .bind(email)
    .first<UserRow & { password_hash: string }>();

  // Contas inexistentes ou em remoção gastam o mesmo tempo de CPU e dão o mesmo erro genérico.
  const usable = row !== null && row.status !== "deleting";
```

por:

```ts

  const row = await db
    .prepare(
      "SELECT id, email, password_hash, role, status, approved, quota_bytes, used_bytes FROM users WHERE email = ?1",
    )
    .bind(email)
    .first<UserRow & { password_hash: string; approved: number }>();

  // Contas inexistentes ou em remoção gastam o mesmo tempo de CPU e dão o mesmo erro genérico.
  const usable = row !== null && row.status !== "deleting";
```

Em `src/worker/routes/auth.ts`, trocar:

```ts

  // Uma senha certa não é uma tentativa falhada, mesmo que a conta esteja suspensa.
  await clearFailures(db, email);
  if (row.status === "suspended") {
    throw new ApiError(403, "account_suspended", "Conta suspensa. Contacte o administrador.");
  }
```

por:

```ts

  // Uma senha certa não é uma tentativa falhada, mesmo que a conta esteja suspensa.
  await clearFailures(db, email);
  if (row.approved === 0) {
    throw new ApiError(403, "account_pending", "A sua conta aguarda a aprovação do administrador.");
  }
  if (row.status === "suspended") {
    throw new ApiError(403, "account_suspended", "Conta suspensa. Contacte o administrador.");
  }
```

Em `src/worker/routes/auth.ts`, trocar:

```ts
  const config = getConfig(c.env);
  const { token } = await createSession(db, row.id, config.sessionTtlDays);
  setSessionCookie(c, token, config.sessionTtlDays);
  return c.json({ user: toPublicUser(rowToAuthUser(row)) });
});

auth.post("/logout", async (c) => {
```

por:

```ts
  const config = getConfig(c.env);
  const { token } = await createSession(db, row.id, config.sessionTtlDays);
  setSessionCookie(c, token, config.sessionTtlDays);
  return c.json({ user: await toSessionUser(db, rowToAuthUser(row)) });
});

auth.post("/logout", async (c) => {
```

Em `src/worker/routes/auth.ts`, trocar:

```ts
  return c.body(null, 204);
});

auth.get("/me", requireAuth, (c) => {
  return c.json({ user: toPublicUser(c.get("user")) });
});

auth.post("/password", requireAuth, async (c) => {
```

por:

```ts
  return c.body(null, 204);
});

auth.get("/me", requireAuth, async (c) => {
  return c.json({ user: await toSessionUser(c.env.DB, c.get("user")) });
});

auth.post("/password", requireAuth, async (c) => {
```

Run: `npx vitest run`
Expected: `Test Files  37 passed (37)`, `Tests  338 passed (338)`.

- [ ] **Step 3: Verificação e commit**

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add migrations src test
git commit -m "O Worker aceita o registo por aprovação e recusa o login de contas por aprovar" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A API de administração: a lista com as contas por aprovar, `approved` no `PATCH` e rejeitar uma conta por aprovar

**Files:**
- Modify: `src/worker/routes/admin.ts`, `src/shared/types.ts`, `test/admin.test.ts`
- Test (os dados de exemplo ganham `approved: true`): `src/web/admin.test.tsx`, `src/web/components/UserActions.test.tsx`, `src/web/pages/AdminPage.test.tsx`

**Interfaces:**
- Consumes: `registerPending`, `insertUser`, `registerAdmin`, `dbWithBatchHook`, `fetchWithEnv` (Task 1 e planos anteriores) e as rotas `GET`, `PATCH` e `DELETE /api/admin/users`.
- Produces: `AdminUser.approved: boolean`; a lista com as contas por aprovar primeiro; `PATCH` com `approved: true` (400 `invalid_approved` para qualquer outro valor); `DELETE` que apaga logo uma conta por aprovar e deixa as outras em `deleting`.

- [ ] **Step 1: Os testes primeiro**

Cinco comportamentos novos: a lista mostra as contas por aprovar primeiro (da mais antiga para a mais recente) e marca `approved`; `approved: true` aprova a conta, que passa a entrar, e baixa o contador de `/me`; é idempotente e aceita a quota no mesmo pedido; só aceita `true` (a aprovação não se desfaz); e rejeitar (`DELETE`) uma conta por aprovar **apaga-a logo** e liberta o email. Há ainda uma corrida: se outro administrador aprovar a conta entre a leitura e a escrita, o `DELETE` não pode apagá-la (a conta passa a `deleting`, como qualquer conta aprovada). O teste que fixa a lista de campos passa a esperar `approved`; as três rotas de administração continuam a ser as mesmas.

Em `test/admin.test.ts`, trocar:

```ts
import { MAX_QUOTA_BYTES } from "../src/shared/validation";
import { app } from "../src/worker/app";
import { runMaintenance } from "../src/worker/cron";
import { insertUser, login, registerAdmin, registerUser } from "./auth-helpers";
import { dbWithBatchHook, dbWithStatementHook, fetchWithEnv } from "./db-helpers";
import { uploadFile, uploadOk, usedBytes } from "./file-helpers";
import { api, buildRequest, resetState, sessionCookie } from "./helpers";
```

por:

```ts
import { MAX_QUOTA_BYTES } from "../src/shared/validation";
import { app } from "../src/worker/app";
import { runMaintenance } from "../src/worker/cron";
import { insertUser, login, registerAdmin, registerPending, registerUser } from "./auth-helpers";
import { dbWithBatchHook, dbWithStatementHook, fetchWithEnv } from "./db-helpers";
import { uploadFile, uploadOk, usedBytes } from "./file-helpers";
import { api, buildRequest, resetState, sessionCookie } from "./helpers";
```

Em `test/admin.test.ts`, trocar:

```ts
    expect(users[1].status).toBe("deleting");
    expect(users[2]).toMatchObject({ role: "admin", status: "active", id: admin.user.id });
    for (const user of users) {
      expect(Object.keys(user).sort()).toEqual(["createdAt", "email", "id", "quotaBytes", "role", "status", "usedBytes"]);
    }
  });

  it("mostra o espaço usado que o upload acumulou", async () => {
```

por:

```ts
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
```

Em `test/admin.test.ts`, trocar:

```ts
    const busy = await patch(admin.cookie, deleting, { quotaBytes: 1 });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ error: "account_deleting" });
  });
});
```

por:

```ts
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
```

Em `test/admin.test.ts`, trocar:

```ts
    expect((await env.FILES.list({ prefix: `u/${ana.user.id}/` })).objects).toHaveLength(1);
  });

  it("é idempotente, não apaga administradores e responde 404 a quem não existe", async () => {
    const admin = await registerAdmin("admin@example.com");
    const other = await registerAdmin("outro@example.com");
```

por:

```ts
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
```

Run: `npx vitest run test/admin.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  7 failed | 15 passed (22)). Falham os testes novos e o da lista de campos.

- [ ] **Step 2: A implementação**

**Lista:** `ORDER BY approved, created_at, id` (as por aprovar primeiro). **`PATCH`:** `approved` só aceita `true` (400 `invalid_approved`); entra no mesmo `UPDATE` por `COALESCE`, por isso pode ir com a quota ou o estado. **`DELETE`:** uma só `batch` com três instruções: apagar a linha se `approved = 0`, pôr em `deleting` se `approved = 1`, e apagar as sessões. Como as duas primeiras filtram por `approved`, **só uma** age, e o resultado é certo mesmo que a conta mude de estado entre a leitura e a escrita. O tipo `AdminUser` ganha `approved`, e os dados de exemplo dos testes da interface que o usam também (senão o `typecheck` falha).

Em `src/shared/types.ts`, trocar:

```ts
  email: string;
  role: Role;
  status: UserStatus;
  quotaBytes: number;
  usedBytes: number;
  createdAt: number;
```

por:

```ts
  email: string;
  role: Role;
  status: UserStatus;
  /** `false`: a conta aguarda que um administrador a aprove (registo por aprovação) e ainda não entra. */
  approved: boolean;
  quotaBytes: number;
  usedBytes: number;
  createdAt: number;
```

Em `src/web/admin.test.tsx`, trocar:

```tsx
import { apiError, json, ME, mockApi, noContent } from "./test/mock-api";
import { queryWrapper, testQueryClient } from "./test/render";

const ANA: AdminUser = { id: "u 1", email: "ana@example.com", role: "user", status: "active", quotaBytes: 100, usedBytes: 10, createdAt: 1 };

describe("useAdminUsers", () => {
  it("devolve as contas", async () => {
```

por:

```tsx
import { apiError, json, ME, mockApi, noContent } from "./test/mock-api";
import { queryWrapper, testQueryClient } from "./test/render";

const ANA: AdminUser = { id: "u 1", email: "ana@example.com", role: "user", status: "active", approved: true, quotaBytes: 100, usedBytes: 10, createdAt: 1 };

describe("useAdminUsers", () => {
  it("devolve as contas", async () => {
```

Em `src/web/components/UserActions.test.tsx`, trocar:

```tsx
import { queryWrapper, testQueryClient } from "../test/render";
import { UserActions } from "./UserActions";

const ANA: AdminUser = { id: "u1", email: "ana@example.com", role: "user", status: "active", quotaBytes: 1_073_741_824, usedBytes: 536_870_912, createdAt: 1 };
const MENU = "Ações para a conta ana@example.com";

function setup(user: AdminUser = ANA) {
```

por:

```tsx
import { queryWrapper, testQueryClient } from "../test/render";
import { UserActions } from "./UserActions";

const ANA: AdminUser = { id: "u1", email: "ana@example.com", role: "user", status: "active", approved: true, quotaBytes: 1_073_741_824, usedBytes: 536_870_912, createdAt: 1 };
const MENU = "Ações para a conta ana@example.com";

function setup(user: AdminUser = ANA) {
```

Em `src/web/pages/AdminPage.test.tsx`, trocar:

```tsx
const CREATED = new Date(2026, 9, 3, 12).getTime();
const ADMIN_ME = { ...ME, id: "adm", email: "admin@example.com", role: "admin" as const, quotaBytes: 10_737_418_240 };

const ADMIN: AdminUser = { id: "adm", email: "admin@example.com", role: "admin", status: "active", quotaBytes: 10_737_418_240, usedBytes: 0, createdAt: CREATED };
const ANA: AdminUser = { id: "u1", email: "ana@example.com", role: "user", status: "active", quotaBytes: 1_073_741_824, usedBytes: 536_870_912, createdAt: CREATED + 1000 };
const BOB: AdminUser = { id: "u2", email: "bob@example.com", role: "user", status: "suspended", quotaBytes: 1_073_741_824, usedBytes: 1536, createdAt: CREATED + 2000 };
const EVA: AdminUser = { id: "u3", email: "eva@example.com", role: "user", status: "deleting", quotaBytes: 1_073_741_824, usedBytes: 0, createdAt: CREATED + 3000 };

function serve(users: AdminUser[], extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
```

por:

```tsx
const CREATED = new Date(2026, 9, 3, 12).getTime();
const ADMIN_ME = { ...ME, id: "adm", email: "admin@example.com", role: "admin" as const, quotaBytes: 10_737_418_240 };

const ADMIN: AdminUser = { id: "adm", email: "admin@example.com", role: "admin", status: "active", approved: true, quotaBytes: 10_737_418_240, usedBytes: 0, createdAt: CREATED };
const ANA: AdminUser = { id: "u1", email: "ana@example.com", role: "user", status: "active", approved: true, quotaBytes: 1_073_741_824, usedBytes: 536_870_912, createdAt: CREATED + 1000 };
const BOB: AdminUser = { id: "u2", email: "bob@example.com", role: "user", status: "suspended", approved: true, quotaBytes: 1_073_741_824, usedBytes: 1536, createdAt: CREATED + 2000 };
const EVA: AdminUser = { id: "u3", email: "eva@example.com", role: "user", status: "deleting", approved: true, quotaBytes: 1_073_741_824, usedBytes: 0, createdAt: CREATED + 3000 };

function serve(users: AdminUser[], extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
```

Em `src/worker/routes/admin.ts`, trocar:

```ts
  email: string;
  role: Role;
  status: UserStatus;
  quota_bytes: number;
  used_bytes: number;
  created_at: number;
}

const COLUMNS = "id, email, role, status, quota_bytes, used_bytes, created_at";

/** A conta tal como o painel a vê: sem a senha nem qualquer outra coluna que não esteja aqui. */
function toAdminUser(row: UserRow): AdminUser {
```

por:

```ts
  email: string;
  role: Role;
  status: UserStatus;
  approved: number;
  quota_bytes: number;
  used_bytes: number;
  created_at: number;
}

const COLUMNS = "id, email, role, status, approved, quota_bytes, used_bytes, created_at";

/** A conta tal como o painel a vê: sem a senha nem qualquer outra coluna que não esteja aqui. */
function toAdminUser(row: UserRow): AdminUser {
```

Em `src/worker/routes/admin.ts`, trocar:

```ts
    email: row.email,
    role: row.role,
    status: row.status,
    quotaBytes: row.quota_bytes,
    usedBytes: row.used_bytes,
    createdAt: row.created_at,
```

por:

```ts
    email: row.email,
    role: row.role,
    status: row.status,
    approved: row.approved === 1,
    quotaBytes: row.quota_bytes,
    usedBytes: row.used_bytes,
    createdAt: row.created_at,
```

Em `src/worker/routes/admin.ts`, trocar:

```ts
  new ApiError(403, "admin_protected", "Uma conta de administrador não se pode suspender nem apagar.");
const accountDeleting = () => new ApiError(409, "account_deleting", "Esta conta está a ser removida.");

/** Todas as contas, da mais antiga para a mais recente (sem paginação na v1), incluindo as que estão a ser removidas. */
admin.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM users ORDER BY created_at, id`).all<UserRow>();
  return c.json({ users: results.map(toAdminUser) });
});

/**
 * Muda a quota (`quotaBytes`, em bytes) e/ou o estado (`status`: `active` ou `suspended`) de uma conta. Uma quota abaixo do uso atual só
 * impede novos uploads. Suspender termina as sessões na mesma `batch` do `UPDATE`: o filtro `status = 'active'` da autenticação não chega,
 * porque ao reativar a conta as sessões antigas voltariam a valer. Uma conta de administrador não se suspende (a quota pode mudar-se) e
 * uma conta em remoção não se mexe.
```

por:

```ts
  new ApiError(403, "admin_protected", "Uma conta de administrador não se pode suspender nem apagar.");
const accountDeleting = () => new ApiError(409, "account_deleting", "Esta conta está a ser removida.");

/**
 * Todas as contas (sem paginação na v1), incluindo as que estão a ser removidas: primeiro as que aguardam aprovação, que são as que pedem
 * uma decisão, e depois as outras; em cada grupo, da mais antiga para a mais recente.
 */
admin.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM users ORDER BY approved, created_at, id`).all<UserRow>();
  return c.json({ users: results.map(toAdminUser) });
});

/**
 * Muda a quota (`quotaBytes`, em bytes), o estado (`status`: `active` ou `suspended`) e/ou aprova a conta (`approved: true`, que não se
 * desfaz: para parar uma conta, suspende-se). Uma quota abaixo do uso atual só
 * impede novos uploads. Suspender termina as sessões na mesma `batch` do `UPDATE`: o filtro `status = 'active'` da autenticação não chega,
 * porque ao reativar a conta as sessões antigas voltariam a valer. Uma conta de administrador não se suspende (a quota pode mudar-se) e
 * uma conta em remoção não se mexe.
```

Em `src/worker/routes/admin.ts`, trocar:

```ts
  const body = await readJsonObject(c);
  const hasQuota = "quotaBytes" in body;
  const hasStatus = "status" in body;
  if (!hasQuota && !hasStatus) throw new ApiError(400, "invalid_body", "Indique a quota e/ou o estado.");
  if (hasQuota && !isValidQuota(body.quotaBytes)) {
    throw new ApiError(400, "invalid_quota", `A quota tem de ser um número inteiro de bytes entre 0 e ${MAX_QUOTA_BYTES}.`);
  }
  if (hasStatus && body.status !== "active" && body.status !== "suspended") {
    throw new ApiError(400, "invalid_status", "O estado só pode ser «active» ou «suspended».");
  }
  if (target.status === "deleting") throw accountDeleting();
  if (hasStatus && target.role === "admin") throw adminProtected();
```

por:

```ts
  const body = await readJsonObject(c);
  const hasQuota = "quotaBytes" in body;
  const hasStatus = "status" in body;
  const hasApproved = "approved" in body;
  if (!hasQuota && !hasStatus && !hasApproved) {
    throw new ApiError(400, "invalid_body", "Indique a quota, o estado e/ou a aprovação.");
  }
  if (hasQuota && !isValidQuota(body.quotaBytes)) {
    throw new ApiError(400, "invalid_quota", `A quota tem de ser um número inteiro de bytes entre 0 e ${MAX_QUOTA_BYTES}.`);
  }
  if (hasStatus && body.status !== "active" && body.status !== "suspended") {
    throw new ApiError(400, "invalid_status", "O estado só pode ser «active» ou «suspended».");
  }
  if (hasApproved && body.approved !== true) {
    throw new ApiError(400, "invalid_approved", "A aprovação só se pode dar: «approved» tem de ser true.");
  }
  if (target.status === "deleting") throw accountDeleting();
  if (hasStatus && target.role === "admin") throw adminProtected();
```

Em `src/worker/routes/admin.ts`, trocar:

```ts
  const statements = [
    db
      .prepare(
        "UPDATE users SET quota_bytes = COALESCE(?1, quota_bytes), status = COALESCE(?2, status) WHERE id = ?3 AND status != 'deleting'",
      )
      .bind(quota, status, target.id),
  ];
  if (status === "suspended") statements.push(deleteUserSessionsStatement(db, target.id));
  const [updated] = await db.batch(statements);
```

por:

```ts
  const statements = [
    db
      .prepare(
        `UPDATE users SET quota_bytes = COALESCE(?1, quota_bytes), status = COALESCE(?2, status), approved = COALESCE(?3, approved)
         WHERE id = ?4 AND status != 'deleting'`,
      )
      .bind(quota, status, hasApproved ? 1 : null, target.id),
  ];
  if (status === "suspended") statements.push(deleteUserSessionsStatement(db, target.id));
  const [updated] = await db.batch(statements);
```

Em `src/worker/routes/admin.ts`, trocar:

```ts
});

/**
 * Apaga uma conta: põe-na em `deleting` e termina as sessões, numa só `batch`. A remoção dos ficheiros e das linhas é do cron
 * (`removeDeletingAccounts`). Idempotente (apagar uma conta já em remoção responde 204 outra vez); o email continua ocupado até o cron acabar.
 */
admin.delete("/users/:id", async (c) => {
  const db = c.env.DB;
  const target = await findUser(db, c.req.param("id"));
  if (target.role === "admin") throw adminProtected();
  await db.batch([
    db.prepare("UPDATE users SET status = 'deleting' WHERE id = ?1 AND role != 'admin'").bind(target.id),
    deleteUserSessionsStatement(db, target.id),
  ]);
  return c.body(null, 204);
```

por:

```ts
});

/**
 * Apaga uma conta, numa só `batch`. Uma conta **por aprovar** (rejeitar o pedido) não tem ficheiros nem sessões: apaga-se de vez e o email
 * fica livre. As outras ficam em `deleting`, com as sessões terminadas, e a remoção dos ficheiros e das linhas é do cron
 * (`removeDeletingAccounts`). Os dois `UPDATE`/`DELETE` filtram por `approved`, e por isso, se a conta for aprovada entre a leitura e a
 * escrita, segue o caminho normal em vez de desaparecer. Idempotente (apagar uma conta já em remoção responde 204 outra vez); o email
 * das contas em `deleting` continua ocupado até o cron acabar.
 */
admin.delete("/users/:id", async (c) => {
  const db = c.env.DB;
  const target = await findUser(db, c.req.param("id"));
  if (target.role === "admin") throw adminProtected();
  await db.batch([
    db.prepare("DELETE FROM users WHERE id = ?1 AND approved = 0 AND role != 'admin'").bind(target.id),
    db.prepare("UPDATE users SET status = 'deleting' WHERE id = ?1 AND approved = 1 AND role != 'admin'").bind(target.id),
    deleteUserSessionsStatement(db, target.id),
  ]);
  return c.body(null, 204);
```

Run: `npx vitest run`
Expected: `Test Files  37 passed (37)`, `Tests  345 passed (345)`.

- [ ] **Step 3: Verificação e commit**

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  36 passed (36)`, `Tests  284 passed (284)` (a interface não mudou de comportamento: só os dados de exemplo ganharam `approved: true`).

Commit:

```bash
git add src test
git commit -m "A API de administração lista, aprova e rejeita contas por aprovar" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: A interface: o registo por aprovação, o aviso no login e o contador na barra lateral

**Files:**
- Modify: `src/web/auth.ts`, `src/web/pages/RegisterPage.tsx`, `src/web/components/AppLayout.tsx`
- Create (testes): `src/web/pages/RegisterPage.test.tsx`, `src/web/pages/LoginPage.test.tsx`
- Test: `src/web/components/AppLayout.test.tsx`

**Interfaces:**
- Consumes: `useRegister`, `useLogin`, `useMe`, `RegisterPage`, `LoginPage`, `AuthCard`, `Message`, `AppLayout`, `PublicUser.pendingApprovals` (Task 1) e `mockApi`, `renderApp`.
- Produces: `RegisterResult` (`{ user } | { pending: true; message }`) e um `useRegister` que só mexe na sessão quando a conta entrou; o ecrã «Conta criada» do registo por aprovação; a ligação «Admin» com «Admin, N contas por aprovar» como nome acessível.

- [ ] **Step 1: Os testes primeiro**

Não havia testes das páginas de registo e de login (só o teste de fumo de ponta a ponta), por isso os ficheiros são novos. `RegisterPage.test.tsx`: o registo aberto continua a entrar e a levar a «Meu espaço», o registo por aprovação **não inicia sessão** e mostra a mensagem do servidor, sem o formulário, com a ligação para entrar, e um erro do servidor fica no formulário. `LoginPage.test.tsx`: uma conta por aprovar mostra a mensagem do servidor e fica no formulário. `AppLayout.test.tsx`: «Admin» diz quantas contas aguardam aprovação (no plural e no singular) e fica como estava quando não há nenhuma. Três destes testes descrevem o que já acontece (passam antes do código): fixam o comportamento para que a mudança não o parta.

Em `src/web/components/AppLayout.test.tsx`, trocar:

```tsx
    await screen.findByRole("navigation", { name: "Principal" });
  });
});
```

por:

```tsx
    await screen.findByRole("navigation", { name: "Principal" });
  });
});

describe("AppLayout: contas por aprovar", () => {
  const ADMIN_ME = { ...ME, id: "adm", email: "admin@example.com", role: "admin" as const };
  const adminLinkName = async (pendingApprovals?: number) => {
    mockApi({ ...CONTENTS, "GET /api/config": SESSION["GET /api/config"], "GET /api/auth/me": () => json({ user: { ...ADMIN_ME, pendingApprovals } }) });
    renderApp("/");
    await screen.findByRole("navigation", { name: "Principal" });
    return within(screen.getByRole("navigation", { name: "Principal" })).getByRole("link", { name: /^Admin/ }).getAttribute("aria-label") ?? "Admin";
  };

  it("«Admin» diz quantas contas aguardam aprovação, no plural e no singular", async () => {
    expect(await adminLinkName(2)).toBe("Admin, 2 contas por aprovar");
    cleanup();
    expect(await adminLinkName(1)).toBe("Admin, 1 conta por aprovar");
  });

  it("sem contas por aprovar (zero, ou o campo em falta) «Admin» fica como estava", async () => {
    expect(await adminLinkName(0)).toBe("Admin");
    cleanup();
    expect(await adminLinkName(undefined)).toBe("Admin");
  });
});
```

Criar `src/web/pages/LoginPage.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { apiError, mockApi } from "../test/mock-api";
import { renderApp } from "../test/render";

describe("LoginPage", () => {
  it("uma conta por aprovar mostra a mensagem do servidor e fica no formulário", async () => {
    mockApi({
      "GET /api/auth/me": () => apiError(401, "unauthorized", "Sessão inválida ou expirada."),
      "POST /api/auth/login": () => apiError(403, "account_pending", "A sua conta aguarda a aprovação do administrador."),
    });
    const user = userEvent.setup();
    renderApp("/login");

    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.type(screen.getByLabelText("Senha"), "senha-segura-123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("A sua conta aguarda a aprovação do administrador.");
    expect(screen.getByLabelText("Email")).toHaveValue("ana@example.com");
  });
});
```

Criar `src/web/pages/RegisterPage.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { apiError, json, ME, mockApi } from "../test/mock-api";
import { renderApp } from "../test/render";

const PENDING = "Conta criada. Aguarde a aprovação do administrador.";
const EMPTY = { folder: null, breadcrumb: [], folders: [], files: [] };

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Email"), "ana@example.com");
  await user.type(screen.getByLabelText("Senha"), "senha-segura-123");
  await user.type(screen.getByLabelText("Confirmar senha"), "senha-segura-123");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));
}

describe("RegisterPage", () => {
  it("o registo aberto inicia sessão e leva a «Meu espaço»", async () => {
    let signedUp = false;
    mockApi({
      "GET /api/auth/me": () => (signedUp ? json({ user: ME }) : apiError(401, "unauthorized", "Sessão inválida ou expirada.")),
      "GET /api/config": () => json({ maxUploadBytes: 104_857_600 }),
      "GET /api/folders/:id/contents": () => json(EMPTY),
      "POST /api/auth/register": () => {
        signedUp = true;
        return json({ user: ME }, 201);
      },
    });
    renderApp("/registo");

    await fillAndSubmit(userEvent.setup());

    expect(await screen.findByRole("heading", { name: "Meu espaço" })).toBeInTheDocument();
  });

  it("o registo por aprovação não inicia sessão: mostra a mensagem do servidor, sem o formulário, e o caminho para entrar", async () => {
    mockApi({
      "GET /api/auth/me": () => apiError(401, "unauthorized", "Sessão inválida ou expirada."),
      "POST /api/auth/register": () => json({ pending: true, message: PENDING }, 202),
    });
    renderApp("/registo");

    await fillAndSubmit(userEvent.setup());

    expect(await screen.findByRole("status")).toHaveTextContent(PENDING);
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Principal" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Entrar" })).toHaveAttribute("href", "/login");
  });

  it("um erro do servidor (por exemplo, o email já registado) fica no formulário", async () => {
    mockApi({
      "GET /api/auth/me": () => apiError(401, "unauthorized", "Sessão inválida ou expirada."),
      "POST /api/auth/register": () => apiError(409, "email_taken", "Este email já está registado."),
    });
    renderApp("/registo");

    await fillAndSubmit(userEvent.setup());

    expect(await screen.findByRole("alert")).toHaveTextContent("Este email já está registado.");
    expect(screen.getByLabelText("Email")).toHaveValue("ana@example.com");
  });
});
```

Run:

```bash
npx vitest run -c vitest.web.config.ts src/web/pages/RegisterPage.test.tsx src/web/pages/LoginPage.test.tsx src/web/components/AppLayout.test.tsx
```
Expected: FAIL (Test Files  2 failed | 1 passed (3); Tests  2 failed | 21 passed (23)). Falham os dois testes que dependem da mudança: o do registo por aprovação e o do contador.

- [ ] **Step 2: A implementação**

**`useRegister`** devolve `RegisterResult`: com a conta entrada (`user`) põe-na na cache da sessão, como antes; com `pending` não toca na sessão (não há sessão). **`RegisterPage`**: se a resposta é `pending`, o formulário dá lugar à mensagem do servidor (`Message` de êxito, que é uma região `status`) e a uma frase a dizer que a pessoa entra quando o administrador aprovar; a ligação «Entrar» continua no rodapé. **`AppLayout`**: a ligação «Admin» ganha um selo com o número (escondido dos leitores de ecrã) e o nome acessível «Admin, N contas por aprovar», só quando há contas por aprovar.

Em `src/web/auth.ts`, trocar:

```ts
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: Credentials) =>
      apiFetch<{ user: PublicUser }>("/api/auth/register", { method: "POST", json: credentials }),
    onSuccess: ({ user }) => queryClient.setQueryData(ME_KEY, user),
  });
}
```

por:

```ts
  });
}

/** A resposta do registo: a conta entrou (registo aberto) ou ficou por aprovar (registo por aprovação: sem sessão). */
export type RegisterResult = { user: PublicUser } | { pending: true; message: string };

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: Credentials) =>
      apiFetch<RegisterResult>("/api/auth/register", { method: "POST", json: credentials }),
    // Por aprovar não há sessão: não se mexe na cache da sessão, e a página mostra a mensagem do servidor.
    onSuccess: (result) => {
      if ("user" in result) queryClient.setQueryData(ME_KEY, result.user);
    },
  });
}
```

Em `src/web/components/AppLayout.tsx`, trocar:

```tsx
import { SearchBox } from "./SearchBox";
import { UploadPanel } from "./UploadPanel";
import { UsageBar } from "./UsageBar";

function navClass({ isActive }: { isActive: boolean }): string {
  return `block rounded-lg px-3 py-2 text-sm font-medium ${
```

por:

```tsx
import { SearchBox } from "./SearchBox";
import { UploadPanel } from "./UploadPanel";
import { UsageBar } from "./UsageBar";

/** «2 contas por aprovar» / «1 conta por aprovar». */
const pendingLabel = (count: number) => (count === 1 ? "1 conta por aprovar" : `${count} contas por aprovar`);

function navClass({ isActive }: { isActive: boolean }): string {
  return `block rounded-lg px-3 py-2 text-sm font-medium ${
```

Em `src/web/components/AppLayout.tsx`, trocar:

```tsx
  }
  if (!me.data) return <Navigate to="/login" replace />;
  const user = me.data;

  return (
    // `key`: se o `me` passar a outro utilizador no mesmo separador, a fila do anterior cancela-se (`cancelAll`).
```

por:

```tsx
  }
  if (!me.data) return <Navigate to="/login" replace />;
  const user = me.data;
  const pendingApprovals = user.pendingApprovals ?? 0;

  return (
    // `key`: se o `me` passar a outro utilizador no mesmo separador, a fila do anterior cancela-se (`cancelAll`).
```

Em `src/web/components/AppLayout.tsx`, trocar:

```tsx
              Conta
            </NavLink>
            {user.role === "admin" && (
              <NavLink to="/admin" className={navClass}>
                Admin
              </NavLink>
            )}
          </nav>
```

por:

```tsx
              Conta
            </NavLink>
            {user.role === "admin" && (
              <NavLink to="/admin" className={navClass} aria-label={pendingApprovals > 0 ? `Admin, ${pendingLabel(pendingApprovals)}` : undefined}>
                Admin
                {pendingApprovals > 0 && (
                  <span aria-hidden="true" className="ml-2 rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">
                    {pendingApprovals}
                  </span>
                )}
              </NavLink>
            )}
          </nav>
```

Em `src/web/pages/RegisterPage.tsx`, trocar:

```tsx
  }

  const error = localError ?? register.error?.message ?? null;

  return (
    <AuthCard
```

por:

```tsx
  }

  const error = localError ?? register.error?.message ?? null;

  // Registo por aprovação: a conta existe mas ainda não entra, por isso o formulário dá lugar à mensagem do servidor.
  if (register.data && "pending" in register.data) {
    return (
      <AuthCard
        title="Conta criada"
        footer={
          <>
            Já tem conta?{" "}
            <Link to="/login" className="font-medium text-indigo-600 hover:underline">
              Entrar
            </Link>
          </>
        }
      >
        <div className="space-y-4">
          <Message kind="success">{register.data.message}</Message>
          <p className="text-sm text-slate-600">Quando o administrador a aprovar, entre com o seu email e a sua senha.</p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
```

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  38 passed (38)`, `Tests  290 passed (290)`.

- [ ] **Step 3: Verificação e commit**

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src
git commit -m "O registo por aprovação na interface: ecrã de registo e contador na barra lateral" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: O painel do administrador: «Aguarda aprovação», «Aprovar» e «Rejeitar…»

**Files:**
- Create: `src/web/components/PendingActions.tsx`
- Modify: `src/web/admin.ts`, `src/web/pages/AdminPage.tsx`
- Test: `src/web/admin.test.tsx`, `src/web/pages/AdminPage.test.tsx`, `src/web/components/PendingActions.test.tsx` (novo)

**Interfaces:**
- Consumes: `useUpdateUser`, `useDeleteUser`, `useDialog`, `ConfirmDialog`, `Button`, `UserActions`, `AdminUser.approved` (Task 2) e `PublicUser.pendingApprovals` (Task 1).
- Produces: `useUpdateUser` que aceita `approved: true`; `PendingActions` (`user: AdminUser`), com «Aprovar a conta X» e «Rejeitar o pedido de X»; no painel, a linha de uma conta por aprovar mostra «Aguarda aprovação» e só estas duas ações, e a página diz quantas contas aguardam.

- [ ] **Step 1: Os testes primeiro**

`PendingActions.test.tsx` (novo): «Aprovar» envia `approved: true` **sem pedir confirmação** (não se perde nada) e um erro aparece por baixo dos botões; «Rejeitar…» pede confirmação, «Cancelar» não apaga nada, confirmar apaga e fecha o diálogo, e um erro fica no diálogo. `AdminPage.test.tsx`: as contas por aprovar mostram «Aguarda aprovação» e só as duas ações (as outras contas continuam com o menu), a página diz quantas são (plural e singular) e não diz nada quando não há; aprovar passa a conta a «Ativa», com o menu normal, e o contador da barra lateral baixa (a sessão refaz-se); rejeitar apaga a conta da lista. `admin.test.tsx`: o hook envia `approved: true` e refaz a lista e a sessão.

Em `src/web/admin.test.tsx`, trocar:

```tsx
    });
  });

  it("apagar usa DELETE com o id codificado e refaz a lista; um erro também a refaz", async () => {
    let fail = false;
    const server = mockApi({
```

por:

```tsx
    });
  });

  it("aprovar uma conta envia `approved: true` e refaz a lista e a sessão (o contador de contas por aprovar da barra lateral)", async () => {
    const server = mockApi({
      "GET /api/admin/users": () => json({ users: [ANA] }),
      "GET /api/auth/me": () => json({ user: ME }),
      "PATCH /api/admin/users/:id": () => json({ user: ANA }),
    });
    const hook = renderHook(() => ({ users: useAdminUsers(), me: useMe(), update: useUpdateUser() }), { wrapper: queryWrapper(testQueryClient()) });
    await waitFor(() => expect(hook.result.current.users.isSuccess && hook.result.current.me.isSuccess).toBe(true));

    await act(async () => {
      await hook.result.current.update.mutateAsync({ id: "u 1", approved: true });
    });

    expect(server.callsTo("PATCH /api/admin/users/:id")[0]).toMatchObject({ path: "/api/admin/users/u%201", body: { approved: true } });
    await waitFor(() => {
      expect(server.callsTo("GET /api/admin/users").length).toBeGreaterThanOrEqual(2);
      expect(server.callsTo("GET /api/auth/me").length).toBeGreaterThanOrEqual(2);
    });
  });

  it("apagar usa DELETE com o id codificado e refaz a lista; um erro também a refaz", async () => {
    let fail = false;
    const server = mockApi({
```

Criar `src/web/components/PendingActions.test.tsx`:

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AdminUser } from "../../shared/types";
import { apiError, json, mockApi, noContent } from "../test/mock-api";
import { queryWrapper, testQueryClient } from "../test/render";
import { PendingActions } from "./PendingActions";

const BOB: AdminUser = { id: "u2", email: "bob@example.com", role: "user", status: "active", approved: false, quotaBytes: 1_073_741_824, usedBytes: 0, createdAt: 1 };
const APPROVE = "Aprovar a conta bob@example.com";
const REJECT = "Rejeitar o pedido de bob@example.com";

function setup() {
  const user = userEvent.setup();
  const Wrapper = queryWrapper(testQueryClient());
  render(
    <Wrapper>
      <PendingActions user={BOB} />
    </Wrapper>,
  );
  return user;
}

describe("PendingActions", () => {
  it("«Aprovar» envia `approved: true` e não pede confirmação (não perde nada)", async () => {
    const server = mockApi({ "PATCH /api/admin/users/:id": () => json({ user: { ...BOB, approved: true } }) });
    const user = setup();

    await user.click(screen.getByRole("button", { name: APPROVE }));

    await waitFor(() => expect(server.callsTo("PATCH /api/admin/users/:id")).toHaveLength(1));
    expect(server.callsTo("PATCH /api/admin/users/:id")[0]).toMatchObject({ params: { id: "u2" }, body: { approved: true } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("um erro ao aprovar aparece por baixo dos botões", async () => {
    mockApi({ "PATCH /api/admin/users/:id": () => apiError(409, "account_deleting", "Esta conta está a ser removida.") });
    const user = setup();

    await user.click(screen.getByRole("button", { name: APPROVE }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Esta conta está a ser removida.");
  });

  it("«Rejeitar…» pede confirmação, e «Cancelar» não apaga nada", async () => {
    const server = mockApi({ "DELETE /api/admin/users/:id": () => noContent() });
    const user = setup();

    await user.click(screen.getByRole("button", { name: REJECT }));
    const dialog = screen.getByRole("dialog", { name: "Rejeitar pedido" });
    expect(dialog).toHaveTextContent("bob@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.callsTo("DELETE /api/admin/users/:id")).toHaveLength(0);
  });

  it("confirmar a rejeição apaga a conta e fecha o diálogo", async () => {
    const server = mockApi({ "DELETE /api/admin/users/:id": () => noContent() });
    const user = setup();

    await user.click(screen.getByRole("button", { name: REJECT }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rejeitar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.callsTo("DELETE /api/admin/users/:id")[0]).toMatchObject({ params: { id: "u2" } });
  });

  it("um erro ao rejeitar fica no diálogo, que continua aberto", async () => {
    mockApi({ "DELETE /api/admin/users/:id": () => apiError(500, "internal_error", "Erro interno do servidor.") });
    const user = setup();

    await user.click(screen.getByRole("button", { name: REJECT }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rejeitar" }));

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("Erro interno do servidor.");
  });
});
```

Em `src/web/pages/AdminPage.test.tsx`, trocar:

```tsx
const ADMIN: AdminUser = { id: "adm", email: "admin@example.com", role: "admin", status: "active", approved: true, quotaBytes: 10_737_418_240, usedBytes: 0, createdAt: CREATED };
const ANA: AdminUser = { id: "u1", email: "ana@example.com", role: "user", status: "active", approved: true, quotaBytes: 1_073_741_824, usedBytes: 536_870_912, createdAt: CREATED + 1000 };
const BOB: AdminUser = { id: "u2", email: "bob@example.com", role: "user", status: "suspended", approved: true, quotaBytes: 1_073_741_824, usedBytes: 1536, createdAt: CREATED + 2000 };
const EVA: AdminUser = { id: "u3", email: "eva@example.com", role: "user", status: "deleting", approved: true, quotaBytes: 1_073_741_824, usedBytes: 0, createdAt: CREATED + 3000 };

function serve(users: AdminUser[], extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    ...SESSION,
```

por:

```tsx
const ADMIN: AdminUser = { id: "adm", email: "admin@example.com", role: "admin", status: "active", approved: true, quotaBytes: 10_737_418_240, usedBytes: 0, createdAt: CREATED };
const ANA: AdminUser = { id: "u1", email: "ana@example.com", role: "user", status: "active", approved: true, quotaBytes: 1_073_741_824, usedBytes: 536_870_912, createdAt: CREATED + 1000 };
const BOB: AdminUser = { id: "u2", email: "bob@example.com", role: "user", status: "suspended", approved: true, quotaBytes: 1_073_741_824, usedBytes: 1536, createdAt: CREATED + 2000 };
const EVA: AdminUser = { id: "u3", email: "eva@example.com", role: "user", status: "deleting", approved: true, quotaBytes: 1_073_741_824, usedBytes: 0, createdAt: CREATED + 3000 };

const NOVA: AdminUser = { id: "u4", email: "nova@example.com", role: "user", status: "active", approved: false, quotaBytes: 1_073_741_824, usedBytes: 0, createdAt: CREATED + 4000 };
const OUTRA: AdminUser = { id: "u5", email: "outra@example.com", role: "user", status: "active", approved: false, quotaBytes: 1_073_741_824, usedBytes: 0, createdAt: CREATED + 5000 };

function serve(users: AdminUser[], extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    ...SESSION,
```

Em `src/web/pages/AdminPage.test.tsx`, trocar:

```tsx
    await waitFor(() => expect(screen.getAllByText("0 B de 20 GB")).toHaveLength(2));
  });
});
```

por:

```tsx
    await waitFor(() => expect(screen.getAllByText("0 B de 20 GB")).toHaveLength(2));
  });
});

describe("AdminPage: contas por aprovar", () => {
  it("mostra «Aguarda aprovação» e só «Aprovar» e «Rejeitar…» nessas contas, e diz quantas são", async () => {
    serve([NOVA, OUTRA, ADMIN, ANA]);
    renderApp("/admin");

    expect(await screen.findByText("2 contas aguardam a sua aprovação.")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    const nova = rows[0];
    expect(within(nova).getByText("nova@example.com")).toBeInTheDocument();
    expect(within(nova).getByText("Aguarda aprovação")).toBeInTheDocument();
    expect(within(nova).getByRole("button", { name: "Aprovar a conta nova@example.com" })).toBeInTheDocument();
    expect(within(nova).getByRole("button", { name: "Rejeitar o pedido de nova@example.com" })).toBeInTheDocument();
    expect(within(nova).queryByRole("button", { name: /^Ações para a conta/ })).not.toBeInTheDocument();
    // as outras contas continuam com o menu de sempre
    expect(within(rows[3]).getByRole("button", { name: "Ações para a conta ana@example.com" })).toBeInTheDocument();
  });

  it("no singular a mensagem concorda", async () => {
    serve([NOVA, ADMIN]);
    renderApp("/admin");
    expect(await screen.findByText("1 conta aguarda a sua aprovação.")).toBeInTheDocument();
  });

  it("sem contas por aprovar não aparece a mensagem", async () => {
    serve([ADMIN, ANA]);
    renderApp("/admin");
    await screen.findByRole("heading", { name: "Utilizadores" });
    expect(screen.queryByText(/aguarda(m)? a sua aprovação/)).not.toBeInTheDocument();
  });

  it("aprovar passa a conta a «Ativa», com o menu normal, e o contador da barra lateral baixa", async () => {
    let approved = false;
    const server = serve([], {
      "GET /api/auth/me": () => json({ user: { ...ADMIN_ME, pendingApprovals: approved ? 0 : 1 } }),
      "GET /api/admin/users": () => json({ users: [approved ? { ...NOVA, approved: true } : NOVA, ADMIN] }),
      "PATCH /api/admin/users/:id": () => {
        approved = true;
        return json({ user: { ...NOVA, approved: true } });
      },
    });
    const user = userEvent.setup();
    renderApp("/admin");
    expect(await screen.findByRole("link", { name: "Admin, 1 conta por aprovar" })).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Aprovar a conta nova@example.com" }));

    const row = (await screen.findByRole("button", { name: "Ações para a conta nova@example.com" })).closest("tr")!;
    expect(within(row).getByText("Ativa")).toBeInTheDocument();
    expect(within(row).queryByText("Aguarda aprovação")).not.toBeInTheDocument();
    expect(server.callsTo("PATCH /api/admin/users/:id")[0].body).toEqual({ approved: true });
    expect(screen.queryByText(/aguarda(m)? a sua aprovação/)).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Admin" })).toBeInTheDocument();
  });

  it("rejeitar pede confirmação e a conta desaparece da lista", async () => {
    let rejected = false;
    const server = serve([], {
      "GET /api/admin/users": () => json({ users: rejected ? [ADMIN] : [NOVA, ADMIN] }),
      "DELETE /api/admin/users/:id": () => {
        rejected = true;
        return new Response(null, { status: 204 });
      },
    });
    const user = userEvent.setup();
    renderApp("/admin");
    await user.click(await screen.findByRole("button", { name: "Rejeitar o pedido de nova@example.com" }));
    await user.click(within(screen.getByRole("dialog", { name: "Rejeitar pedido" })).getByRole("button", { name: "Rejeitar" }));

    await waitFor(() => expect(screen.queryByText("nova@example.com")).not.toBeInTheDocument());
    expect(server.callsTo("DELETE /api/admin/users/:id")[0].params).toEqual({ id: "u4" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
```

Run:

```bash
npx vitest run -c vitest.web.config.ts src/web/components/PendingActions.test.tsx src/web/pages/AdminPage.test.tsx
```
Expected: FAIL (Test Files  2 failed (2); Tests  4 failed | 9 passed (13)). O `PendingActions.test.tsx` nem arranca (o componente ainda não existe) e falham os testes novos do painel.

- [ ] **Step 2: A implementação**

**`PendingActions`** põe as duas decisões à vista, sem menu: «Aprovar» (não pede confirmação) e «Rejeitar…» (confirma, e apaga o pedido de vez). Os botões levam o email no nome acessível (`Aprovar a conta …`, `Rejeitar o pedido de …`), para o leitor de ecrã e para os testes distinguirem as linhas. **`AdminPage`**: o estado de uma conta por aprovar é «Aguarda aprovação» (não há estado de utilização para mostrar), a ação da linha é `PendingActions` em vez de `UserActions`, e acima da tabela uma frase diz quantas contas aguardam a aprovação. **`useUpdateUser`** aceita `approved: true`; os dois hooks já refazem a lista e a sessão no fim, que é o que faz o contador da barra lateral baixar.

Em `src/web/admin.ts`, trocar:

```ts
  });
}

/** Muda a quota (em bytes) e/ou o estado (`active` ou `suspended`) de uma conta. */
export function useUpdateUser() {
  return useAdminMutation(({ id, ...changes }: { id: string; quotaBytes?: number; status?: "active" | "suspended" }) =>
    apiFetch<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", json: changes }),
  );
}

/** Apaga uma conta: passa a «em remoção» e o cron elimina-a (os ficheiros e o utilizador) na hora seguinte. */
export function useDeleteUser() {
  return useAdminMutation((id: string) => apiFetch(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" }));
}
```

por:

```ts
  });
}

/** Muda a quota (em bytes) e/ou o estado (`active` ou `suspended`) de uma conta, ou aprova-a (`approved: true`; a aprovação não se desfaz). */
export function useUpdateUser() {
  return useAdminMutation(({ id, ...changes }: { id: string; quotaBytes?: number; status?: "active" | "suspended"; approved?: true }) =>
    apiFetch<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", json: changes }),
  );
}

/**
 * Apaga uma conta: passa a «em remoção» e o cron elimina-a (os ficheiros e o utilizador) na hora seguinte. Uma conta por aprovar
 * (rejeitar o pedido) apaga-se logo, porque não tem ficheiros.
 */
export function useDeleteUser() {
  return useAdminMutation((id: string) => apiFetch(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" }));
}
```

Criar `src/web/components/PendingActions.tsx`:

```tsx
import type { AdminUser } from "../../shared/types";
import { useDeleteUser, useUpdateUser } from "../admin";
import { errorMessage } from "../api";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { useDialog } from "./useDialog";

/**
 * As ações de uma conta que aguarda aprovação (registo por aprovação): «Aprovar» (a conta passa a entrar; não pede confirmação, porque
 * não se perde nada) e «Rejeitar…» (apaga o pedido de vez, com confirmação). Estão à vista, sem menu: é a decisão que a linha pede.
 */
export function PendingActions({ user }: { user: AdminUser }) {
  const update = useUpdateUser();
  const remove = useDeleteUser();
  const { dialog, open, close } = useDialog<"reject">(update, remove);
  const updateError = update.error ? errorMessage(update.error) : null;

  return (
    <>
      <div className="flex gap-2 whitespace-nowrap">
        <Button
          className="px-3 py-1.5"
          disabled={update.isPending}
          aria-label={`Aprovar a conta ${user.email}`}
          onClick={() => update.mutate({ id: user.id, approved: true })}
        >
          Aprovar
        </Button>
        <Button
          variant="secondary"
          className="px-3 py-1.5"
          aria-label={`Rejeitar o pedido de ${user.email}`}
          onClick={() => {
            update.reset(); // um erro de «Aprovar» não pode aparecer num diálogo que ainda ninguém confirmou
            open("reject");
          }}
        >
          Rejeitar…
        </Button>
      </div>
      {dialog === null && updateError && (
        <p role="alert" className="mt-1 max-w-56 text-xs whitespace-normal text-red-700">
          {updateError}
        </p>
      )}
      {dialog === "reject" && (
        <ConfirmDialog
          title="Rejeitar pedido"
          message={`Rejeitar o pedido de «${user.email}»? A conta é apagada já e o email fica livre. Isto não se pode desfazer.`}
          confirmLabel="Rejeitar"
          pendingLabel="A rejeitar…"
          pending={remove.isPending}
          error={remove.error ? errorMessage(remove.error) : null}
          onConfirm={() => remove.mutate(user.id, { onSuccess: close })}
          onClose={close}
        />
      )}
    </>
  );
}
```

Em `src/web/pages/AdminPage.tsx`, trocar:

```tsx
import { Loading } from "../components/Loading";
import { Message } from "../components/Message";
import { UsageBar } from "../components/UsageBar";
import { UserActions } from "../components/UserActions";

const STATUS_LABEL: Record<UserStatus, string> = { active: "Ativa", suspended: "Suspensa", deleting: "A remover" };
```

por:

```tsx
import { Loading } from "../components/Loading";
import { Message } from "../components/Message";
import { UsageBar } from "../components/UsageBar";
import { PendingActions } from "../components/PendingActions";
import { UserActions } from "../components/UserActions";

const STATUS_LABEL: Record<UserStatus, string> = { active: "Ativa", suspended: "Suspensa", deleting: "A remover" };
```

Em `src/web/pages/AdminPage.tsx`, trocar:

```tsx
  suspended: "bg-amber-50 text-amber-800",
  deleting: "bg-slate-100 text-slate-600",
};

function UserRow({ user, isSelf, actions }: { user: AdminUser; isSelf: boolean; actions?: ReactNode }) {
  return (
```

por:

```tsx
  suspended: "bg-amber-50 text-amber-800",
  deleting: "bg-slate-100 text-slate-600",
};

/** O estado que a linha mostra: uma conta por aprovar ainda não tem estado de utilização. */
const PENDING_LABEL = "Aguarda aprovação";
const PENDING_STYLE = "bg-indigo-50 text-indigo-700";

function UserRow({ user, isSelf, actions }: { user: AdminUser; isSelf: boolean; actions?: ReactNode }) {
  return (
```

Em `src/web/pages/AdminPage.tsx`, trocar:

```tsx
        <UsageBar usedBytes={user.usedBytes} quotaBytes={user.quotaBytes} label={`Espaço usado por ${user.email}`} />
      </td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[user.status]}`}>{STATUS_LABEL[user.status]}</span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDate(user.createdAt)}</td>
      <td className="w-12 px-4 py-3">{actions}</td>
```

por:

```tsx
        <UsageBar usedBytes={user.usedBytes} quotaBytes={user.quotaBytes} label={`Espaço usado por ${user.email}`} />
      </td>
      <td className="px-4 py-3">
        {user.approved ? (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[user.status]}`}>{STATUS_LABEL[user.status]}</span>
        ) : (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PENDING_STYLE}`}>{PENDING_LABEL}</span>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDate(user.createdAt)}</td>
      <td className="w-12 px-4 py-3">{actions}</td>
```

Em `src/web/pages/AdminPage.tsx`, trocar:

```tsx
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
```

por:

```tsx
    );
  }

  const pending = users.data.filter((user) => !user.approved).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
```

Em `src/web/pages/AdminPage.tsx`, trocar:

```tsx
      <p className="mt-2 text-sm text-slate-600">
        {users.data.length} {users.data.length === 1 ? "conta" : "contas"}. Uma conta apagada passa a «A remover» e a manutenção por hora elimina-a, com os ficheiros.
      </p>
      {users.isError && (
        <div className="mt-4">
          <Message kind="error">{errorMessage(users.error)}</Message>
```

por:

```tsx
      <p className="mt-2 text-sm text-slate-600">
        {users.data.length} {users.data.length === 1 ? "conta" : "contas"}. Uma conta apagada passa a «A remover» e a manutenção por hora elimina-a, com os ficheiros.
      </p>
      {pending > 0 && (
        <p className="mt-2 text-sm font-medium text-indigo-700">
          {pending === 1 ? "1 conta aguarda a sua aprovação." : `${pending} contas aguardam a sua aprovação.`}
        </p>
      )}
      {users.isError && (
        <div className="mt-4">
          <Message kind="error">{errorMessage(users.error)}</Message>
```

Em `src/web/pages/AdminPage.tsx`, trocar:

```tsx
                key={user.id}
                user={user}
                isSelf={user.id === me.data?.id}
                actions={user.status === "deleting" ? undefined : <UserActions user={user} />}
              />
            ))}
          </tbody>
```

por:

```tsx
                key={user.id}
                user={user}
                isSelf={user.id === me.data?.id}
                actions={user.status === "deleting" ? undefined : user.approved ? <UserActions user={user} /> : <PendingActions user={user} />}
              />
            ))}
          </tbody>
```

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  39 passed (39)`, `Tests  301 passed (301)`.

- [ ] **Step 3: Verificação e commit**

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src
git commit -m "O painel do administrador aprova e rejeita as contas por aprovar" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: A produção em modo de aprovação, as suítes que continuam a partir do registo aberto e a documentação

**Files:**
- Modify: `wrangler.jsonc`, `worker-configuration.d.ts` (gerado), `vitest.config.ts`, `vite.config.ts`, `playwright.config.ts`
- Modify: `README.md`, `docs/superpowers/plans/README.md`

**Interfaces:**
- Consumes: tudo o que as Tasks 1 a 4 entregam, o `config` do plugin da Cloudflare para o Vite e as variáveis de ambiente `E2E_STATE` (`vite.config.ts`, planos 5A).
- Produces: `REGISTRATION_OPEN = "approval"` em `wrangler.jsonc`; os testes do Worker e os de ponta a ponta com o registo aberto na sua própria configuração; o README e o índice dos planos com o Plano 6 «Concluído».

- [ ] **Step 1: A produção passa a «por aprovação» (e as suítes avisam)**

Fecha-se a decisão do dono: `wrangler.jsonc` fica com `"REGISTRATION_OPEN": "approval"`, e `npm run cf-typegen` regenera os tipos (`REGISTRATION_OPEN: "approval"`). Isto parte as duas suítes que **criam contas e entram logo**: os testes do Worker (`registerUser` espera 201 e uma sessão) e os de ponta a ponta (`signUp`). Os dois pedidos seguintes mostram-no.

Em `wrangler.jsonc`, trocar:

```
    "MAX_UPLOAD_BYTES": "104857600",
    "TRASH_RETENTION_DAYS": "30",
    "SESSION_TTL_DAYS": "14",
    "REGISTRATION_OPEN": "true"
  }
}
```

por:

```
    "MAX_UPLOAD_BYTES": "104857600",
    "TRASH_RETENTION_DAYS": "30",
    "SESSION_TTL_DAYS": "14",
    "REGISTRATION_OPEN": "approval"
  }
}
```

Run: `npm run cf-typegen`
Expected: o `wrangler` regenera `worker-configuration.d.ts`; a única diferença é `REGISTRATION_OPEN: "approval";` (e o `hash` do cabeçalho).

Run: `npx vitest run`
Expected: FAIL (Test Files  24 failed | 13 passed (37); Tests  221 failed | 124 passed (345)). Falham os testes que registam uma conta e esperam entrar logo.

Run: `npx playwright test e2e/smoke.spec.ts`
Expected: FAIL (`1 failed`, `0 passed`). O teste de fumo regista uma conta e fica sem sessão (o servidor responde 202).

- [ ] **Step 2: Os testes do Worker partem do registo aberto**

`miniflare.bindings` do Vitest sobrepõe a variável: os testes partem do registo aberto e, quando precisam de outro modo, escolhem-no por pedido (`fetchWithEnv` com `REGISTRATION_OPEN`).

Em `vitest.config.ts`, trocar:

```ts
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      };
    }),
  ],
```

por:

```ts
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        // A produção tem o registo por aprovação (`wrangler.jsonc`): os testes partem do registo aberto e escolhem o modo quando precisam.
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, REGISTRATION_OPEN: "true" } },
      };
    }),
  ],
```

Run: `npx vitest run`
Expected: `Test Files  37 passed (37)`, `Tests  345 passed (345)`.

- [ ] **Step 3: Os testes de ponta a ponta partem do registo aberto**

O plugin da Cloudflare deixa personalizar a configuração do Worker (`config`). Quando `E2E_STATE` existe, `vite.config.ts` põe `REGISTRATION_OPEN` a `true` na construção, e `playwright.config.ts` passa a dar `E2E_STATE` também ao `npm run build`. A construção de produção, sem essa variável, fica com `approval`. (A alternativa, deixar `true` no repositório e escolher `approval` no comando de deploy, deixava um `npm run deploy` à mão abrir o registo em silêncio.)

Em `playwright.config.ts`, trocar:

```ts
    // `dist/` apagado e o ficheiro de redirecionamento ainda lá, migrar primeiro falha.
    command: [
      `rm -rf ${STATE_DIR}`,
      "npm run build",
      `npx wrangler d1 migrations apply DB --local --persist-to ${STATE_DIR}`,
      `E2E_STATE=${STATE_DIR} npx vite preview --port ${PORT} --strictPort`,
    ].join(" && "),
```

por:

```ts
    // `dist/` apagado e o ficheiro de redirecionamento ainda lá, migrar primeiro falha.
    command: [
      `rm -rf ${STATE_DIR}`,
      // `E2E_STATE` também na construção: o `vite.config.ts` põe então o registo aberto nessa construção (a que vai para produção não o tem).
      `E2E_STATE=${STATE_DIR} npm run build`,
      `npx wrangler d1 migrations apply DB --local --persist-to ${STATE_DIR}`,
      `E2E_STATE=${STATE_DIR} npx vite preview --port ${PORT} --strictPort`,
    ].join(" && "),
```

Em `vite.config.ts`, trocar:

```ts

export default defineConfig({
  // `E2E_STATE` (só nos testes de ponta a ponta) manda guardar a D1 e o R2 simulados noutra pasta, para não mexerem na `.wrangler` de desenvolvimento.
  plugins: [react(), tailwindcss(), cloudflare({ persistState: process.env.E2E_STATE ? { path: process.env.E2E_STATE } : true })],
});
```

por:

```ts

export default defineConfig({
  // `E2E_STATE` (só nos testes de ponta a ponta) manda guardar a D1 e o R2 simulados noutra pasta, para não mexerem na `.wrangler` de desenvolvimento.
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({
      persistState: process.env.E2E_STATE ? { path: process.env.E2E_STATE } : true,
      // Nos testes de ponta a ponta o registo é aberto (cada teste cria a sua conta e entra logo); a produção usa o registo por aprovação.
      config: (userConfig) => (process.env.E2E_STATE ? { vars: { ...userConfig.vars, REGISTRATION_OPEN: "true" } } : undefined),
    }),
  ],
});
```

Run: `npx playwright test`
Expected: `22 passed` (a duração varia). (a suíte inteira, agora com a construção que tem o registo aberto só para os testes).

- [ ] **Step 4: README e índice dos planos**

O README descreve a API (a lista com `approved`, o `PATCH` com `approved`, o `DELETE` de uma conta por aprovar, o registo em três modos, `pendingApprovals` em `/me`), o painel e a variável `REGISTRATION_OPEN`. O índice passa o Plano 6 a «Concluído». A especificação já foi atualizada antes deste plano.

Em `README.md`, trocar:

```markdown
| `DELETE /api/shares/:id` | Revoga um link |
| `GET /api/public/shares/:token` | Público: nome e tamanho do ficheiro partilhado |
| `GET /api/public/shares/:token/download` | Público: descarrega o ficheiro partilhado (sempre como anexo) |
| `GET /api/admin/users` | Só admin: as contas (`id`, `email`, `role`, `status`, `quotaBytes`, `usedBytes`, `createdAt`), da mais antiga para a mais recente, incluindo as que estão a ser removidas |
| `PATCH /api/admin/users/:id` | Só admin: `{ quotaBytes?, status? }`. `quotaBytes` é um inteiro de bytes entre 0 e 2^50; `status` é `active` ou `suspended` (suspender termina as sessões da conta). Numa conta de admin só a quota muda (403 `admin_protected`); uma conta em remoção não se altera (409 `account_deleting`) |
| `DELETE /api/admin/users/:id` | Só admin: marca a conta para remoção (`deleting`) e termina as sessões; a remoção é do cron. Responde 204, também se a conta já estava em remoção; uma conta de admin não se apaga (403 `admin_protected`) |

Um link só funciona se não foi revogado nem expirou, o ficheiro está fora da lixeira e a conta do dono está ativa; nos outros casos a resposta é sempre `404 share_not_found`, sem dizer porquê.

As rotas `/api/admin/*` exigem também `role = admin` (senão 403 `forbidden`) e só gerem contas e quotas: **não há nenhuma rota para ver ou descarregar os ficheiros de outros utilizadores**, e o admin não consegue repor a senha de ninguém.

O registo pode fechar-se com a variável `REGISTRATION_OPEN` (ver «Configuração»): fechado, `POST /api/auth/register` responde `403 registration_closed` e quem já tem conta continua a entrar. `GET /api/health` responde `200 { "ok": true }` ou, com a D1 em baixo, `503 { "ok": false }`.

## Interface
```

por:

```markdown
| `DELETE /api/shares/:id` | Revoga um link |
| `GET /api/public/shares/:token` | Público: nome e tamanho do ficheiro partilhado |
| `GET /api/public/shares/:token/download` | Público: descarrega o ficheiro partilhado (sempre como anexo) |
| `GET /api/admin/users` | Só admin: as contas (`id`, `email`, `role`, `status`, `approved`, `quotaBytes`, `usedBytes`, `createdAt`): primeiro as que aguardam aprovação e depois as outras, da mais antiga para a mais recente, incluindo as que estão a ser removidas |
| `PATCH /api/admin/users/:id` | Só admin: `{ quotaBytes?, status?, approved? }`. `quotaBytes` é um inteiro de bytes entre 0 e 2^50; `status` é `active` ou `suspended` (suspender termina as sessões da conta); `approved` só aceita `true` e aprova uma conta que aguarda aprovação (não se desfaz; 400 `invalid_approved`). Numa conta de admin só a quota muda (403 `admin_protected`); uma conta em remoção não se altera (409 `account_deleting`) |
| `DELETE /api/admin/users/:id` | Só admin: marca a conta para remoção (`deleting`) e termina as sessões; a remoção é do cron. Uma conta que aguarda aprovação (rejeitar o pedido) apaga-se de imediato e liberta o email. Responde 204, também se a conta já estava em remoção; uma conta de admin não se apaga (403 `admin_protected`) |

Um link só funciona se não foi revogado nem expirou, o ficheiro está fora da lixeira e a conta do dono está ativa; nos outros casos a resposta é sempre `404 share_not_found`, sem dizer porquê.

As rotas `/api/admin/*` exigem também `role = admin` (senão 403 `forbidden`) e só gerem contas e quotas: **não há nenhuma rota para ver ou descarregar os ficheiros de outros utilizadores**, e o admin não consegue repor a senha de ninguém.

O registo tem três modos, escolhidos pela variável `REGISTRATION_OPEN` (ver «Configuração»): aberto (a conta entra logo), **por aprovação** (`POST /api/auth/register` cria a conta por aprovar e responde `202 { pending: true, message }`, sem sessão; o login dela dá `403 account_pending` com a senha certa, até um administrador a aprovar) e fechado (`403 registration_closed`). Em todos, quem já tem conta continua a entrar. `GET /api/auth/me` de um administrador traz `pendingApprovals`, o número de contas por aprovar. `GET /api/health` responde `200 { "ok": true }` ou, com a D1 em baixo, `503 { "ok": false }`.

## Interface
```

Em `README.md`, trocar:

```markdown

**Sair** com envios em curso pede confirmação (sair cancela-os). Quando vários envios terminam, as listagens e a quota atualizam-se uma vez por meio segundo, e não uma vez por ficheiro.

**Administração** (`/admin`, só para o master; a quem não é admin o endereço leva a «Meu espaço» e a ligação «Admin» nem aparece na barra lateral): a tabela das contas, com o email, o espaço usado e a quota, o estado (Ativa, Suspensa ou A remover) e a data de criação. O menu «⋮» de cada conta tem:

- «Alterar quota…», em GB (aceita vírgula ou ponto; de 0 a 1 048 576 GB). Baixar a quota abaixo do que a conta já usa não apaga nada: só impede novos envios.
- «Suspender…» (pede confirmação): termina as sessões da conta e impede-a de entrar até ser reativada; os ficheiros ficam como estão e os links de partilha deixam de funcionar enquanto a conta estiver suspensa. «Reativar» não pede confirmação; a conta tem de entrar de novo.
```

por:

```markdown

**Sair** com envios em curso pede confirmação (sair cancela-os). Quando vários envios terminam, as listagens e a quota atualizam-se uma vez por meio segundo, e não uma vez por ficheiro.

**Administração** (`/admin`, só para o master; a quem não é admin o endereço leva a «Meu espaço» e a ligação «Admin» nem aparece na barra lateral): a tabela das contas, com o email, o espaço usado e a quota, o estado (Ativa, Suspensa, A remover ou **Aguarda aprovação**) e a data de criação. No registo por aprovação, as contas que aguardam aprovação vêm primeiro, com os botões «Aprovar» (a conta passa a entrar) e «Rejeitar…» (pede confirmação e apaga o pedido), e a ligação «Admin» da barra lateral mostra quantas são. O menu «⋮» de cada uma das outras contas tem:

- «Alterar quota…», em GB (aceita vírgula ou ponto; de 0 a 1 048 576 GB). Baixar a quota abaixo do que a conta já usa não apaga nada: só impede novos envios.
- «Suspender…» (pede confirmação): termina as sessões da conta e impede-a de entrar até ser reativada; os ficheiros ficam como estão e os links de partilha deixam de funcionar enquanto a conta estiver suspensa. «Reativar» não pede confirmação; a conta tem de entrar de novo.
```

Em `README.md`, trocar:

```markdown
| `MAX_UPLOAD_BYTES` | `104857600` (100 MiB) | Tamanho máximo de um ficheiro |
| `TRASH_RETENTION_DAYS` | `30` | Dias na lixeira antes de o cron eliminar o ficheiro |
| `SESSION_TTL_DAYS` | `14` | Validade de uma sessão |
| `REGISTRATION_OPEN` | `true` | Só `true` mantém o registo aberto; qualquer outro valor (por exemplo `false`) fecha-o |

**Cabeçalhos e registos.** As páginas da aplicação levam `Content-Security-Policy` (em `public/_headers`: scripts, estilos, ligações e `<iframe>` só da própria origem, sem `unsafe-inline`), `X-Frame-Options` e `Referrer-Policy`; a API leva `Cache-Control: no-store`; as respostas de ficheiros levam a sua própria CSP (`default-src 'none'; sandbox`), exceto a pré-visualização de PDF, que não a pode ter (o leitor do browser deixa de funcionar). O `observability` está ligado **sem os registos de invocação**: o token de um link de partilha vai no caminho do URL e não deve ficar nos registos; o relatório do cron e os erros (`console.log` e `console.error`) continuam a ir para lá.
```

por:

```markdown
| `MAX_UPLOAD_BYTES` | `104857600` (100 MiB) | Tamanho máximo de um ficheiro |
| `TRASH_RETENTION_DAYS` | `30` | Dias na lixeira antes de o cron eliminar o ficheiro |
| `SESSION_TTL_DAYS` | `14` | Validade de uma sessão |
| `REGISTRATION_OPEN` | `true` (em `wrangler.jsonc`: `approval`) | `true`, ou sem a variável: registo aberto. `approval`: registo aberto, mas as contas novas ficam por aprovar até um administrador as aprovar no painel. Qualquer outro valor (por exemplo `false`) fecha o registo |

**Cabeçalhos e registos.** As páginas da aplicação levam `Content-Security-Policy` (em `public/_headers`: scripts, estilos, ligações e `<iframe>` só da própria origem, sem `unsafe-inline`), `X-Frame-Options` e `Referrer-Policy`; a API leva `Cache-Control: no-store`; as respostas de ficheiros levam a sua própria CSP (`default-src 'none'; sandbox`), exceto a pré-visualização de PDF, que não a pode ter (o leitor do browser deixa de funcionar). O `observability` está ligado **sem os registos de invocação**: o token de um link de partilha vai no caminho do URL e não deve ficar nos registos; o relatório do cron e os erros (`console.log` e `console.error`) continuam a ir para lá.
```

Em `docs/superpowers/plans/README.md`, trocar:

```markdown
| 4 | [Admin e manutenção](2026-10-05-04-admin-e-manutencao.md) | API e painel de utilizadores (quotas, suspender e reativar, apagar contas) e o cron de manutenção por hora (lixeira expirada, envios pendentes, contas em remoção, sessões, falhas de login e partilhas velhas) | Concluído |
| 5A | [Endurecimento e testes de ponta a ponta](2026-10-05-05a-endurecimento-e-testes-e2e.md) | Cabeçalhos de segurança (CSP), registos sem tokens, o cron com falha visível, `REGISTRATION_OPEN`, a passagem de acessibilidade dos diálogos e menus, e a suíte Playwright (fumo, envios, partilha, admin, teclado) contra a aplicação construída | Concluído |
| 5B | Deploy | Recursos na Cloudflare (D1, R2), `wrangler deploy`, o master em produção, as medições na Cloudflare (CPU do PBKDF2 e do cron, subpedidos, limite do corpo, a execução falhada do cron no painel) | Por escrever |
| 6 | [Registo por aprovação](2026-10-11-06-registo-por-aprovacao.md) | `REGISTRATION_OPEN=approval`: as contas novas ficam por aprovar até um administrador as ativar (API, ecrã de registo e de login, painel com «Aprovar» e «Rejeitar…», contador na barra lateral) e a produção passa a usar esse modo | Escrito, por executar |

## Factos verificados que os planos seguintes devem respeitar
```

por:

```markdown
| 4 | [Admin e manutenção](2026-10-05-04-admin-e-manutencao.md) | API e painel de utilizadores (quotas, suspender e reativar, apagar contas) e o cron de manutenção por hora (lixeira expirada, envios pendentes, contas em remoção, sessões, falhas de login e partilhas velhas) | Concluído |
| 5A | [Endurecimento e testes de ponta a ponta](2026-10-05-05a-endurecimento-e-testes-e2e.md) | Cabeçalhos de segurança (CSP), registos sem tokens, o cron com falha visível, `REGISTRATION_OPEN`, a passagem de acessibilidade dos diálogos e menus, e a suíte Playwright (fumo, envios, partilha, admin, teclado) contra a aplicação construída | Concluído |
| 5B | Deploy | Recursos na Cloudflare (D1, R2), `wrangler deploy`, o master em produção, as medições na Cloudflare (CPU do PBKDF2 e do cron, subpedidos, limite do corpo, a execução falhada do cron no painel) | Por escrever |
| 6 | [Registo por aprovação](2026-10-11-06-registo-por-aprovacao.md) | `REGISTRATION_OPEN=approval`: as contas novas ficam por aprovar até um administrador as ativar (API, ecrã de registo e de login, painel com «Aprovar» e «Rejeitar…», contador na barra lateral) e a produção passa a usar esse modo | Concluído |

## Factos verificados que os planos seguintes devem respeitar
```

- [ ] **Step 5: Verificação manual**

Os testes cobrem a lógica; falta ver o percurso inteiro num browser real, numa base local limpa, com contas **fictícias** (`*@example.test`) e uma senha inventada:

1. Apagar `.wrangler` da pasta de teste e aplicar as migrações (`npm run db:migrate:local`). O `wrangler.jsonc` já tem `approval`, por isso `npm run dev` arranca com o registo por aprovação.
2. `npm run dev`; criar o master com `npm run seed:master -- --local` (`MASTER_EMAIL` e `MASTER_PASSWORD` inventados, no ambiente).
3. Noutra janela anónima, registar `ana@example.test`: aparece «Conta criada. Aguarde a aprovação do administrador.» e **não** se entra. Tentar entrar com ela: «A sua conta aguarda a aprovação do administrador.»
4. Entrar como master: a ligação «Admin» mostra 1; no painel, `ana@example.test` está primeiro, com «Aguarda aprovação», «Aprovar» e «Rejeitar…». «Aprovar»: a linha passa a «Ativa», o selo desaparece, e a Ana já entra.
5. Registar `bob@example.test` e «Rejeitar…»: pede confirmação e a conta desaparece; registar o mesmo email outra vez funciona logo.
6. Apagar o `.wrangler` e os cookies no fim.

- [ ] **Step 6: Verificação final e commit**

Run: `npx vitest run`
Expected: `Test Files  37 passed (37)`, `Tests  345 passed (345)`.

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  39 passed (39)`, `Tests  301 passed (301)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npm run build`
Expected: `✓ built in ...` duas vezes (Worker e cliente); o `dist/spacework/wrangler.json` leva `REGISTRATION_OPEN: "approval"`.

Run: `npx playwright test`
Expected: `22 passed` (a duração varia).

Commit:

```bash
git add wrangler.jsonc worker-configuration.d.ts vitest.config.ts vite.config.ts playwright.config.ts README.md docs
git commit -m "Põe a produção em registo por aprovação e documenta o registo por aprovação" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Auto-revisão do plano contra a especificação

| Requisito | Onde |
|---|---|
| Spec §2: `REGISTRATION_OPEN` com três valores (`true`, `approval`, outro = fechado) | Task 1 |
| Spec §3: `users.approved` (0 ou 1, por defeito 1) | Task 1 |
| Spec §4: o registo por aprovação (202, sem sessão), o login `account_pending` só com a senha certa, a sessão que exige `approved = 1` | Task 1 |
| Spec §6: `GET /api/auth/me` com `pendingApprovals` (só para um administrador) | Task 1 |
| Spec §6: a lista com as contas por aprovar primeiro, `approved` no `PATCH`, rejeitar apaga logo | Task 2 |
| Spec §8: o ecrã do registo («Conta criada») e a mensagem no login | Task 3 |
| Spec §8: «Admin» com o número de contas por aprovar | Task 3 |
| Spec §8: a tabela com «Aguarda aprovação», «Aprovar» e «Rejeitar…» | Task 4 |
| Spec §2 e §11: a produção em `approval` e a ordem migração antes do push | Task 5 e Global Constraints |

**Fora deste plano:** a expiração dos pedidos que ninguém decide (apagá-los pelo cron ao fim de N dias), um teto para o número de pedidos pendentes (um robô podia enchê-los: cada pedido gasta um PBKDF2 e uma linha), o aviso por email ao administrador e uma opção no painel para trocar o modo do registo sem mexer em `wrangler.jsonc`. Ficam como possíveis melhorias; nenhuma é preciso para a v1.

**Totais de testes (medidos na execução deste plano numa pasta limpa):** Worker: Test Files 37 passed (37); Tests 345 passed (345). Interface: Test Files 39 passed (39); Tests 301 passed (301). Ponta a ponta: 22 testes do Playwright.

## Notas da execução

- **Decisões que a especificação deixa em aberto:** uma **coluna** (`approved`) e não um estado novo, pela razão da secção «Architecture»; o registo por aprovação responde **202** (a conta foi criada, mas ainda não há recurso para devolver) e não 201; o login só revela «por aprovar» com a senha certa, para não dizer a quem não tem a senha que o email existe; **rejeitar** apaga a conta logo (sem `deleting` nem cron), com os dois `DELETE`/`UPDATE` na mesma `batch` filtrados por `approved`, para que uma conta aprovada entre a leitura e a escrita siga o caminho normal em vez de desaparecer (há um teste da corrida); aprovar **não se desfaz**.
- **A produção em `approval` sem partir as suítes:** `wrangler.jsonc` passa a ter `"REGISTRATION_OPEN": "approval"`, e as duas suítes que precisam do registo aberto põem-no na sua configuração: o Vitest do Worker com `miniflare.bindings`, e os testes de ponta a ponta com o `config` do plugin da Cloudflare em `vite.config.ts`, ativo só quando `E2E_STATE` existe (por isso a construção dos testes de ponta a ponta passa a levar `E2E_STATE`; a construção de produção não). Fazer o contrário, deixar `true` no repositório e escolher `approval` no comando de deploy, deixava um `npm run deploy` à mão abrir o registo em silêncio.
- **O que fica por fazer, e é do utilizador:** aplicar a migração à D1 de produção (`npm run db:migrate:remote`) **antes** do push; depois do push, ver no painel de produção que o registo cria uma conta «Aguarda aprovação» e que «Aprovar» a deixa entrar. O ecrã de registo em produção também mostra a mensagem do servidor.
- **Verificação manual:** feita durante a escrita deste plano, com contas fictícias numa base local limpa (ver a Task 5).
