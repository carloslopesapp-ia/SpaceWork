# SpaceWork — Plano 5A: endurecimento e testes de ponta a ponta (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar a aplicação pronta para o deploy: fechar os pendentes de endurecimento que os planos anteriores anotaram (o hash fictício do login, o `/api/health`, a CSP, os registos sem tokens, o cron que falha à vista, o registo que se pode fechar), fazer a passagem de acessibilidade dos diálogos e dos menus, e acrescentar a suíte de testes de ponta a ponta (Playwright) que confirma num browser real o que os testes do Worker e os da interface não veem. **Nada se publica neste plano**: o deploy, que toca na conta da Cloudflare, é o Plano 5B.

**Architecture:** Três blocos. (1) Pequenas mudanças ao Worker (`config.ts`, `routes/auth.ts`, `lib/crypto.ts`, `app.ts`, `index.ts`, `cron.ts`) e à configuração (`public/_headers`, `wrangler.jsonc`), cada uma com o seu teste primeiro. (2) A passagem de acessibilidade em `Modal`, `ConfirmDialog`, `NameDialog`, `RowMenu`, `Button` e um componente novo, `Loading`, com testes de componentes em jsdom. (3) O Playwright corre contra a aplicação **construída** (`vite build` e `vite preview`: o Worker no workerd, com os assets estáticos, o `_headers` e o `run_worker_first` como em produção), com a D1 e o R2 simulados em `.e2e-state` (nunca a `.wrangler` de desenvolvimento); a variável `E2E_STATE` liga o `persistState` do plugin da Cloudflare. A suíte tem oito ficheiros de testes de ponta a ponta, que partilham um servidor e usam contas só suas.

**Tech Stack:** o dos planos anteriores e uma dependência de desenvolvimento nova, `@playwright/test` (Chromium).

**Spec:** [docs/superpowers/specs/2026-10-03-spacework-design.md](../specs/2026-10-03-spacework-design.md) (secção 4, registo e login; secção 10, testes; secção 11, deploy; secção 13, o que falta confirmar em produção). Índice dos planos: [README.md](README.md). Este plano trata do que o bloco «Plano 5» do índice listava como pendente e que se faz sem a Cloudflare.

## Global Constraints

Valores da especificação e dos planos anteriores; todas as tarefas os cumprem implicitamente.

- Interface em português europeu; as mensagens de erro da API já vêm em português e a interface mostra o `message` tal como vem.
- O registo continua **aberto por defeito**. `REGISTRATION_OPEN` só o mantém aberto com o valor `true` (sem a variável também está aberto); qualquer outro valor fecha-o: `403 registration_closed`, antes de gastar o PBKDF2 da senha. O login de quem já tem conta não muda.
- A CSP das páginas (`public/_headers`) só deixa carregar (as imagens também, sem `data:`) e contactar a própria origem e **não usa `unsafe-inline` nem `unsafe-eval`**. A API não leva CSP; as respostas de ficheiros levam a sua (a imagem, `default-src 'none'; sandbox`; o PDF não pode ter, o leitor do browser não funciona com ela).
- O `observability` está ligado **sem os registos de invocação** (`logs.invocation_logs: false`): o token de um link de partilha vai no caminho do URL e não pode ficar nos registos. O relatório do cron e os erros (`console.log`, `console.error`) continuam a ir para lá.
- O cron: o `scheduled` **devolve** a promessa da manutenção (se um passo falhou, rejeita, para a execução aparecer como falhada no painel da Cloudflare: a confirmar em produção, no 5B); o relatório escreve-se numa linha JSON (`evento: "manutencao"`); os limites do Plano 4 (50 subpedidos, 32 no pior caso) não mudam.
- Os testes de ponta a ponta correm a aplicação construída na porta **4180**, com a D1 e o R2 em `.e2e-state`; **nunca tocam na `.wrangler` de desenvolvimento**. Partilham um só servidor e correm um de cada vez, por isso cada teste usa contas e nomes que mais ninguém usa (`uniqueEmail`). As contas são fictícias (`*@example.test`) e a senha, inventada e fixa, só existe nos testes.
- Os testes de ponta a ponta escrevem-se **depois** do código que testam: uma falha é um defeito encontrado. Só o teste do telemóvel (Task 8) começa «vermelho», porque a correção vem no mesmo passo.
- Os testes do Worker (`npx vitest run`), os da interface (`npx vitest run -c vitest.web.config.ts`) e os de ponta a ponta (`npm run test:e2e`) mostram só o resumo: qualquer outra saída (avisos de `act`, `console.error`, o registo do cron) é um defeito do teste a corrigir. Nenhum teste espera por temporizadores falsos.
- Este plano não instala nada fora do projeto, exceto o Chromium do Playwright (`npx playwright install chromium`, cerca de 100 MB, na cache do utilizador), e **não toca na conta da Cloudflare, no GitHub nem em credenciais**.
- IDs `crypto.randomUUID()`; datas em milissegundos Unix. Vitest `^4.1`.
- **Nenhum `git push` sem confirmação explícita do utilizador.**

## Ambiente

- Node 24 e npm 11; todos os comandos correm na raiz do repositório (`~/Developer/SpaceWork`, fora do iCloud). Ramo de trabalho: `plano-5-deploy-e2e`.
- Commits: mensagem curta em português; cada commit termina com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (nos comandos abaixo, é o segundo `-m`). Escrever **exatamente** esse trailer, "Claude Sonnet 5.5", mesmo que o modelo que executa seja outro.
- As Tasks 1 e 2 tocam no Worker (`npx vitest run`); as Tasks 3, 4 e 5 na interface e na configuração (`npx vitest run -c vitest.web.config.ts`); as Tasks 6, 7 e 8 são os testes de ponta a ponta (`npx playwright test`); a Task 9 é documentação e a verificação final.
- A Task 6 acrescenta a dependência `@playwright/test` (`npm install -D`) e descarrega o Chromium: precisam de rede.
- A verificação manual (Task 9) usa uma conta **fictícia** numa base local limpa. Nunca se usam as credenciais do utilizador master, nem se escrevem em ficheiros.

## Estrutura de ficheiros deste plano

```
wrangler.jsonc                              + REGISTRATION_OPEN, observability (sem registos de invocação)
worker-configuration.d.ts                   (gerado) + REGISTRATION_OPEN
public/_headers                             + Content-Security-Policy
vite.config.ts                              persistState lido de E2E_STATE (só nos testes de ponta a ponta)
package.json, package-lock.json             + @playwright/test, o script test:e2e
playwright.config.ts                        o Playwright: aplicação construída na 4180, estado em .e2e-state
tsconfig.e2e.json, tsconfig.json            o projeto de tipos dos testes de ponta a ponta
scripts/seed-hints.ts                       migrateCommand(target)
src/worker/config.ts                        + registrationOpen
src/worker/routes/auth.ts                   registo que se pode fechar; DUMMY_PASSWORD_HASH
src/worker/lib/crypto.ts                    + DUMMY_PASSWORD_HASH
src/worker/app.ts                           /api/health com 503
src/worker/index.ts                         scheduled devolve a promessa
src/worker/cron.ts                          relatório no registo; purgeInBlocks conta bloco a bloco
src/web/components/Modal.tsx                describedBy, rolagem bloqueada, foco de reserva no <main>
src/web/components/ConfirmDialog.tsx        a pergunta é a descrição
src/web/components/NameDialog.tsx           o erro de validação desaparece ao escrever
src/web/components/RowMenu.tsx              seta para baixo, Home e End; sem ações não desenha nada
src/web/components/Button.tsx               o anel de foco segue a cor da variante
src/web/components/Loading.tsx              «A carregar…» como região de estado
src/web/components/AppLayout.tsx            <main> focável por programa
src/web/components/Breadcrumb.tsx           parte nomes enormes
src/web/pages/FolderPage.tsx                ignora o que se larga sobre um diálogo; título que encolhe
src/web/pages/AdminPage.tsx                 o contentor da tabela é relative
e2e/                                        env.ts, support.ts e os testes: smoke, uploads, preview, share, csp, admin, keyboard, layout
test/                                       config, auth-register, crypto, health, seed-hints, cron
src/web/                                    + os testes dos componentes e das páginas acima, shell.test.ts
```

---


### Task 1: Endurecer o Worker: registo que se pode fechar, hash fictício fixo, `/api/health` que não rebenta e a dica do seed

**Files:**
- Create: `scripts/seed-hints.ts`, `test/seed-hints.test.ts`
- Modify: `wrangler.jsonc`, `worker-configuration.d.ts` (gerado), `src/worker/config.ts`, `src/worker/routes/auth.ts`, `src/worker/lib/crypto.ts`, `src/worker/app.ts`, `scripts/seed-master.ts`
- Modify: `test/config.test.ts`, `test/auth-register.test.ts`, `test/crypto.test.ts`, `test/health.test.ts`

**Interfaces:**
- Consumes: `getConfig`, `ApiError`, `hashPassword`/`verifyPassword`/`PBKDF2_ITERATIONS`, `dbFailingOn`, `fetchWithEnv`, `silenceErrors` (`test/db-helpers.ts`), `buildRequest`.
- Produces: a variável `REGISTRATION_OPEN` (`wrangler.jsonc`) e `AppConfig.registrationOpen`; a resposta `403 registration_closed` em `POST /api/auth/register`; `DUMMY_PASSWORD_HASH` em `src/worker/lib/crypto.ts` (o login de um email que não existe verifica contra ele); `GET /api/health` com `503 { ok: false }`; `migrateCommand(target)` em `scripts/seed-hints.ts`.

- [ ] **Step 1: O registo pode fechar-se (testes primeiro)**

A especificação deixa ao dono a decisão sobre o registo aberto: o registo continua aberto por defeito, mas passa a haver uma variável, `REGISTRATION_OPEN`, para o fechar quando as contas estiverem criadas (a alternativa, uma regra de limite de pedidos da Cloudflare em `/api/auth/*`, fica para o Plano 5B). Sem a variável o registo está aberto; com ela, **só `true` o mantém aberto** (um erro de escrita, como `flase`, fecha-o em vez de o deixar aberto sem ninguém dar por isso). Fechado, `POST /api/auth/register` responde `403 registration_closed` **antes** de gastar o PBKDF2 da senha, e o login de quem já tem conta não muda.

Em `test/config.test.ts`, no teste «converte valores válidos para números», trocar:

```ts
      sessionTtlDays: 1,
    });
```

por:

```ts
      sessionTtlDays: 1,
      registrationOpen: false,
    });
```

No mesmo teste, acrescentar a variável. Trocar:

```ts
      SESSION_TTL_DAYS: "1",
    } as unknown as Env;
```

por:

```ts
      SESSION_TTL_DAYS: "1",
      REGISTRATION_OPEN: "false",
    } as unknown as Env;
```

Nos outros três testes (os valores de `wrangler.jsonc`, os valores por defeito e os malformados), acrescentar `registrationOpen: true` ao objeto esperado. Trocar todas as ocorrências `      sessionTtlDays: 14,
    });` por `      sessionTtlDays: 14,
      registrationOpen: true,
    });`.

No fim de `test/config.test.ts`, acrescentar:

```ts
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

Em `test/auth-register.test.ts`, nos `import`, trocar:

```ts
import { registerUser, setUserStatus, type UserBody } from "./auth-helpers";
import { api, resetDb } from "./helpers";
```

por:

```ts
import { registerUser, setUserStatus, type UserBody } from "./auth-helpers";
import { fetchWithEnv } from "./db-helpers";
import { api, buildRequest, resetDb } from "./helpers";
```

No fim de `test/auth-register.test.ts`, acrescentar:

```ts
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
```

Run: `npx vitest run test/config.test.ts test/auth-register.test.ts`
Expected: FAIL (Test Files  2 failed (2); Tests  7 failed | 10 passed (17)).

Em `wrangler.jsonc`, nas `vars`, trocar:

```
    "SESSION_TTL_DAYS": "14"
```

por:

```
    "SESSION_TTL_DAYS": "14",
    "REGISTRATION_OPEN": "true"
```

Run: `npm run cf-typegen`
Expected: o `wrangler types` regenera `worker-configuration.d.ts` com `REGISTRATION_OPEN: "true"` (a variável passa a existir no tipo `Env`).

Em `src/worker/config.ts`, na interface, trocar:

```ts
  sessionTtlDays: number;
}
```

por:

```ts
  sessionTtlDays: number;
  /** Se `false`, `POST /api/auth/register` responde 403 (o dono fecha o registo depois de criar as contas). */
  registrationOpen: boolean;
}
```

Na função, trocar:

```ts
    sessionTtlDays: toPositiveInt(env.SESSION_TTL_DAYS, 14),
  };
```

por:

```ts
    sessionTtlDays: toPositiveInt(env.SESSION_TTL_DAYS, 14),
    // Sem a variável o registo está aberto (decisão do dono); com ela, só `true` o mantém aberto: um erro de escrita fecha-o.
    registrationOpen: env.REGISTRATION_OPEN === undefined || env.REGISTRATION_OPEN === "true",
  };
```

Em `src/worker/routes/auth.ts`, no início de `POST /register`, trocar:

```ts
auth.post("/register", async (c) => {
  const body = await readJsonObject(c);
```

por:

```ts
auth.post("/register", async (c) => {
  const config = getConfig(c.env);
  if (!config.registrationOpen) {
    throw new ApiError(403, "registration_closed", "O registo está fechado. Peça uma conta ao administrador.");
  }
  const body = await readJsonObject(c);
```

Mais abaixo, a configuração já foi lida no início: trocar:

```ts
  const config = getConfig(c.env);
  const id = crypto.randomUUID();
```

por:

```ts
  const id = crypto.randomUUID();
```

Run: `npx vitest run test/config.test.ts test/auth-register.test.ts`
Expected: `Test Files  2 passed (2)`, `Tests  17 passed (17)`.

- [ ] **Step 2: O hash fictício do login é uma constante (testes primeiro)**

Um email que não existe gasta o mesmo tempo de CPU que um que existe porque o login verifica a senha contra um hash qualquer. Esse hash era calculado na primeira vez que fazia falta, ou seja, **o primeiro login falhado depois de cada arranque do Worker pagava dois PBKDF2** (o do hash e o da verificação), e no plano gratuito (10 ms de CPU) isso pode estourar. Passa a ser uma constante pré-calculada, de uma senha aleatória que foi deitada fora: a verificação custa o mesmo que a de uma conta verdadeira (as iterações são as de `PBKDF2_ITERATIONS`) e não há nada para calcular ao arrancar. O teste confere também o **tamanho** do salt (16 bytes) e do hash (32 bytes): uma constante malformada faria o `verifyPassword` devolver `false` à entrada, sem gastar o PBKDF2, e o login de um email que não existe voltava a ser mais rápido que o de um que existe.

Em `test/crypto.test.ts`, nos `import`, trocar:

```ts
import {
  hashPassword,
  PBKDF2_ITERATIONS,
```

por:

```ts
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  PBKDF2_ITERATIONS,
```

No fim de `test/crypto.test.ts`, acrescentar:

```ts
describe("DUMMY_PASSWORD_HASH", () => {
  it("tem o formato e as iterações de um hash verdadeiro, para a verificação gastar o mesmo CPU", () => {
    const parts = DUMMY_PASSWORD_HASH.split("$");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("pbkdf2-sha256");
    // Se as iterações mudarem, a constante tem de ser gerada outra vez (ver o comentário em crypto.ts).
    expect(parts[1]).toBe(String(PBKDF2_ITERATIONS));
    // O `verifyPassword` devolve false logo à entrada se o salt ou o hash estiverem malformados, e isso saltaria em silêncio o PBKDF2
    // para os emails que não existem: o salt e o hash fictícios têm de ter o mesmo tamanho dos verdadeiros.
    expect(atob(parts[2])).toHaveLength(16);
    expect(atob(parts[3])).toHaveLength(32);
  });

  it("não corresponde a nenhuma senha que um utilizador possa escolher", async () => {
    for (const password of ["", "spacework-dummy-password", "senha-segura-123"]) {
      expect(await verifyPassword(password, DUMMY_PASSWORD_HASH), password).toBe(false);
    }
  });
});
```

Run: `npx vitest run test/crypto.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  2 failed | 8 passed (10)).

Em `src/worker/lib/crypto.ts`, a seguir a `PBKDF2_ITERATIONS`, trocar:

```ts
export const PBKDF2_ITERATIONS = 100_000;
```

por:

```ts
export const PBKDF2_ITERATIONS = 100_000;

/**
 * Hash de uma senha aleatória que ninguém guardou: o login de um email que não existe verifica a senha contra ele, para demorar o mesmo
 * que o de uma conta verdadeira. É uma constante e não se calcula ao arrancar (o primeiro login falhado de cada arranque pagava dois PBKDF2).
 * Se `PBKDF2_ITERATIONS` mudar, gerar outra: `node --input-type=module -e "import { hashPassword } from './src/worker/lib/crypto.ts'; console.log(await hashPassword(crypto.randomUUID()))"`.
 */
export const DUMMY_PASSWORD_HASH = "pbkdf2-sha256$100000$YqDRIeztG1fRfciEoiKX4w==$W5k+I9f7cNX1XwE1S680ChLPrMCT1HEX8HV5aP+Ru/Y=";
```

Em `src/worker/routes/auth.ts`, nos `import`, trocar:

```ts
import { hashPassword, sha256Hex, verifyPassword } from "../lib/crypto";
```

por:

```ts
import { DUMMY_PASSWORD_HASH, hashPassword, sha256Hex, verifyPassword } from "../lib/crypto";
```

Apagar a função que calculava o hash fictício (`getDummyHash`)::

```ts
// Hash de uma senha qualquer, para que um email inexistente demore o mesmo a responder que um existente.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("spacework-dummy-password");
  return dummyHash;
}
```

por:

```ts

```

No login, trocar:

```ts
    usable ? row.password_hash : await getDummyHash(),
```

por:

```ts
    usable ? row.password_hash : DUMMY_PASSWORD_HASH,
```

Run: `npx vitest run test/crypto.test.ts test/auth-login.test.ts`
Expected: `Test Files  2 passed (2)`, `Tests  23 passed (23)`.

- [ ] **Step 3: `GET /api/health` não rebenta com a D1 em baixo (testes primeiro)**

Hoje, se a D1 falhar, o `/api/health` cai no `onError` e responde `500 internal_error`: um monitor não distingue «o Worker está vivo mas a base não responde» de um erro de código. Passa a responder `503 { ok: false }` e a registar o erro.

Substituir o conteúdo de `test/health.test.ts`:

```ts
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { dbFailingOn, fetchWithEnv, silenceErrors } from "./db-helpers";
import { buildRequest } from "./helpers";

describe("GET /api/health", () => {
  it("responde ok quando a base de dados está acessível", async () => {
    const res = await exports.default.fetch("http://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("responde 503 `{ ok: false }` e regista o erro quando a base de dados falha", async () => {
    const errors = silenceErrors();
    const res = await fetchWithEnv(buildRequest("/api/health"), { DB: dbFailingOn(/SELECT 1/) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
    expect(errors).toHaveBeenCalledOnce();
  });
});
```

Run: `npx vitest run test/health.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  1 failed | 1 passed (2)).

Em `src/worker/app.ts`, trocar:

```ts
app.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return c.json({ ok: row?.ok === 1 });
});
```

por:

```ts
/** Para os monitores: 200 `{ ok: true }` com a D1 a responder, 503 `{ ok: false }` (e o erro no registo) quando não. */
app.get("/api/health", async (c) => {
  try {
    const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    if (row?.ok === 1) return c.json({ ok: true });
  } catch (error) {
    console.error("A verificação de saúde falhou", error);
  }
  return c.json({ ok: false }, 503);
});
```

Run: `npx vitest run test/health.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  2 passed (2)`.

- [ ] **Step 4: A dica do seed segue o destino (testes primeiro)**

Se a base ainda não tem tabelas, o `seed:master` manda aplicar as migrações, mas a dica dizia sempre `db:migrate:local`, mesmo com `--remote`. A escolha do comando passa para uma função pequena, que se testa (o resto do script corre `wrangler` e não se importa).

Criar `test/seed-hints.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { migrateCommand } from "../scripts/seed-hints";

describe("migrateCommand (a dica do seed do master)", () => {
  it("manda aplicar as migrações no destino certo", () => {
    expect(migrateCommand("--local")).toBe("npm run db:migrate:local");
    expect(migrateCommand("--remote")).toBe("npm run db:migrate:remote");
  });
});
```

Run: `npx vitest run test/seed-hints.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `scripts/seed-hints.ts`:

```ts
/** O comando que aplica as migrações no destino do seed: o aviso do script manda o utilizador para o certo (`--remote` não é `--local`). */
export function migrateCommand(target: "--local" | "--remote"): string {
  return target === "--remote" ? "npm run db:migrate:remote" : "npm run db:migrate:local";
}
```

Em `scripts/seed-master.ts`, nos `import`, trocar:

```ts
import { hashPassword } from "../src/worker/lib/crypto.ts";
```

por:

```ts
import { hashPassword } from "../src/worker/lib/crypto.ts";
import { migrateCommand } from "./seed-hints.ts";
```

Em `d1Execute`, o destino passa a ser o tipo exato. Trocar:

```ts
function d1Execute(target: string, sql: string)
```

por:

```ts
function d1Execute(target: "--local" | "--remote", sql: string)
```

Na mensagem de erro, trocar:

```ts
        "Se a base for nova, aplique primeiro as migrações (npm run db:migrate:local).",
```

por:

```ts
        `Se a base for nova, aplique primeiro as migrações (${migrateCommand(target)}).`,
```

Run: `npx vitest run test/seed-hints.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  1 passed (1)`.

- [ ] **Step 5: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  37 passed (37)`, `Tests  324 passed (324)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src test scripts wrangler.jsonc worker-configuration.d.ts
git commit -m "Endurece o Worker: registo que se pode fechar, hash fictício fixo e health com 503" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: O cron falha à vista e conta bem: o gatilho devolve a promessa, o relatório vai para o registo e os blocos contam um a um

**Files:**
- Modify: `src/worker/index.ts`, `src/worker/cron.ts`, `test/cron.test.ts`

**Interfaces:**
- Consumes: `runMaintenance`, `scheduledMaintenance`, `PURGE_BATCH`, `seedFiles`, `dbFailingOn`, `dbWithBatchHook`, `silenceErrors`, `createScheduledController` (`cloudflare:test`).
- Produces: `scheduled` do Worker que **devolve** a promessa da manutenção (rejeita se um passo falhou); `scheduledMaintenance` que regista o relatório numa linha JSON (`{ "evento": "manutencao", ... }`); `purgeInBlocks` que conta bloco a bloco.

- [ ] **Step 1: O gatilho devolve a promessa (testes primeiro)**

O Plano 4 entregava a manutenção ao `ctx.waitUntil`: se um passo falhasse, `scheduledMaintenance` lançava, mas não se sabe se a Cloudflare marca como falhada uma execução em que só o `waitUntil` rejeitou. Devolver a promessa do próprio `scheduled` não deixa dúvidas: a execução acaba com exceção, que o painel da Cloudflare mostra (e que um alerta pode apanhar). Os testes passam a **esperar** pelo `scheduled` em vez de esperar pelo contexto de execução.

Em `test/cron.test.ts`, nos `import`, trocar:

```ts
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
```

por:

```ts
import { createScheduledController } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
```

Mais abaixo, trocar:

```ts
import { dbFailingOn, envCountingSubrequests, silenceErrors } from "./db-helpers";
```

por:

```ts
import { dbFailingOn, dbWithBatchHook, envCountingSubrequests, silenceErrors } from "./db-helpers";
```

Mais abaixo, trocar:

```ts
beforeEach(resetState);
afterEach(() => vi.restoreAllMocks());
```

por:

```ts
beforeEach(resetState);
afterEach(() => vi.restoreAllMocks());
// A manutenção regista o relatório com `console.log`: nos testes fica em silêncio (e inspeciona-se onde interessa, por `log`).
let log: MockInstance<typeof console.log>;
beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
});
```

No fim do ficheiro, no teste do gatilho, trocar:

```ts
    const ctx = createExecutionContext();

    worker.scheduled!(createScheduledController({ scheduledTime: NOW, cron: "0 * * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(await rowIds("files")).toEqual(["vivo"]);
    expect(await used(ana)).toBe(5);
  });
```

por:

```ts

    await worker.scheduled(createScheduledController({ scheduledTime: NOW, cron: "0 * * * *" }), env);

    expect(await rowIds("files")).toEqual(["vivo"]);
    expect(await used(ana)).toBe(5);
  });

  it("`scheduled` devolve a promessa da manutenção: se um passo falhou rejeita, e a execução fica marcada como falhada", async () => {
    silenceErrors();
    const broken = { ...env, DB: dbFailingOn(/FROM files WHERE deleted_at IS NOT NULL/) } as Env;

    await expect(worker.scheduled(createScheduledController({ scheduledTime: NOW, cron: "0 * * * *" }), broken)).rejects.toThrow(
      /Manutenção com erros: lixeira: D1 em baixo/,
    );
  });
```

Run: `npx vitest run test/cron.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  2 failed | 8 passed (10)). O `scheduled` ainda entrega a promessa ao `ctx.waitUntil`, e os testes já não lhe passam o contexto de execução.

Substituir o conteúdo de `src/worker/index.ts`:

```ts
import { app } from "./app";
import { scheduledMaintenance } from "./cron";

export default {
  fetch: app.fetch,
  // O cron por hora de `wrangler.jsonc`. Devolve a promessa da manutenção, em vez de a entregar ao `waitUntil`: se um passo falhou,
  // a promessa rejeita e a invocação acaba com exceção, que o painel da Cloudflare mostra (uma rejeição só dentro do `waitUntil`
  // pode não marcar a execução como falhada).
  async scheduled(controller, env) {
    await scheduledMaintenance(env, controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
```

Run: `npx vitest run test/cron.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  10 passed (10)`.

- [ ] **Step 2: O relatório vai para o registo e os blocos contam um a um (testes primeiro)**

Duas coisas que os revisores do Plano 4 deixaram anotadas. **O relatório nunca se via em produção:** `scheduledMaintenance` devolvia-o a quem não o lia. Passa a escrevê-lo numa linha JSON (`evento: "manutencao"`), com ou sem erros, e é isso que o `observability` (Task 3) guarda. **O relatório sub-contava numa falha a meio:** `purgeInBlocks` só devolvia a soma no fim, por isso, se o 4.º de 6 blocos falhava, os três primeiros já tinham eliminado ficheiros e o relatório dizia 0. Cada bloco passa a contar logo.

No fim de `test/cron.test.ts`, acrescentar:

```ts
describe("o relatório da manutenção", () => {
  it("o gatilho regista-o numa só linha JSON, com ou sem erros (é assim que se vê o que a manutenção fez)", async () => {
    silenceErrors();
    const ana = await insertUser("ana@example.com");
    await seedFiles(ana, [{ id: "velho", size: 10, deletedAt: 5 }]);

    await scheduledMaintenance(env, NOW);

    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({ evento: "manutencao", trashPurged: 1, errors: [] });

    log.mockClear();
    const broken = { ...env, DB: dbFailingOn(/FROM files WHERE deleted_at IS NOT NULL/) } as Env;
    await expect(scheduledMaintenance(broken, NOW)).rejects.toThrow(/Manutenção com erros/);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({ evento: "manutencao", errors: ["lixeira: D1 em baixo"] });
  });

  it("um bloco que falha a meio não apaga do relatório o que os blocos anteriores já eliminaram", async () => {
    silenceErrors();
    const ana = await insertUser("ana@example.com");
    await seedFiles(
      ana,
      Array.from({ length: 3 * PURGE_BATCH + 10 }, (_unused, index) => ({ id: `f${String(index).padStart(3, "0")}`, size: 1, deletedAt: 5 + index })),
    );
    // A 4.ª `batch` da execução (o 4.º bloco de 50) falha.
    const flaky = { ...env, DB: dbWithBatchHook((call, runReal) => (call === 4 ? Promise.reject(new Error("D1 em baixo")) : runReal())) } as Env;

    const report = await runMaintenance(flaky, NOW);

    expect(report.errors).toEqual(["lixeira: D1 em baixo"]);
    expect(report.trashPurged).toBe(3 * PURGE_BATCH); // os três primeiros blocos saíram e contam
    expect(await count("files")).toBe(10);
  });
});
```

Run: `npx vitest run test/cron.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  2 failed | 10 passed (12)).

Em `src/worker/cron.ts`, trocar:

```ts
/** Elimina `ids` por blocos de `PURGE_BATCH`, um bloco de cada vez (cada bloco são 2 subpedidos). */
async function purgeInBlocks(ids: string[], purge: (block: string[]) => Promise<number>): Promise<number> {
  let purged = 0;
  for (let start = 0; start < ids.length; start += PURGE_BATCH) {
    purged += await purge(ids.slice(start, start + PURGE_BATCH));
  }
  return purged;
}
```

por:

```ts
/**
 * Elimina `ids` por blocos de `PURGE_BATCH`, um bloco de cada vez (cada bloco são 2 subpedidos). Cada bloco conta logo em `onPurged`:
 * se um bloco falhar, o relatório continua a dizer o que os anteriores já eliminaram.
 */
async function purgeInBlocks(
  ids: string[],
  purge: (block: string[]) => Promise<number>,
  onPurged: (count: number) => void,
): Promise<void> {
  for (let start = 0; start < ids.length; start += PURGE_BATCH) {
    onPurged(await purge(ids.slice(start, start + PURGE_BATCH)));
  }
}
```

No passo da lixeira, trocar:

```ts
    report.trashPurged = await purgeInBlocks(ids, (block) => purgeExpiredTrash(env, block));
```

por:

```ts
    await purgeInBlocks(ids, (block) => purgeExpiredTrash(env, block), (count) => (report.trashPurged += count));
```

No passo dos envios pendentes, trocar:

```ts
    report.pendingPurged = await purgeInBlocks(ids, (block) => purgeStalePending(env, block));
```

por:

```ts
    await purgeInBlocks(ids, (block) => purgeStalePending(env, block), (count) => (report.pendingPurged += count));
```

No fim do ficheiro, trocar:

```ts
/** O que o gatilho do cron corre: a manutenção, e falha a execução (para aparecer no painel da Cloudflare) se algum passo falhou. */
export async function scheduledMaintenance(env: Env, now: number = Date.now()): Promise<MaintenanceReport> {
  const report = await runMaintenance(env, now);
  if (report.errors.length > 0)
```

por:

```ts
/**
 * O que o gatilho do cron corre: a manutenção, o relatório numa linha JSON no registo do Worker (é assim que se vê o que ela fez) e,
 * se algum passo falhou, uma exceção que faz falhar a execução (para aparecer no painel da Cloudflare).
 */
export async function scheduledMaintenance(env: Env, now: number = Date.now()): Promise<MaintenanceReport> {
  const report = await runMaintenance(env, now);
  console.log(JSON.stringify({ evento: "manutencao", ...report }));
  if (report.errors.length > 0)
```

Run: `npx vitest run test/cron.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  12 passed (12)`.

- [ ] **Step 3: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  37 passed (37)`, `Tests  327 passed (327)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src test
git commit -m "Faz o cron falhar à vista e conta bem: o gatilho devolve a promessa e o relatório vai para o registo" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cabeçalhos e registos: CSP na aplicação e `observability` sem os tokens dos links

**Files:**
- Modify: `public/_headers`, `wrangler.jsonc`, `src/web/shell.test.ts`

**Interfaces:**
- Consumes: o teste da casca (`src/web/shell.test.ts`), `public/_headers` (cabeçalhos dos assets estáticos, aplicados pelos Workers Static Assets).
- Produces: o cabeçalho `Content-Security-Policy` das páginas da aplicação (`/*` do `_headers`); `observability` ligado em `wrangler.jsonc` com `logs.invocation_logs: false`.

- [ ] **Step 1: A política de segurança de conteúdo (testes primeiro)**

As respostas da API já levam `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` e `Cache-Control: no-store`; as páginas da aplicação (os assets estáticos, servidos antes de o Worker correr) levam as três primeiras pelo `public/_headers`. Falta o `Content-Security-Policy`, a defesa principal contra um XSS: os scripts só podem vir da própria origem (nada inline, nada de `eval`), não há `<object>`, o `<base>` está proibido e a página não se deixa pôr numa `<iframe>` de outra origem. Os formulários e os pedidos (`fetch`, XHR) só vão para a própria origem, e as `<iframe>` só carregam a própria origem (a pré-visualização de um PDF). As imagens (a pré-visualização de uma imagem é um pedido à própria API) também só da própria origem, nem `data:`: nada na aplicação usa um URI `data:`, e um teste de ponta a ponta (Task 7) percorre a aplicação inteira sem violações. As folhas de estilo só vêm da própria origem. As barras de progresso mudam a largura pelo CSSOM (`element.style.width = …`, que é o que o React faz), e a CSP não bloqueia isso: nenhuma diretiva precisa de `'unsafe-inline'`. A API não leva CSP: as respostas de pré-visualização e de descarregamento já têm as suas (a de uma imagem é `default-src 'none'; sandbox`; a de um PDF não pode ter, o leitor do browser não funciona com ela). O teste lê o próprio `_headers`, confere cada diretiva e fixa o **conjunto** de diretivas (uma diretiva nova, ou mais larga, tem de ser uma decisão e não um acidente); a Task 7 confirma num browser real que a aplicação inteira corre sem uma única violação.

Em `src/web/shell.test.ts`, trocar:

```ts
  it("os cabeçalhos estáticos não deixam o endereço da página sair da origem (Referrer-Policy)", () => {
    expect(headers).toMatch(/^\s*Referrer-Policy:\s*(same-origin|no-referrer)\s*$/m);
  });
```

por:

```ts
  it("os cabeçalhos estáticos não deixam o endereço da página sair da origem (Referrer-Policy)", () => {
    expect(headers).toMatch(/^\s*Referrer-Policy:\s*(same-origin|no-referrer)\s*$/m);
  });

  it("a política de segurança de conteúdo (CSP) só deixa a página carregar e contactar a própria origem", () => {
    const csp = /^\s*Content-Security-Policy:\s*(.+)$/m.exec(headers)?.[1] ?? "";
    const directives = Object.fromEntries(
      csp
        .split(";")
        .map((part) => part.trim().split(/\s+/))
        .filter((part) => part[0] !== "")
        .map(([name, ...sources]) => [name, sources]),
    );
    expect(directives["default-src"]).toEqual(["'self'"]);
    // Scripts só da própria origem: nada inline e nada de eval (a defesa principal contra um XSS).
    expect(directives["script-src"]).toEqual(["'self'"]);
    // O React escreve os estilos pelo CSSOM, que a CSP não bloqueia: nada de `unsafe-inline` (nem de `unsafe-eval`) em lado nenhum.
    expect(directives["style-src"]).toEqual(["'self'"]);
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(directives["connect-src"]).toEqual(["'self'"]);
    expect(directives["img-src"]).toEqual(["'self'"]);
    expect(directives["frame-src"]).toEqual(["'self'"]);
    expect(directives["form-action"]).toEqual(["'self'"]);
    expect(directives["frame-ancestors"]).toEqual(["'self'"]);
    expect(directives["object-src"]).toEqual(["'none'"]);
    expect(directives["base-uri"]).toEqual(["'none'"]);
    // O conjunto de diretivas é fixo: uma diretiva nova (ou mais larga) tem de ser uma decisão, não um acidente.
    expect(Object.keys(directives).sort()).toEqual([
      "base-uri",
      "connect-src",
      "default-src",
      "form-action",
      "frame-ancestors",
      "frame-src",
      "img-src",
      "object-src",
      "script-src",
      "style-src",
    ]);
    expect(csp, "CSP").not.toMatch(EXTERNAL);
  });
```

Run: `npx vitest run -c vitest.web.config.ts src/web/shell.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  1 failed | 2 passed (3)).

Em `public/_headers`, trocar:

```
  Referrer-Policy: same-origin
```

por:

```
  Referrer-Policy: same-origin
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-src 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'
```

Run: `npx vitest run -c vitest.web.config.ts src/web/shell.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  3 passed (3)`.

- [ ] **Step 2: Registos sem os tokens dos links (testes primeiro)**

Com o `observability` ligado, a Cloudflare guarda um registo de cada invocação do Worker, e esse registo inclui o caminho do pedido. O token de uma partilha **vai no caminho** (`/api/public/shares/<token>` e `/api/public/shares/<token>/download`): quem lesse os registos, ou uma exportação deles, ficava com os links. A decisão é ligar o `observability` (é com ele que se vêem o relatório do cron e os erros, que são `console.log` e `console.error`) e desligar **só os registos de invocação** (`logs.invocation_logs: false`), que são os que trazem o URL. Um teste guarda a decisão, para que ninguém a desfaça por engano.

Em `src/web/shell.test.ts`, nos `import`, trocar:

```ts
import headers from "../../public/_headers?raw";
```

por:

```ts
import headers from "../../public/_headers?raw";
import wrangler from "../../wrangler.jsonc?raw";
```

No fim de `src/web/shell.test.ts`, acrescentar:

```ts
describe("a configuração de registos do Worker", () => {
  it("o `observability` está ligado, mas sem os registos de invocação (levariam o token de cada link de partilha, que vai no caminho do URL)", () => {
    const config = JSON.parse(wrangler) as { observability?: { enabled?: boolean; logs?: { invocation_logs?: boolean } } };
    expect(config.observability?.enabled).toBe(true);
    expect(config.observability?.logs?.invocation_logs).toBe(false);
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/shell.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  1 failed | 3 passed (4)).

Em `wrangler.jsonc`, a seguir a `triggers`, trocar:

```
  "triggers": { "crons": ["0 * * * *"] },
```

por:

```
  "triggers": { "crons": ["0 * * * *"] },
  "observability": { "enabled": true, "logs": { "invocation_logs": false } },
```

Run: `npx vitest run -c vitest.web.config.ts src/web/shell.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  4 passed (4)`.

- [ ] **Step 3: Verificação e commit**

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  34 passed (34)`, `Tests  267 passed (267)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npm run build`
Expected: `✓ built in ...` duas vezes (Worker e cliente); o `_headers` é copiado para `dist/client`.

Commit:

```bash
git add src public wrangler.jsonc
git commit -m "Acrescenta a CSP à aplicação e liga o observability sem os registos de invocação" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Acessibilidade dos diálogos: descrição, rolagem, foco de reserva, erro que não mente e largar sobre um diálogo

**Files:**
- Modify: `src/web/components/Modal.tsx`, `src/web/components/ConfirmDialog.tsx`, `src/web/components/NameDialog.tsx`, `src/web/components/AppLayout.tsx`, `src/web/pages/FolderPage.tsx`
- Test: `src/web/components/Modal.test.tsx`, `src/web/components/ConfirmDialog.test.tsx`, `src/web/components/NameDialog.test.tsx`, `src/web/components/AppLayout.test.tsx`, `src/web/pages/FolderPage.test.tsx`

**Interfaces:**
- Consumes: `Modal`, `ConfirmDialog`, `NameDialog`, `AppLayout`, `FolderPage` (planos 2B, 3B e 4) e os testes que já os cobrem.
- Produces: `Modal` com `describedBy?: string` (`aria-describedby`), que bloqueia a rolagem da página enquanto há um diálogo aberto e que, se o botão que o abriu desapareceu, devolve o foco ao `<main>`; o `<main>` do `AppLayout` focável por programa (`tabIndex={-1}`); `ConfirmDialog` com a pergunta como descrição; `NameDialog` cujo erro de validação desaparece ao escrever; a zona de largar da pasta que ignora o que se larga sobre um diálogo.

- [ ] **Step 1: O `Modal`: descrição, rolagem e foco de reserva (testes primeiro)**

Três pendentes da passagem de acessibilidade que o Plano 2B deixou. **Descrição:** um leitor de ecrã lê o título do diálogo, mas não a pergunta; o `Modal` ganha `describedBy` (o `id` do texto) para o `aria-describedby`. **Rolagem:** com um diálogo aberto a página por baixo continua a rolar (no telemóvel, o dedo arrasta a página e não o diálogo); enquanto houver um diálogo aberto o `<body>` não rola. Contam-se os diálogos abertos, porque um pode abrir-se por cima de outro. **Foco de reserva:** depois de mover ou excluir um ficheiro, o botão «⋮» que abriu o diálogo já não existe, e o foco caía para o `<body>`; passa a ir para o `<main>`, que por isso tem de aceitar o foco (`tabIndex={-1}`, sem contorno).

No fim de `src/web/components/Modal.test.tsx`, acrescentar:

```tsx
function DescribedHarness() {
  return (
    <Modal title="Excluir" describedBy="pergunta" onClose={() => undefined}>
      <p id="pergunta">Isto não se pode desfazer.</p>
      <button>Excluir</button>
    </Modal>
  );
}

function StackedHarness() {
  const [second, setSecond] = useState(true);
  return (
    <Modal title="Primeiro" onClose={() => undefined}>
      {second && (
        <Modal title="Segundo" onClose={() => setSecond(false)}>
          <button onClick={() => setSecond(false)}>Fechar o segundo</button>
        </Modal>
      )}
    </Modal>
  );
}

/** O botão que abre o diálogo desaparece quando o diálogo age (como o «⋮» de uma linha que se move ou se exclui). */
function RemovedOpenerHarness() {
  const [open, setOpen] = useState(false);
  const [hasOpener, setHasOpener] = useState(true);
  return (
    <main tabIndex={-1} aria-label="Conteúdo">
      {hasOpener && <button onClick={() => setOpen(true)}>Abrir</button>}
      {open && (
        <Modal
          title="Apagar"
          onClose={() => setOpen(false)}
        >
          <button
            onClick={() => {
              setHasOpener(false);
              setOpen(false);
            }}
          >
            Apagar tudo
          </button>
        </Modal>
      )}
    </main>
  );
}

describe("Modal: descrição, rolagem e foco de reserva", () => {
  it("a descrição (`aria-describedby`) é o texto indicado", () => {
    render(<DescribedHarness />);
    expect(screen.getByRole("dialog", { name: "Excluir" })).toHaveAccessibleDescription("Isto não se pode desfazer.");
  });

  it("a página não rola enquanto há um diálogo aberto, e volta a rolar quando o último se fecha", async () => {
    const user = await openModal();
    expect(document.body.style.overflow).toBe("hidden");
    await user.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("");
  });

  it("com um diálogo aberto por cima de outro, a página só volta a rolar quando os dois se fecham", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<StackedHarness />);
    expect(document.body.style.overflow).toBe("hidden");

    await user.click(screen.getByRole("button", { name: "Fechar o segundo" }));
    expect(screen.queryByRole("dialog", { name: "Segundo" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden"); // o primeiro continua aberto

    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("se o botão que abriu o diálogo desapareceu, o foco vai para o conteúdo da página e não para o <body>", async () => {
    const user = userEvent.setup();
    render(<RemovedOpenerHarness />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await user.click(screen.getByRole("button", { name: "Apagar tudo" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("main", { name: "Conteúdo" })).toHaveFocus();
  });
});
```

No fim de `src/web/components/AppLayout.test.tsx`, acrescentar:

```tsx
describe("AppLayout: o conteúdo da página", () => {
  it("aceita o foco por programa (é para onde vai o foco quando o botão que abriu um diálogo desaparece)", async () => {
    mockApi({ ...CONTENTS, "GET /api/auth/me": () => json({ user: ME }) });
    renderApp("/");
    await screen.findByRole("navigation", { name: "Principal" });
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
  });
});
```

Run:

```bash
npx vitest run -c vitest.web.config.ts src/web/components/Modal.test.tsx src/web/components/AppLayout.test.tsx
```
Expected: FAIL (Test Files  2 failed (2); Tests  5 failed | 20 passed (25)).

Em `src/web/components/Modal.tsx`, na interface das propriedades, trocar:

```tsx
  /** Largo, para a pré-visualização. */
  wide?: boolean;
}
```

por:

```tsx
  /** Largo, para a pré-visualização. */
  wide?: boolean;
  /** O `id` do texto que descreve o diálogo (`aria-describedby`): a pergunta de uma confirmação, por exemplo. */
  describedBy?: string;
}
```

A seguir a `FOCUSABLE`, trocar:

```tsx
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';
```

por:

```tsx
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

// A página por baixo não rola enquanto há um diálogo aberto. Contam-se os diálogos abertos: um pode abrir-se por cima de outro.
let openModals = 0;
let pageOverflow = "";

/** Devolve o foco a quem abriu o diálogo; se esse botão já não existe (a linha foi movida ou excluída), vai para o conteúdo da página e não para o `<body>`. */
function restoreFocus(opener: HTMLElement | null) {
  if (opener?.isConnected) opener.focus();
  else document.querySelector<HTMLElement>("main")?.focus();
}
```

Na função, trocar:

```tsx
export function Modal({ title, onClose, children, wide = false }: ModalProps) {
```

por:

```tsx
export function Modal({ title, onClose, children, wide = false, describedBy }: ModalProps) {
```

No primeiro `useEffect`, o foco de reserva; a seguir, o bloqueio da rolagem. Trocar:

```tsx
    return () => opener?.focus();
  }, [opener]);
```

por:

```tsx
    return () => restoreFocus(opener);
  }, [opener]);

  useEffect(() => {
    if (openModals++ === 0) {
      pageOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    return () => {
      if (--openModals === 0) document.body.style.overflow = pageOverflow;
    };
  }, []);
```

No `<div role="dialog">`, trocar:

```tsx
        aria-labelledby={titleId}
        tabIndex={-1}
```

por:

```tsx
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
```

Em `src/web/components/AppLayout.tsx`, trocar:

```tsx
        <main className="min-w-0 flex-1 p-6 md:p-8">
```

por:

```tsx
        <main tabIndex={-1} className="min-w-0 flex-1 p-6 outline-none md:p-8">
```

Run:

```bash
npx vitest run -c vitest.web.config.ts src/web/components/Modal.test.tsx src/web/components/AppLayout.test.tsx
```
Expected: `Test Files  2 passed (2)`, `Tests  25 passed (25)`.

- [ ] **Step 2: A pergunta de uma confirmação é a descrição do diálogo (testes primeiro)**

Em `src/web/components/ConfirmDialog.test.tsx`, trocar:

```tsx
  it("Excluir confirma e Cancelar fecha", async () => {
```

por:

```tsx
  it("a pergunta é a descrição do diálogo (o leitor de ecrã lê-a depois do título)", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Excluir pasta" })).toHaveAccessibleDescription("Excluir a pasta «Fotos»?");
  });

  it("Excluir confirma e Cancelar fecha", async () => {
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/ConfirmDialog.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  1 failed | 7 passed (8)).

Em `src/web/components/ConfirmDialog.tsx`, nos `import`, trocar:

```tsx
import { Button } from "./Button";
```

por:

```tsx
import { useId } from "react";
import { Button } from "./Button";
```

Na função, trocar:

```tsx
}: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={() => !pending && onClose()}>
      <div className="space-y-4">
        <p className="text-sm text-slate-700">{message}</p>
```

por:

```tsx
}: ConfirmDialogProps) {
  const messageId = useId();
  return (
    <Modal title={title} describedBy={messageId} onClose={() => !pending && onClose()}>
      <div className="space-y-4">
        <p id={messageId} className="text-sm text-slate-700">
          {message}
        </p>
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/ConfirmDialog.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  8 passed (8)`.

- [ ] **Step 3: O erro de validação do `NameDialog` não fica a mentir (testes primeiro)**

Depois de «O nome não pode conter a barra (/).», o erro continuava no ecrã enquanto se corrigia o nome, até se carregar em «Guardar» outra vez. Passa a desaparecer ao voltar a escrever. O Enter no campo já enviava o formulário, mas nenhum teste o dizia.

Em `src/web/components/NameDialog.test.tsx`, trocar:

```tsx
  it("mostra o erro do servidor e fica ocupado enquanto grava", () => {
```

por:

```tsx
  it("o erro de validação desaparece ao voltar a escrever (não fica a mentir sobre o que está no campo)", async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText("Nome da pasta"), "a/b");
    await user.click(screen.getByRole("button", { name: "Renomear" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Nome da pasta"), "c");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Enter no campo envia o nome normalizado", async () => {
    const { onSubmit, user } = setup();
    await user.type(screen.getByLabelText("Nome da pasta"), "  Férias {Enter}");
    expect(onSubmit).toHaveBeenCalledWith("Férias");
  });

  it("mostra o erro do servidor e fica ocupado enquanto grava", () => {
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/NameDialog.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  1 failed | 7 passed (8)).

Em `src/web/components/NameDialog.tsx`, trocar:

```tsx
          onChange={(event) => setValue(event.target.value)}
```

por:

```tsx
          onChange={(event) => {
            setValue(event.target.value);
            setLocalError(null);
          }}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/NameDialog.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  8 passed (8)`.

- [ ] **Step 4: Largar ficheiros sobre um diálogo não os envia (testes primeiro)**

A zona de largar é a página inteira, e os diálogos são filhos dela na árvore do React: um ficheiro largado sobre o diálogo «Nova pasta» subia pela árvore e era enviado, e a zona de largar acendia-se por baixo do diálogo. Um diálogo aberto é do que está a decorrer: enquanto houver um (`role="dialog"` com `aria-modal`), a zona de largar ignora tudo o que se larga, e a guarda da janela (em `AppLayout`) continua a impedir que o browser abra o ficheiro. A guarda **não olha ao alvo do evento**: o fundo escurecido do diálogo (`Modal`) é irmão da caixa do diálogo e cobre o ecrã todo, por isso um ficheiro largado no fundo, fora da caixa, também não pode ser enviado (o segundo teste larga no fundo e na caixa).

Em `src/web/pages/FolderPage.test.tsx`, no grupo dos envios, trocar:

```tsx
  it("um ficheiro acima do limite do servidor nem é enviado", async () => {
```

por:

```tsx
  it("um ficheiro largado sobre um diálogo aberto não é enviado (a zona de largar não vê o que cai num diálogo)", async () => {
    const Xhr = stubXhr();
    serve();
    const user = userEvent.setup();
    renderApp("/pasta/f1");
    await user.click(await screen.findByRole("button", { name: "Nova pasta" }));
    const dialog = screen.getByRole("dialog", { name: "Nova pasta" });
    const dataTransfer = {
      types: ["Files"],
      items: [{ kind: "file", getAsFile: () => new File(["x"], "solta.png"), webkitGetAsEntry: () => ({ isDirectory: false }) }],
    };

    fireEvent.dragEnter(dialog, { dataTransfer });
    fireEvent.drop(dialog, { dataTransfer });

    expect(Xhr.instances).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: "Nova pasta" })).toBeInTheDocument();
  });

  it("um diálogo aberto fica com tudo o que se larga, também no fundo (o fundo cobre o ecrã todo)", async () => {
    const Xhr = stubXhr();
    serve();
    const user = userEvent.setup();
    renderApp("/pasta/f1");
    await user.click(await screen.findByRole("button", { name: "Nova pasta" }));
    const dialog = screen.getByRole("dialog", { name: "Nova pasta" });
    const backdrop = dialog.parentElement!;
    const dataTransfer = {
      types: ["Files"],
      items: [{ kind: "file", getAsFile: () => new File(["x"], "solta.png"), webkitGetAsEntry: () => ({ isDirectory: false }) }],
    };

    fireEvent.dragEnter(backdrop, { dataTransfer });
    expect(document.querySelector(".outline-dashed")).toBeNull(); // a zona de largar não se acende
    // `fireEvent` devolve `false` quando alguém chamou `preventDefault`: é a guarda da janela (`AppLayout`) a impedir o browser de abrir o ficheiro.
    expect(fireEvent.drop(backdrop, { dataTransfer })).toBe(false);
    expect(fireEvent.drop(dialog, { dataTransfer })).toBe(false);

    expect(Xhr.instances).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: "Nova pasta" })).toBeInTheDocument();
  });

  it("um ficheiro acima do limite do servidor nem é enviado", async () => {
```

Run: `npx vitest run -c vitest.web.config.ts src/web/pages/FolderPage.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  2 failed | 21 passed (23)).

Em `src/web/pages/FolderPage.tsx`, a seguir a `hasFiles`, trocar:

```tsx
const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
```

por:

```tsx
const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
/** Um diálogo aberto é do que está a decorrer: enquanto houver um, o que se larga não é para a zona de largar (o fundo do diálogo cobre o ecrã todo, por isso não basta olhar ao alvo do evento). */
const dialogOpen = () => document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
```

Em `onDrop`, trocar:

```tsx
  function onDrop(event: DragEvent) {
    event.preventDefault();
```

por:

```tsx
  function onDrop(event: DragEvent) {
    if (dialogOpen()) return; // a guarda da janela (`AppLayout`) já impede o browser de abrir o ficheiro
    event.preventDefault();
```

Em `onDragEnter`, trocar:

```tsx
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
```

por:

```tsx
      onDragEnter={(event) => {
        if (dialogOpen() || !hasFiles(event)) return;
```

Em `onDragOver`, trocar:

```tsx
        if (hasFiles(event)) event.preventDefault();
```

por:

```tsx
        if (hasFiles(event) && !dialogOpen()) event.preventDefault();
```

Run: `npx vitest run -c vitest.web.config.ts src/web/pages/FolderPage.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  23 passed (23)`.

- [ ] **Step 5: Verificação e commit**

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  34 passed (34)`, `Tests  277 passed (277)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src
git commit -m "Melhora a acessibilidade dos diálogos: descrição, rolagem, foco de reserva e largar" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Acessibilidade dos menus e das listas: setas e Home/End no menu, anel de foco do botão de perigo e «A carregar…» anunciado

**Files:**
- Create: `src/web/components/Loading.tsx`, `src/web/components/Loading.test.tsx`, `src/web/components/Button.test.tsx`
- Modify: `src/web/components/RowMenu.tsx`, `src/web/components/Button.tsx`, `src/web/components/AppLayout.tsx`, `src/web/components/ShareDialog.tsx`, `src/web/components/MoveDialog.tsx`, `src/web/pages/FolderPage.tsx`, `src/web/pages/TrashPage.tsx`, `src/web/pages/AdminPage.tsx`, `src/web/pages/SharePage.tsx`
- Test: `src/web/components/RowMenu.test.tsx`, `src/web/components/AppLayout.test.tsx`

**Interfaces:**
- Consumes: `RowMenu`, `Button`/`buttonClass`, as páginas e diálogos que mostram «A carregar…».
- Produces: `RowMenu` que abre com a seta para baixo, salta com Home/End e não desenha nada sem ações; botões com o anel de foco da sua cor (o de perigo é vermelho); `Loading({ className?, children? })` (`src/web/components/Loading.tsx`), a região de estado (`role="status"`) que as páginas e diálogos usam para «A carregar…».

- [ ] **Step 1: O menu «⋮» no teclado (testes primeiro)**

O padrão de um menu de botão (WAI-ARIA): a seta para baixo no botão fechado abre-o e põe o foco na primeira ação, `Home` e `End` saltam para a primeira e a última ação, e um menu sem ações não se desenha (hoje, com a lista vazia, as setas dividiam por zero e rebentavam).

No fim de `src/web/components/RowMenu.test.tsx`, acrescentar:

```tsx
describe("RowMenu: teclado", () => {
  it("a seta para baixo no botão fechado abre o menu com o foco na primeira ação", async () => {
    const { button, user } = setup();
    button.focus();

    await user.keyboard("{ArrowDown}");

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Renomear" })).toHaveFocus();
  });

  it("Home e End saltam para a primeira e para a última ação", async () => {
    const { button, user } = setup();
    await user.click(button);

    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Excluir" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "Renomear" })).toHaveFocus();
  });

  it("sem ações não desenha nada (um menu vazio rebentava com as setas)", () => {
    const { container } = render(<RowMenu label="Ações para a pasta vazia" actions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/RowMenu.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  3 failed | 6 passed (9)).

Em `src/web/components/RowMenu.tsx`, no início de `onKeyDown`, trocar:

```tsx
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (event.key === "Escape") {
```

por:

```tsx
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) {
      // O botão fechado também abre o menu com a seta para baixo (não obriga a usar Enter ou Espaço).
      if (event.key === "ArrowDown" && event.target === buttonRef.current) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === "Escape") {
```

Mais abaixo, trocar:

```tsx
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
```

por:

```tsx
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const items = [...rootRef.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
      items[event.key === "Home" ? 0 : items.length - 1].focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
```

Antes do `return` do componente (depois de todos os hooks), trocar:

```tsx
  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
```

por:

```tsx
  if (actions.length === 0) return null;

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/RowMenu.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  9 passed (9)`.

- [ ] **Step 2: O anel de foco acompanha a cor do botão (testes primeiro)**

O botão de perigo («Excluir», «Apagar conta…») tinha o anel de foco índigo, a cor dos botões normais: o único sinal visual de «isto destrói» desaparecia justamente quando o teclado lá chegava. A cor do anel passa a viver em cada variante (e não na base: duas classes `ring-*` na mesma regra não se desempatam pela ordem em que estão escritas).

Criar `src/web/components/Button.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";

describe("Button: o anel de foco", () => {
  it("o botão de perigo tem o anel vermelho (e só esse) e os outros o índigo", () => {
    render(
      <>
        <Button variant="danger">Excluir</Button>
        <Button>Guardar</Button>
        <Button variant="secondary">Cancelar</Button>
      </>,
    );

    const danger = screen.getByRole("button", { name: "Excluir" }).className;
    expect(danger).toContain("focus-visible:ring-red-300");
    expect(danger).not.toContain("ring-indigo");
    for (const name of ["Guardar", "Cancelar"]) {
      const className = screen.getByRole("button", { name }).className;
      expect(className, name).toContain("focus-visible:ring-indigo-300");
      expect(className, name).not.toContain("ring-red");
    }
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/Button.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  1 failed (1)).

Em `src/web/components/Button.tsx`, trocar:

```tsx
transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-60";
const VARIANTS = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-500",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  danger: "bg-red-600 text-white hover:bg-red-500",
};
```

por:

```tsx
transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60";
// A cor do anel de foco vive em cada variante: o botão de perigo tem o anel vermelho.
const VARIANTS = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:ring-indigo-300",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-indigo-300",
  danger: "bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-300",
};
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/Button.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  1 passed (1)`.

- [ ] **Step 3: «A carregar…» é uma região de estado (testes primeiro)**

Um leitor de ecrã não anuncia um parágrafo que aparece sozinho: «A carregar…» é invisível para quem o usa. Uma região de estado (`role="status"`) é anunciada com educação, sem interromper. Sete sítios mostravam o mesmo parágrafo com classes ligeiramente diferentes; passam a usar um componente, `Loading`.

Criar `src/web/components/Loading.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Loading } from "./Loading";

describe("Loading", () => {
  it("é uma região de estado (o leitor de ecrã anuncia-a) e diz «A carregar…» por defeito", () => {
    render(<Loading />);
    expect(screen.getByRole("status")).toHaveTextContent("A carregar…");
  });

  it("aceita outro texto e classes extra", () => {
    render(<Loading className="p-8">A carregar pastas…</Loading>);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("A carregar pastas…");
    expect(status).toHaveClass("p-8", "text-slate-500");
  });
});
```

No fim de `src/web/components/AppLayout.test.tsx`, acrescentar:

```tsx
describe("AppLayout: enquanto a sessão carrega", () => {
  it("o aviso é uma região de estado, para o leitor de ecrã o anunciar", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mockApi({
      ...CONTENTS,
      "GET /api/auth/me": async () => {
        await gate;
        return json({ user: ME });
      },
    });
    renderApp("/");

    expect(await screen.findByRole("status")).toHaveTextContent("A carregar…");

    release();
    await screen.findByRole("navigation", { name: "Principal" });
  });
});
```

O teste da pesquisa procura «a» região de estado: com o «A carregar…» do layout também a anunciar, tem de esperar primeiro pela sessão. Em `src/web/pages/SearchPage.test.tsx`, trocar:

```tsx
    renderApp("/pesquisa?q=praia");
    const status = await screen.findByRole("status");
```

por:

```tsx
    renderApp("/pesquisa?q=praia");
    await screen.findByRole("navigation", { name: "Principal" }); // a sessão já carregou (o «A carregar…» do layout também é uma região de estado)
    const status = await screen.findByRole("status");
```

Run:

```bash
npx vitest run -c vitest.web.config.ts src/web/components/Loading.test.tsx src/web/components/AppLayout.test.tsx
```
Expected: FAIL (Test Files  2 failed (2); Tests  1 failed | 16 passed (17)).

Criar `src/web/components/Loading.tsx`:

```tsx
import type { ReactNode } from "react";

/** O aviso de «a carregar»: uma região de estado (`role="status"`), para o leitor de ecrã o anunciar. */
export function Loading({ className = "", children = "A carregar…" }: { className?: string; children?: ReactNode }) {
  return (
    <p role="status" className={`text-slate-500 ${className}`.trim()}>
      {children}
    </p>
  );
}
```

Em `src/web/pages/FolderPage.tsx`, nos `import`, trocar:

```tsx
import { FileRow, FolderRow } from "../components/ItemRows";
```

por:

```tsx
import { FileRow, FolderRow } from "../components/ItemRows";
import { Loading } from "../components/Loading";
```

Mais abaixo, trocar:

```tsx
  if (contents.isPending) return <p className="text-slate-500">A carregar…</p>;
```

por:

```tsx
  if (contents.isPending) return <Loading />;
```

Em `src/web/pages/TrashPage.tsx`, nos `import`, trocar:

```tsx
import { Location } from "../components/Location";
```

por:

```tsx
import { Loading } from "../components/Loading";
import { Location } from "../components/Location";
```

Mais abaixo, trocar:

```tsx
  if (trash.isPending) return <p className="text-slate-500">A carregar…</p>;
```

por:

```tsx
  if (trash.isPending) return <Loading />;
```

Em `src/web/pages/AdminPage.tsx`, nos `import`, trocar:

```tsx
import { Button } from "../components/Button";
```

por:

```tsx
import { Button } from "../components/Button";
import { Loading } from "../components/Loading";
```

Mais abaixo, trocar:

```tsx
  if (users.isPending) return <p className="text-slate-500">A carregar…</p>;
```

por:

```tsx
  if (users.isPending) return <Loading />;
```

Em `src/web/pages/SharePage.tsx`, nos `import`, trocar:

```tsx
import { Button, buttonClass } from "../components/Button";
```

por:

```tsx
import { Button, buttonClass } from "../components/Button";
import { Loading } from "../components/Loading";
```

Mais abaixo, trocar:

```tsx
    body = <p className="text-sm text-slate-500">A carregar…</p>;
```

por:

```tsx
    body = <Loading className="text-sm" />;
```

Em `src/web/components/AppLayout.tsx`, nos `import`, trocar:

```tsx
import { ConfirmDialog } from "./ConfirmDialog";
```

por:

```tsx
import { ConfirmDialog } from "./ConfirmDialog";
import { Loading } from "./Loading";
```

Mais abaixo, trocar:

```tsx
  if (me.isPending) return <p className="p-8 text-slate-500">A carregar…</p>;
```

por:

```tsx
  if (me.isPending) return <Loading className="p-8" />;
```

Em `src/web/components/ShareDialog.tsx`, nos `import`, trocar:

```tsx
import { Button } from "./Button";
```

por:

```tsx
import { Button } from "./Button";
import { Loading } from "./Loading";
```

Mais abaixo, trocar:

```tsx
            <p className="text-sm text-slate-500">A carregar…</p>
```

por:

```tsx
            <Loading className="text-sm" />
```

Em `src/web/components/MoveDialog.tsx`, nos `import`, trocar:

```tsx
import { Button } from "./Button";
```

por:

```tsx
import { Button } from "./Button";
import { Loading } from "./Loading";
```

Mais abaixo, trocar:

```tsx
        <p className="text-sm text-slate-500">A carregar pastas…</p>
```

por:

```tsx
        <Loading className="text-sm">A carregar pastas…</Loading>
```

Run:

```bash
npx vitest run -c vitest.web.config.ts src/web/components/Loading.test.tsx src/web/components/AppLayout.test.tsx
```
Expected: `Test Files  2 passed (2)`, `Tests  19 passed (19)`.

- [ ] **Step 4: Verificação e commit**

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  36 passed (36)`, `Tests  284 passed (284)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src
git commit -m "Melhora a acessibilidade dos menus e das listas: teclado no menu, anel de perigo e «A carregar…» anunciado" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Testes de ponta a ponta: o Playwright contra a aplicação construída, e o teste de fumo

**Files:**
- Create: `playwright.config.ts`, `tsconfig.e2e.json`, `e2e/env.ts`, `e2e/support.ts`, `e2e/smoke.spec.ts`
- Modify: `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `.gitignore`

**Interfaces:**
- Consumes: o `npm run build` e o `vite preview` do projeto, `wrangler d1 migrations apply --persist-to`, as rotas e os rótulos da interface.
- Produces: `npm run test:e2e` (Playwright, Chromium); a pasta de estado `.e2e-state` (a D1 e o R2 simulados dos testes, vazios em cada execução, nunca a `.wrangler` de desenvolvimento) e a variável `E2E_STATE` que o `vite.config.ts` lê; `e2e/support.ts` com `PASSWORD`, `uniqueEmail`, `signUp`, `sql`, `createFolder`, `upload` e `chooseAction`; o teste de fumo.

- [ ] **Step 1: Instalar o Playwright e montar a execução**

Os testes do Worker e os da interface não veem o que só um browser vê: o `Content-Length` que o browser põe num envio, a CSP, o arrastar-e-largar, o foco e a área de transferência, a página pública sem sessão, o fallback de SPA do Worker. Os testes de ponta a ponta correm o **Worker de verdade**: `npm run build` e `vite preview` servem a aplicação construída no workerd, com os assets estáticos, o `public/_headers` e o `run_worker_first` como em produção (em `npm run dev` o `_headers` não se aplica). A D1 e o R2 simulados ficam em `.e2e-state` (a opção `persistState` do plugin da Cloudflare, ligada pela variável `E2E_STATE`), por isso **nunca tocam na `.wrangler` de desenvolvimento**, e começam vazios em cada execução (as migrações são aplicadas pelo `wrangler d1 migrations apply --persist-to`). Os testes partilham um só servidor e correm um de cada vez; cada um usa emails que mais ninguém usa (`uniqueEmail`).

Run: `npm install -D @playwright/test@^1.63.0`
Expected: o `npm` acrescenta `@playwright/test` às `devDependencies` do `package.json` e atualiza o `package-lock.json` (mostra os avisos `allow-scripts`, que são inofensivos).

Run: `npx playwright install chromium`
Expected: o Playwright descarrega o Chromium para a cache do utilizador (`~/Library/Caches/ms-playwright`, cerca de 100 MB, só da primeira vez; não imprime nada se já o tem). Quem preferir o Google Chrome instalado define `E2E_CHANNEL=chrome` e não precisa deste comando.

Criar `e2e/env.ts`:

```ts
/** A porta onde os testes de ponta a ponta servem a aplicação construída (fora das portas de desenvolvimento, 5173 e 5174). */
export const PORT = 4180;
export const ORIGIN = `http://localhost:${PORT}`;
/** A pasta onde esse servidor guarda a D1 e o R2 simulados: nunca é a `.wrangler` de desenvolvimento. */
export const STATE_DIR = ".e2e-state";
```

Criar `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";
import { ORIGIN, PORT, STATE_DIR } from "./e2e/env";

// Os testes correm contra a aplicação CONSTRUÍDA (`vite build` + `vite preview`): é o Worker real no workerd, com os assets estáticos e o
// `public/_headers` aplicados como em produção. A base de dados e o R2 vivem em `.e2e-state` e começam vazios em cada execução.
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  // Os testes partilham um só servidor e uma só base de dados: correm um de cada vez e cada um usa emails que mais ninguém usa.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  use: {
    baseURL: ORIGIN,
    // `E2E_CHANNEL=chrome` usa o Google Chrome instalado em vez do Chromium do Playwright (`npx playwright install chromium`).
    channel: process.env.E2E_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    // A construção vem antes das migrações: o wrangler segue o `.wrangler/deploy/config.json` até ao `dist/`, que a construção recria; com o
    // `dist/` apagado e o ficheiro de redirecionamento ainda lá, migrar primeiro falha.
    command: [
      `rm -rf ${STATE_DIR}`,
      "npm run build",
      `npx wrangler d1 migrations apply DB --local --persist-to ${STATE_DIR}`,
      `E2E_STATE=${STATE_DIR} npx vite preview --port ${PORT} --strictPort`,
    ].join(" && "),
    url: `${ORIGIN}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
```

Criar `tsconfig.e2e.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.e2e.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["node"]
  },
  "include": ["e2e", "playwright.config.ts"]
}
```

Em `vite.config.ts`, trocar:

```ts
  plugins: [react(), tailwindcss(), cloudflare()],
```

por:

```ts
  // `E2E_STATE` (só nos testes de ponta a ponta) manda guardar a D1 e o R2 simulados noutra pasta, para não mexerem na `.wrangler` de desenvolvimento.
  plugins: [react(), tailwindcss(), cloudflare({ persistState: process.env.E2E_STATE ? { path: process.env.E2E_STATE } : true })],
```

Em `tsconfig.json`, nas `references`, trocar:

```json
    { "path": "./tsconfig.node.json" }
  ]
```

por:

```json
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.e2e.json" }
  ]
```

Em `package.json`, nos `scripts`, trocar:

```json
    "test:web": "vitest run -c vitest.web.config.ts",
```

por:

```json
    "test:web": "vitest run -c vitest.web.config.ts",
    "test:e2e": "playwright test",
```

Em `.gitignore`, trocar:

```
# Testes
playwright-report/
test-results/
```

por:

```
# Testes
playwright-report/
test-results/
.e2e-state/
```

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

- [ ] **Step 2: Os ajudantes dos testes**

`signUp` cria a conta pela API (o cookie de sessão fica no contexto do browser, que é o que interessa) e abre «Meu espaço»: só o teste de fumo passa pelo ecrã de registo. `sql` corre uma instrução na base de teste com `wrangler d1 execute --local --persist-to .e2e-state`, para o que a interface não faz (promover um administrador, mudar uma quota). Os outros ajudantes (`createFolder`, `upload`, `chooseAction`) fazem pela interface o que quase todos os testes repetem.

Criar `e2e/support.ts`:

```ts
import { execFileSync } from "node:child_process";
import { expect, type Page } from "@playwright/test";
import { ORIGIN, STATE_DIR } from "./env";

export const PASSWORD = "e2e-senha-1234";

let counter = 0;
/** Um email que mais nenhum teste usa: os testes partilham a mesma base de dados. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${counter++}@example.test`;
}

/** Cria a conta pela API (o cookie de sessão fica no contexto do browser) e abre «Meu espaço». */
export async function signUp(page: Page, email = uniqueEmail("ana")): Promise<string> {
  const res = await page.request.post("/api/auth/register", { data: { email, password: PASSWORD }, headers: { Origin: ORIGIN } });
  expect(res.status(), await res.text()).toBe(201);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Meu espaço" })).toBeVisible();
  return email;
}

/** Corre uma instrução SQL na base de dados de teste (a de `.e2e-state`): para o que a interface não faz, como promover um administrador. */
export function sql(command: string): void {
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--persist-to", STATE_DIR, "--command", command], {
    // O stderr do wrangler fica no erro lançado (em vez de se perder) e o limite evita que um wrangler pendurado prenda o teste.
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 60_000,
  });
}

/** Cria a pasta pelo diálogo «Nova pasta». */
export async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Nova pasta" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova pasta" });
  await dialog.getByLabel("Nome da pasta").fill(name);
  await dialog.getByRole("button", { name: "Criar" }).click();
  await expect(page.getByRole("link", { name })).toBeVisible();
}

/** Envia um ficheiro pelo campo de ficheiros da página e espera que o envio acabe. */
export async function upload(page: Page, name: string, content: string | Buffer, mimeType = "text/plain"): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer: Buffer.isBuffer(content) ? content : Buffer.from(content) });
  await expect(page.getByRole("button", { name: `Ações para o ficheiro ${name}` })).toBeVisible({ timeout: 10_000 });
}

/** Abre o menu «⋮» de uma linha e escolhe a ação. */
export async function chooseAction(page: Page, rowLabel: string, action: string): Promise<void> {
  await page.getByRole("button", { name: rowLabel }).click();
  await page.getByRole("menuitem", { name: action }).click();
}
```

- [ ] **Step 3: O teste de fumo**

A especificação (secção 10) pede um teste de fumo: registo, login, criar pasta, carregar, mover, excluir e restaurar. É um só teste, com passos, tudo pela interface e num browser real. Estes testes escrevem-se **depois** do código que testam: não há uma fase «vermelha», e uma falha é um defeito encontrado (ou um teste mal escrito).

Criar `e2e/smoke.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { chooseAction, createFolder, PASSWORD, uniqueEmail, upload } from "./support";

// O teste de fumo da especificação (secção 10): registo, login, criar pasta, carregar, mover, excluir e restaurar, tudo pela interface.
test("registo, pasta, envio, mover, excluir, restaurar e voltar a entrar", async ({ page }) => {
  const email = uniqueEmail("fumo");

  await test.step("sem sessão a aplicação pede o login, e regista-se uma conta", async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
    await page.getByRole("link", { name: "Registe-se" }).click();
    // As páginas carregam-se por partes: sem esperar pelo título, o email iria para o formulário de login, que ainda está no ecrã.
    await expect(page.getByRole("heading", { name: "Criar conta" })).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirmar senha").fill(PASSWORD);
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(page.getByRole("heading", { name: "Meu espaço" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
  });

  await test.step("cria uma pasta e envia um ficheiro", async () => {
    await createFolder(page, "Fotos");
    await upload(page, "nota.txt", "olá, mundo");
    await expect(page.getByText("Concluído")).toBeVisible();
  });

  await test.step("move o ficheiro para a pasta", async () => {
    await chooseAction(page, "Ações para o ficheiro nota.txt", "Mover…");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Pasta de destino").selectOption({ label: "Fotos" });
    await dialog.getByRole("button", { name: "Mover" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ações para o ficheiro nota.txt" })).toHaveCount(0); // saiu da raiz
    await page.getByRole("link", { name: "Fotos" }).click();
    await expect(page.getByRole("heading", { name: "Fotos" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ações para o ficheiro nota.txt" })).toBeVisible();
  });

  await test.step("exclui o ficheiro (vai para a lixeira) e restaura-o", async () => {
    await chooseAction(page, "Ações para o ficheiro nota.txt", "Excluir");
    await page.getByRole("dialog", { name: "Excluir ficheiro" }).getByRole("button", { name: "Excluir" }).click();
    await expect(page.getByRole("button", { name: "Ações para o ficheiro nota.txt" })).toHaveCount(0);

    await page.getByRole("link", { name: "Lixeira" }).click();
    const restore = page.getByRole("button", { name: "Restaurar nota.txt" });
    await expect(restore).toBeVisible();
    await restore.click();
    await expect(restore).toHaveCount(0); // saiu da lixeira

    await page.getByRole("link", { name: "Meu espaço" }).click();
    await page.getByRole("link", { name: "Fotos" }).click();
    await expect(page.getByRole("button", { name: "Ações para o ficheiro nota.txt" })).toBeVisible(); // voltou à pasta de origem
  });

  await test.step("sai e volta a entrar com a mesma conta", async () => {
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Senha").fill(PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("heading", { name: "Meu espaço" })).toBeVisible();
  });
});
```

Run: `npx playwright test e2e/smoke.spec.ts`
Expected: `1 passed` (a duração varia).

- [ ] **Step 4: Verificação e commit**

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  36 passed (36)`, `Tests  284 passed (284)`.

Commit:

```bash
git add package.json package-lock.json playwright.config.ts tsconfig.e2e.json tsconfig.json vite.config.ts .gitignore e2e
git commit -m "Acrescenta o Playwright: a aplicação construída num browser real e o teste de fumo" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Testes de ponta a ponta: envios, pré-visualização, partilha e a CSP em vigor

**Files:**
- Create: `e2e/uploads.spec.ts`, `e2e/preview.spec.ts`, `e2e/share.spec.ts`, `e2e/csp.spec.ts`

**Interfaces:**
- Consumes: `signUp`, `sql`, `createFolder`, `upload`, `chooseAction`, `PASSWORD` (`e2e/support.ts`, Task 6) e a aplicação construída.
- Produces: quatro ficheiros de testes que confirmam, num browser real, o que os planos 2A a 4 deixaram anotado para o Plano 5: o `Content-Length` do envio, o arrastar-e-largar, a pré-visualização (imagem sob CSP, PDF sem CSP e com `Range`), a partilha (copiar, página pública sem sessão, descarregamento como anexo, revogação) e a CSP da Task 3.

- [ ] **Step 1: Envios: o `Content-Length`, o arrastar-e-largar e a quota**

O Worker exige o `Content-Length` do envio (o R2 precisa do tamanho para gravar em *stream*). Os testes da interface usam um XHR falso e os do Worker um pedido construído à mão: só um browser real prova que o `XMLHttpRequest` o põe sozinho. O arrastar-e-largar usa um `DataTransfer` verdadeiro (`webkitGetAsEntry` incluído). O terceiro teste mexe na quota pela base de teste (`sql`), porque a interface não o faz. Estes testes escrevem-se depois do código que testam (não há fase «vermelha»): uma falha é um defeito encontrado.

Criar `e2e/uploads.spec.ts`:

```ts
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signUp, sql, upload } from "./support";

test("o envio leva o Content-Length do ficheiro (o Worker exige-o) e o ficheiro desce igual, sempre como anexo", async ({ page }) => {
  await signUp(page);
  const content = "x".repeat(10_000);
  const sent = page.waitForRequest((request) => request.method() === "PUT" && request.url().includes("/api/files?"));

  await upload(page, "dez-mil.txt", content);

  expect((await (await sent).allHeaders())["content-length"]).toBe("10000");

  await page.getByRole("button", { name: "Ações para o ficheiro dez-mil.txt" }).click();
  const link = page.getByRole("menuitem", { name: "Descarregar" });
  const href = (await link.getAttribute("href"))!;
  const download = page.waitForEvent("download");
  await link.click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("dez-mil.txt");
  expect(await readFile(await file.path(), "utf8")).toBe(content);

  const res = await page.request.get(href);
  expect(res.headers()["content-disposition"]).toMatch(/^attachment/);
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["content-security-policy"]).toBe("default-src 'none'; sandbox");
});

test("arrastar e largar um ficheiro sobre a página envia-o para a pasta atual", async ({ page }) => {
  await signUp(page);
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["largado"], "largado.txt", { type: "text/plain" }));
    return transfer;
  });
  const heading = page.getByRole("heading", { name: "Meu espaço" });

  await heading.dispatchEvent("dragenter", { dataTransfer });
  await heading.dispatchEvent("drop", { dataTransfer });

  await expect(page.getByRole("button", { name: "Ações para o ficheiro largado.txt" })).toBeVisible();
});

test("um envio que não cabe na quota é recusado com a mensagem do servidor, e nada fica na lista", async ({ page }) => {
  const email = await signUp(page);
  sql(`UPDATE users SET quota_bytes = 5 WHERE email = '${email}'`);

  await page.locator('input[type="file"]').setInputFiles({ name: "grande.txt", mimeType: "text/plain", buffer: Buffer.from("mais de cinco bytes") });

  await expect(page.getByText("Sem espaço suficiente na sua quota.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ações para o ficheiro grande.txt" })).toHaveCount(0);
});
```

Run: `npx playwright test e2e/uploads.spec.ts`
Expected: `3 passed` (a duração varia).

- [ ] **Step 2: Pré-visualização: a imagem isolada, o PDF numa `<iframe>`**

A imagem vem com `Content-Security-Policy: default-src 'none'; sandbox` (nada do ficheiro pode correr, mesmo que o nome diga `.png`); o PDF não pode ter CSP, porque o leitor do browser não funciona com ela, e serve-se com `Range` (o leitor pede-o por partes). O Esc fecha o diálogo e o foco volta ao botão «⋮» da linha. (O leitor de PDF do Chrome apropria-se do foco depois de carregar e o Esc deixa de fechar o diálogo: isso só se vê num Chrome com interface e fica fora destes testes, que correm sem ela.)

Criar `e2e/preview.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { chooseAction, signUp, upload } from "./support";

// Um PNG de 1×1 e um PDF mínimo, mas válidos.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

test("a pré-visualização de uma imagem carrega-a, sob uma CSP que a isola, e o Esc devolve o foco ao menu", async ({ page }) => {
  await signUp(page);
  await upload(page, "ponto.png", PNG, "image/png");

  await chooseAction(page, "Ações para o ficheiro ponto.png", "Pré-visualizar");

  const dialog = page.getByRole("dialog", { name: "ponto.png" });
  const image = dialog.getByRole("img", { name: "ponto.png" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);

  const res = await page.request.get((await image.getAttribute("src"))!);
  expect(res.headers()["content-type"]).toBe("image/png");
  expect(res.headers()["content-security-policy"]).toBe("default-src 'none'; sandbox");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ações para o ficheiro ponto.png" })).toBeFocused();
});

test("a pré-visualização de um PDF vai numa <iframe>, sem CSP (o leitor do browser precisa dela) e com suporte de Range", async ({ page }) => {
  await signUp(page);
  await upload(page, "minimo.pdf", PDF, "application/pdf");

  await chooseAction(page, "Ações para o ficheiro minimo.pdf", "Pré-visualizar");

  const frame = page.getByRole("dialog", { name: "minimo.pdf" }).locator("iframe");
  await expect(frame).toBeVisible();
  const src = (await frame.getAttribute("src"))!;

  const whole = await page.request.get(src);
  expect(whole.headers()["content-type"]).toBe("application/pdf");
  expect(whole.headers()["content-security-policy"]).toBeUndefined();
  expect(whole.headers()["content-disposition"]).toMatch(/^inline/);

  const part = await page.request.get(src, { headers: { Range: "bytes=0-7" } });
  expect(part.status()).toBe(206);
  expect(part.headers()["content-range"]).toMatch(/^bytes 0-7\//);
  expect(await part.text()).toBe("%PDF-1.1");
});
```

Run: `npx playwright test e2e/preview.spec.ts`
Expected: `2 passed` (a duração varia).

- [ ] **Step 3: Partilha: do diálogo à página pública**

O fluxo inteiro, com dois contextos de browser: o dono cria o link e copia-o (a permissão da área de transferência é dada ao contexto), e **outro contexto, sem cookies**, abre `/s/<token>` (o fallback de SPA do Worker), vê o nome e o tamanho e descarrega. O descarregamento público é sempre um anexo, isolado e sem *cache*. Revogar o link no diálogo faz a página pública mostrar o aviso de «link indisponível», o mesmo de um link que nunca existiu. O último teste **força** a recusa da área de transferência (um *script* de arranque faz `navigator.clipboard.writeText` rejeitar com `NotAllowedError`, em vez de confiar no que o browser faz por omissão sem permissão): «Copiar» tem de selecionar o link e explicar como o copiar à mão.

Criar `e2e/share.spec.ts`:

```ts
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { chooseAction, signUp, upload } from "./support";

const NOT_AVAILABLE = "Este link não existe ou já não está disponível.";

test("partilhar: criar o link, copiá-lo, abri-lo sem sessão, descarregar como anexo e revogá-lo", async ({ page, browser, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let link = "";
  await signUp(page);
  await upload(page, "relatorio.txt", "conteúdo do relatório");

  await test.step("cria o link e copia-o para a área de transferência", async () => {
    await chooseAction(page, "Ações para o ficheiro relatorio.txt", "Partilhar…");
    const dialog = page.getByRole("dialog", { name: "Partilhar «relatorio.txt»" });
    await dialog.getByLabel("Validade do link").selectOption({ label: "7 dias" });
    await dialog.getByRole("button", { name: "Criar link" }).click();
    await dialog.getByRole("button", { name: "Copiar" }).click();
    await expect(dialog.getByText("Link copiado.")).toBeVisible();
    const shown = await dialog.getByLabel("Link de partilha").inputValue();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shown);
    expect(shown).toMatch(/\/s\/[\w-]{20,}$/);
    link = shown;
  });

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();

  await test.step("quem não tem conta abre o link (o fallback de SPA do Worker) e descarrega", async () => {
    await guestPage.goto(link);
    await expect(guestPage.getByText("relatorio.txt")).toBeVisible();
    await expect(guestPage.getByText(/\d+ B$/)).toBeVisible();
    const download = guestPage.waitForEvent("download");
    await guestPage.getByRole("link", { name: "Descarregar" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("relatorio.txt");
    expect(await readFile(await file.path(), "utf8")).toBe("conteúdo do relatório");
  });

  await test.step("o descarregamento público é sempre um anexo, isolado", async () => {
    const href = (await guestPage.getByRole("link", { name: "Descarregar" }).getAttribute("href"))!;
    const res = await guestPage.request.get(href);
    expect(res.headers()["content-disposition"]).toMatch(/^attachment/);
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(res.headers()["cache-control"]).toBe("no-store");
  });

  await test.step("revogar o link faz com que deixe de funcionar logo", async () => {
    const dialog = page.getByRole("dialog", { name: "Partilhar «relatorio.txt»" });
    await dialog.getByRole("button", { name: /^Revogar o link 1/ }).click();
    await expect(dialog.getByText("Ainda não há links ativos.")).toBeVisible();
    await guestPage.reload();
    await expect(guestPage.getByText(NOT_AVAILABLE)).toBeVisible();
  });

  await guest.close();
});

test("um link que nunca existiu mostra o mesmo aviso que um revogado", async ({ page }) => {
  await page.goto("/s/um-token-que-nunca-existiu");
  await expect(page.getByText(NOT_AVAILABLE)).toBeVisible();
});

test("sem permissão para a área de transferência, «Copiar» seleciona o link e explica como o copiar à mão", async ({ page }) => {
  // O browser decide sozinho se deixa copiar (o Chromium sem interface recusa, o Chrome com interface aceita): aqui a recusa é forçada.
  await page.addInitScript(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException("Sem permissão", "NotAllowedError"));
  });
  await signUp(page);
  await upload(page, "nota.txt", "olá");
  await chooseAction(page, "Ações para o ficheiro nota.txt", "Partilhar…");
  const dialog = page.getByRole("dialog", { name: "Partilhar «nota.txt»" });
  await dialog.getByRole("button", { name: "Criar link" }).click();

  await dialog.getByRole("button", { name: "Copiar" }).click();

  await expect(dialog.getByText(/Não foi possível copiar sozinho/)).toBeVisible();
  const field = dialog.getByLabel("Link de partilha");
  await expect(field).toBeFocused();
  expect(await field.evaluate((input: HTMLInputElement) => input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0))).toBe(await field.inputValue());
});
```

Run: `npx playwright test e2e/share.spec.ts`
Expected: `3 passed` (a duração varia).

- [ ] **Step 4: A CSP em vigor num browser real**

O teste de `shell.test.ts` lê o ficheiro `_headers`; este mostra que o browser **a aplica** e que a aplicação corre sem violá-la. O primeiro confere os cabeçalhos das páginas e que a API não leva CSP. O segundo percorre a aplicação inteira (login, pastas, diálogos, a barra de progresso de um envio, a pré-visualização, a lixeira, a conta e a página pública) e exige **zero** violações, contadas pelo evento `securitypolicyviolation` através de navegações completas. O terceiro prova que a CSP não é decorativa: um `<script>` inserido na página não corre e o browser regista a violação. (Ao escrever o plano, tirar `img-src 'self'` da política fez o segundo teste falhar com a violação da imagem da pré-visualização.)

Criar `e2e/csp.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { chooseAction, createFolder, signUp, upload } from "./support";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

/** As violações da CSP que o browser vê na página (o evento `securitypolicyviolation`), mesmo através de navegações completas. */
async function watchViolations(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.exposeFunction("reportViolation", (text: string) => seen.push(text));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { reportViolation: (text: string) => void }).reportViolation(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return seen;
}

test("as páginas levam a CSP, e a API não (as respostas de ficheiros têm a sua)", async ({ request }) => {
  const index = await request.get("/");
  const csp = index.headers()["content-security-policy"];
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(index.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect(index.headers()["referrer-policy"]).toBe("same-origin");

  const health = await request.get("/api/health");
  expect(health.headers()["cache-control"]).toBe("no-store");
  expect(health.headers()["content-security-policy"]).toBeUndefined();
});

test("a aplicação inteira corre sem uma única violação da CSP (login, pastas, diálogos, pré-visualização, lixeira, conta e página pública)", async ({ page, browser }) => {
  const violations = await watchViolations(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();

  await signUp(page);
  await createFolder(page, "Fotos"); // diálogo
  await upload(page, "ponto.png", PNG, "image/png"); // a barra de progresso usa `style`
  await chooseAction(page, "Ações para o ficheiro ponto.png", "Pré-visualizar"); // <img> da própria origem
  await expect(page.getByRole("dialog").getByRole("img")).toBeVisible();
  await page.keyboard.press("Escape");

  await chooseAction(page, "Ações para o ficheiro ponto.png", "Partilhar…");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Criar link" }).click();
  const link = await dialog.getByLabel("Link de partilha").inputValue();
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Lixeira" }).click();
  await expect(page.getByRole("heading", { name: "Lixeira" })).toBeVisible();
  await page.getByRole("link", { name: "Conta" }).click();
  await expect(page).toHaveURL(/\/conta$/);

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  const guestViolations = await watchViolations(guestPage);
  await guestPage.goto(link);
  await expect(guestPage.getByRole("link", { name: "Descarregar" })).toBeVisible();

  expect(violations).toEqual([]);
  expect(guestViolations).toEqual([]);
  await guest.close();
});

test("a CSP está mesmo em vigor: um script inserido na página não corre, e o browser regista a violação", async ({ page }) => {
  const violations = await watchViolations(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();

  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__injetado = true";
    document.head.append(script);
  });

  expect(await page.evaluate(() => (window as unknown as { __injetado?: boolean }).__injetado)).toBeUndefined();
  await expect.poll(() => violations).toEqual([expect.stringMatching(/^script-src/)]);
});
```

Run: `npx playwright test e2e/csp.spec.ts`
Expected: `3 passed` (a duração varia).

- [ ] **Step 5: Verificação e commit**

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npx playwright test`
Expected: `12 passed` (a duração varia). (o teste de fumo da Task 6 e os quatro ficheiros desta tarefa, um servidor construído de novo).

Commit:

```bash
git add e2e
git commit -m "Acrescenta os testes de ponta a ponta de envios, pré-visualização, partilha e CSP" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Testes de ponta a ponta: o painel do administrador, o teclado e o foco, «Sair» com envios e o telemóvel

**Files:**
- Create: `e2e/admin.spec.ts`, `e2e/keyboard.spec.ts`, `e2e/layout.spec.ts`
- Modify: `src/web/components/Breadcrumb.tsx`, `src/web/pages/FolderPage.tsx`, `src/web/pages/AdminPage.tsx`

**Interfaces:**
- Consumes: `signUp`, `sql`, `uniqueEmail`, `createFolder`, `upload`, `chooseAction`, `PASSWORD` (`e2e/support.ts`), `ORIGIN` (`e2e/env.ts`), as acessibilidades das Tasks 4 e 5 e o gatilho do cron do `vite preview` (`/cdn-cgi/handler/scheduled`).
- Produces: os testes de ponta a ponta do painel `/admin` (quota, suspender, reativar, apagar e a manutenção que remove a conta), do teclado e do foco (diálogos, menu «⋮», foco de reserva), de «Sair» com um envio a decorrer e do ecrã de um telemóvel (375 px); e os dois defeitos de disposição que o último encontrou, já corrigidos (o nome enorme de uma pasta, no caminho e no título, e a tabela de contas).

- [ ] **Step 1: O painel do administrador, de ponta a ponta**

Dois contextos de browser, o do administrador e o de uma conta normal, para ver os dois lados de cada ação: uma quota a 0 impede os envios da conta; suspender faz a sessão dela cair e o login dizer porquê; reativar deixa-a entrar; apagar deixa-a «A remover», sem menu e com o email ocupado (`409`); e o gatilho do cron (`/cdn-cgi/handler/scheduled`, que o `vite preview` expõe) remove-a e liberta o email. O administrador é promovido por SQL (`sql`): a interface não cria administradores. O segundo teste confirma que o administrador **não vê os ficheiros de outras contas** (nem na lista nem na pesquisa).

Criar `e2e/admin.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { ORIGIN } from "./env";
import { PASSWORD, signUp, sql, uniqueEmail, upload } from "./support";

test("o painel do administrador: quota, suspender, reativar e apagar contas, e a manutenção que as remove", async ({ browser, request }) => {
  const adminEmail = uniqueEmail("admin");
  const anaEmail = uniqueEmail("ana");
  const adminContext = await browser.newContext();
  const anaContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const ana = await anaContext.newPage();
  await signUp(admin, adminEmail);
  sql(`UPDATE users SET role = 'admin' WHERE email = '${adminEmail}'`);
  await signUp(ana, anaEmail);

  const anaRow = admin.getByRole("row", { name: new RegExp(anaEmail) });
  const anaMenu = admin.getByRole("button", { name: `Ações para a conta ${anaEmail}` });
  const choose = async (action: string) => {
    await anaMenu.click();
    await admin.getByRole("menuitem", { name: action }).click();
  };

  await test.step("só o administrador vê «Admin»; a quem não é, o endereço leva a «Meu espaço»", async () => {
    await admin.reload();
    await admin.getByRole("link", { name: "Admin" }).click();
    await expect(admin.getByRole("heading", { name: "Utilizadores" })).toBeVisible();
    await expect(anaRow).toBeVisible();
    await expect(ana.getByRole("link", { name: "Admin" })).toHaveCount(0);
    await ana.goto("/admin");
    await expect(ana.getByRole("heading", { name: "Meu espaço" })).toBeVisible();
  });

  await test.step("uma quota a 0 impede os envios da conta", async () => {
    await choose("Alterar quota…");
    const dialog = admin.getByRole("dialog", { name: `Quota de ${anaEmail}` });
    await dialog.getByLabel("Quota (GB)").fill("0");
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await expect(admin.getByRole("dialog")).toHaveCount(0);
    await expect(anaRow.getByText(/de 0 B/)).toBeVisible();

    await ana.locator('input[type="file"]').setInputFiles({ name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
    await expect(ana.getByText("Sem espaço suficiente na sua quota.")).toBeVisible();
  });

  await test.step("suspender: a sessão da conta cai e o login diz porquê", async () => {
    await choose("Suspender…");
    await admin.getByRole("dialog", { name: "Suspender conta" }).getByRole("button", { name: "Suspender" }).click();
    await expect(anaRow.getByText("Suspensa")).toBeVisible();

    await ana.reload();
    await expect(ana.getByRole("heading", { name: "Entrar" })).toBeVisible();
    await ana.getByLabel("Email").fill(anaEmail);
    await ana.getByLabel("Senha").fill(PASSWORD);
    await ana.getByRole("button", { name: "Entrar" }).click();
    await expect(ana.getByText("Conta suspensa. Contacte o administrador.")).toBeVisible();
  });

  await test.step("reativar: a conta volta a entrar", async () => {
    await choose("Reativar");
    await expect(anaRow.getByText("Ativa")).toBeVisible();
    await ana.getByRole("button", { name: "Entrar" }).click();
    await expect(ana.getByRole("heading", { name: "Meu espaço" })).toBeVisible();
  });

  await test.step("apagar: a conta fica «A remover», sem menu, e o email continua ocupado", async () => {
    await choose("Apagar conta…");
    await admin.getByRole("dialog", { name: "Apagar conta" }).getByRole("button", { name: "Apagar conta" }).click();
    await expect(anaRow.getByText("A remover")).toBeVisible();
    await expect(anaMenu).toHaveCount(0);

    await ana.reload();
    await expect(ana.getByRole("heading", { name: "Entrar" })).toBeVisible(); // a sessão acabou

    const taken = await request.post("/api/auth/register", { data: { email: anaEmail, password: PASSWORD }, headers: { Origin: ORIGIN } });
    expect(taken.status()).toBe(409);
  });

  await test.step("a manutenção (o gatilho do cron) remove a conta e liberta o email", async () => {
    const cron = await request.get("/cdn-cgi/handler/scheduled?cron=0+*+*+*+*");
    expect(cron.status()).toBe(200);
    await admin.getByRole("button", { name: "Atualizar" }).click();
    await expect(anaRow).toHaveCount(0);

    const again = await request.post("/api/auth/register", { data: { email: anaEmail, password: PASSWORD }, headers: { Origin: ORIGIN } });
    expect(again.status()).toBe(201);
  });

  await adminContext.close();
  await anaContext.close();
});

test("o administrador não vê os ficheiros de outras contas (nem na lista, nem na pesquisa)", async ({ browser, request }) => {
  const adminEmail = uniqueEmail("admin");
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signUp(admin, adminEmail);
  sql(`UPDATE users SET role = 'admin' WHERE email = '${adminEmail}'`);
  const anaContext = await browser.newContext();
  const ana = await anaContext.newPage();
  await signUp(ana);
  await upload(ana, "segredo.txt", "só da ana");

  await admin.goto("/");
  // Primeiro espera-se pela lista (a raiz do administrador está vazia): sem isto, os «0» abaixo passavam durante o «A carregar…».
  await expect(admin.getByRole("heading", { name: "Meu espaço" })).toBeVisible();
  await expect(admin.getByText("Esta pasta está vazia.")).toBeVisible();
  await expect(admin.getByRole("button", { name: "Ações para o ficheiro segredo.txt" })).toHaveCount(0);
  await expect(admin.getByText("segredo.txt")).toHaveCount(0);
  // Nem há rota para o admin ir buscar o ficheiro de outra conta. O controlo: a pesquisa da própria Ana encontra-o.
  const anaSearch = await ana.request.get("/api/search?q=segredo");
  const anaResults = (await anaSearch.json()) as { results: { kind: string; file: { name: string } }[] };
  expect(anaResults.results).toHaveLength(1);
  expect(anaResults.results[0]).toMatchObject({ kind: "file", file: { name: "segredo.txt" } });
  const search = await admin.request.get("/api/search?q=segredo");
  expect(await search.json()).toEqual({ results: [] });
  expect((await request.get("/api/admin/users")).status()).toBe(401); // sem sessão

  await adminContext.close();
  await anaContext.close();
});
```

Run: `npx playwright test e2e/admin.spec.ts`
Expected: `2 passed` (a duração varia).

- [ ] **Step 2: O teclado, o foco e «Sair» com um envio a decorrer**

Fecha o que a Task 4 e a Task 5 deixaram feito, agora num browser real: o diálogo bloqueia a rolagem e o Esc devolve o foco ao botão; o menu «⋮» abre com a seta para baixo e salta com Home e End; a confirmação de «Excluir» descreve a pergunta e, **depois de excluir, o foco vai para o conteúdo da página** (o botão da linha já não existe); «Sair» com um envio a decorrer (o pedido fica por responder) pergunta antes, e «Cancelar» mantém a sessão; um ficheiro largado sobre um diálogo aberto não é enviado.

Criar `e2e/keyboard.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { chooseAction, createFolder, signUp, upload } from "./support";

test("um diálogo: a página não rola por baixo, o Esc fecha e o foco volta ao botão que o abriu", async ({ page }) => {
  await signUp(page);
  const open = page.getByRole("button", { name: "Nova pasta" });

  await open.click();
  await expect(page.getByRole("dialog", { name: "Nova pasta" })).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(open).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("o menu «⋮» abre com a seta para baixo, salta com Home e End, e o Esc devolve o foco ao botão", async ({ page }) => {
  await signUp(page);
  await upload(page, "nota.txt", "olá");
  const button = page.getByRole("button", { name: "Ações para o ficheiro nota.txt" });

  await button.focus();
  await page.keyboard.press("ArrowDown");
  const items = page.getByRole("menuitem");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(items.last()).toBeFocused();
  await expect(items.last()).toHaveText("Excluir");
  await page.keyboard.press("Home");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("a confirmação de «Excluir» descreve a pergunta, e depois de excluir o foco vai para o conteúdo (o botão da linha desapareceu)", async ({ page }) => {
  await signUp(page);
  await upload(page, "nota.txt", "olá");

  await chooseAction(page, "Ações para o ficheiro nota.txt", "Excluir");

  const dialog = page.getByRole("dialog", { name: "Excluir ficheiro" });
  await expect(dialog).toHaveAccessibleDescription("Excluir o ficheiro «nota.txt»? Vai para a lixeira.");
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused(); // a ação segura
  await dialog.getByRole("button", { name: "Excluir" }).click();

  await expect(page.getByRole("button", { name: "Ações para o ficheiro nota.txt" })).toHaveCount(0);
  await expect(page.getByRole("main")).toBeFocused();
});

test("«Sair» com um envio a decorrer pergunta antes: «Cancelar» mantém a sessão, «Sair» termina-a", async ({ page }) => {
  await signUp(page);
  // O envio fica a meio: o pedido nunca recebe resposta.
  await page.route("**/api/files?*", () => new Promise(() => undefined));
  await page.locator('input[type="file"]').setInputFiles({ name: "grande.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(1024 * 1024) });
  await expect(page.getByRole("button", { name: "Cancelar o envio de grande.bin" })).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  const dialog = page.getByRole("dialog", { name: "Sair com envios em curso" });
  await expect(dialog).toHaveAccessibleDescription(/Há envios por terminar/);
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Meu espaço" })).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  await page.getByRole("dialog", { name: "Sair com envios em curso" }).getByRole("button", { name: "Sair" }).click();
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
});

test("um ficheiro largado sobre um diálogo aberto não é enviado", async ({ page }) => {
  await signUp(page);
  // Conta os envios (`PUT /api/files?...`) desde já: uma negativa logo a seguir ao largar podia passar antes de o envio começar.
  let uploads = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/api/files?")) uploads++;
  });
  await page.getByRole("button", { name: "Nova pasta" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova pasta" });
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["largado"], "largado.txt", { type: "text/plain" }));
    return transfer;
  });

  await dialog.dispatchEvent("dragenter", { dataTransfer });
  await dialog.dispatchEvent("drop", { dataTransfer });
  await dialog.getByRole("button", { name: "Cancelar" }).click(); // no diálogo: «Cancelar o envio de…» também casaria, se o envio começasse

  // Uma ida completa ao servidor dá tempo a uma guarda avariada de começar o envio; só depois se verifica que não houve nenhum.
  await createFolder(page, "Fotos"); // a aplicação continua a responder
  expect(uploads).toBe(0);
  await expect(page.getByRole("button", { name: "Ações para o ficheiro largado.txt" })).toHaveCount(0);
});
```

Run: `npx playwright test e2e/keyboard.spec.ts`
Expected: `5 passed` (a duração varia).

- [ ] **Step 3: O telemóvel: dois defeitos de disposição (testes primeiro)**

Num ecrã de 375 px a página não pode rolar na horizontal (só os contentores que o dizem). O jsdom não tem disposição, por isso só um browser real vê isto, e viu dois defeitos. **Uma pasta de nome enorme** (sem espaços) alargava a página 957 px, por duas razões: o caminho (`Breadcrumb`) não partia palavras (`break-all`) e o título da pasta, um item de uma linha flexível, não encolhe abaixo da sua palavra mais comprida (`break-words` não chega: `min-w-0`). **A tabela de contas** já estava num contentor com `overflow-x-auto`, mas a página rolava na mesma 270 px: o texto só para leitores de ecrã (`sr-only`, que é `position: absolute`) da última coluna fica posicionado em relação à janela e não ao contentor, que por isso não o corta; o contentor passa a ser `relative`, e o texto fica preso a ele.

Criar `e2e/layout.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { createFolder, signUp, sql, uniqueEmail, upload } from "./support";

// 375 px: o ecrã de um telemóvel pequeno.
test.use({ viewport: { width: 375, height: 812 } });

/** Quantos píxeis a página excede a largura da janela (> 0 = rola na horizontal). */
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("no telemóvel, um nome de pasta enorme e sem espaços não faz a página rolar na horizontal (o caminho parte-se)", async ({ page }) => {
  await signUp(page);
  const name = "P".repeat(90);
  await createFolder(page, name);

  await page.getByRole("link", { name }).click();

  await expect(page.getByRole("heading", { name })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("no telemóvel, um nome de ficheiro enorme e sem espaços não faz a lista rolar na horizontal", async ({ page }) => {
  await signUp(page);
  await upload(page, `${"f".repeat(90)}.txt`, "olá");

  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("no telemóvel, a tabela de contas rola dentro do seu contentor e não a página", async ({ page }) => {
  const email = await signUp(page, uniqueEmail("admin-comprido-".concat("x".repeat(40))));
  sql(`UPDATE users SET role = 'admin' WHERE email = '${email}'`);

  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: "Utilizadores" })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
```

Run: `npx playwright test e2e/layout.spec.ts`
Expected: FAIL (`2 failed`, `1 passed`).

Em `src/web/components/Breadcrumb.tsx`, trocar:

```tsx
      <ol className="flex flex-wrap items-center gap-1 text-sm text-slate-600">
```

por:

```tsx
      <ol className="flex flex-wrap items-center gap-1 text-sm break-all text-slate-600">
```

Em `src/web/pages/FolderPage.tsx`, trocar:

```tsx
        <h1 className="text-2xl font-bold tracking-tight break-words">{folder?.name ?? ROOT_LABEL}</h1>
```

por:

```tsx
        <h1 className="min-w-0 text-2xl font-bold tracking-tight break-words">{folder?.name ?? ROOT_LABEL}</h1>
```

Em `src/web/pages/AdminPage.tsx`, trocar:

```tsx
      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
```

por:

```tsx
      {/* `relative`: o texto `sr-only` da tabela (position: absolute) fica preso a este contentor e não alarga a página. */}
      <div className="relative mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
```

Run: `npx playwright test e2e/layout.spec.ts`
Expected: `3 passed` (a duração varia).

- [ ] **Step 4: Verificação e commit**

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  36 passed (36)`, `Tests  284 passed (284)`.

Run: `npx playwright test`
Expected: `22 passed` (a duração varia). (a suíte inteira: fumo, envios, pré-visualização, partilha, CSP, administração, teclado e telemóvel).

Commit:

```bash
git add src e2e
git commit -m "Acrescenta os testes de ponta a ponta do painel, do teclado e do telemóvel e corrige a disposição" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Documentação, verificação final e índice dos planos

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-10-03-spacework-design.md`, `docs/superpowers/plans/README.md`

**Interfaces:**
- Consumes: tudo o que as Tasks 1 a 8 entregam.
- Produces: o `README.md` com a configuração, os cabeçalhos e os registos, e os testes de ponta a ponta; a especificação com o registo que se fecha, o hash fictício, os testes de ponta a ponta e o que falta confirmar em produção; o índice dos planos com o 5A «Concluído», o que ficou resolvido, o que fica sem plano e o que é do 5B.

- [ ] **Step 1: README**

Em `README.md`, na tabela da secção «Comandos», trocar:

```markdown
| `npm run test:web` | Testes da interface (Vitest em jsdom, com o Testing Library) |
```

por:

```markdown
| `npm run test:web` | Testes da interface (Vitest em jsdom, com o Testing Library) |
| `npm run test:e2e` | Testes de ponta a ponta (Playwright) contra a aplicação construída; ver «Testes de ponta a ponta» |
```

Na secção «Estrutura», trocar:

```markdown
test/          testes do Worker (os da interface ficam ao lado do código, em src/web/**/*.test.{ts,tsx})
```

por:

```markdown
test/          testes do Worker (os da interface ficam ao lado do código, em src/web/**/*.test.{ts,tsx})
e2e/           testes de ponta a ponta (Playwright)
```

Na secção do utilizador master, trocar:

```markdown
Quota do master por defeito: 10 GiB (`MASTER_QUOTA_BYTES` para outro valor).
```

por:

```markdown
Quota do master por defeito: 10 GiB (`MASTER_QUOTA_BYTES` para outro valor). O `--remote` só funciona depois de a D1 de produção existir: o `database_id` do `wrangler.jsonc` é provisório (o deploy é o Plano 5B).
```

Na secção «API», no parágrafo das rotas do administrador, trocar:

```markdown
e o admin não consegue repor a senha de ninguém.
```

por:

```markdown
e o admin não consegue repor a senha de ninguém.

O registo pode fechar-se com a variável `REGISTRATION_OPEN` (ver «Configuração»): fechado, `POST /api/auth/register` responde `403 registration_closed` e quem já tem conta continua a entrar. `GET /api/health` responde `200 { "ok": true }` ou, com a D1 em baixo, `503 { "ok": false }`.
```

No fim da secção «Manutenção», acrescentar o que o cron passou a fazer e as secções «Configuração» e «Testes de ponta a ponta». Trocar:

```markdown
Em produção os erros de cada execução ficam nos registos do Worker (`wrangler tail` ou o painel da Cloudflare).
```

por:

````markdown
Em produção os erros de cada execução ficam nos registos do Worker (`wrangler tail` ou o painel da Cloudflare).

O cron falha à vista: se um passo falhou, o gatilho `scheduled` rejeita, para a execução aparecer como falhada no painel da Cloudflare (a confirmar em produção). Cada execução escreve o relatório numa linha JSON (`{"evento":"manutencao", ...}`) no registo do Worker.

## Configuração

As variáveis estão em `wrangler.jsonc` (`vars`) e são sempre texto:

| Variável | Por defeito | O que faz |
|---|---|---|
| `DEFAULT_QUOTA_BYTES` | `1073741824` (1 GiB) | Quota de uma conta nova |
| `MAX_UPLOAD_BYTES` | `104857600` (100 MiB) | Tamanho máximo de um ficheiro |
| `TRASH_RETENTION_DAYS` | `30` | Dias na lixeira antes de o cron eliminar o ficheiro |
| `SESSION_TTL_DAYS` | `14` | Validade de uma sessão |
| `REGISTRATION_OPEN` | `true` | Só `true` mantém o registo aberto; qualquer outro valor (por exemplo `false`) fecha-o |

**Cabeçalhos e registos.** As páginas da aplicação levam `Content-Security-Policy` (em `public/_headers`: scripts, estilos, ligações e `<iframe>` só da própria origem, sem `unsafe-inline`), `X-Frame-Options` e `Referrer-Policy`; a API leva `Cache-Control: no-store`; as respostas de ficheiros levam a sua própria CSP (`default-src 'none'; sandbox`), exceto a pré-visualização de PDF, que não a pode ter (o leitor do browser deixa de funcionar). O `observability` está ligado **sem os registos de invocação**: o token de um link de partilha vai no caminho do URL e não deve ficar nos registos; o relatório do cron e os erros (`console.log` e `console.error`) continuam a ir para lá.

## Testes de ponta a ponta

Correm num browser real contra a aplicação **construída** (`vite build` e `vite preview`: o Worker no workerd, com os assets estáticos e o `public/_headers` como em produção), com a D1 e o R2 simulados em `.e2e-state` (nunca a `.wrangler` de desenvolvimento), que começam vazios em cada execução. Usam a porta 4180.

```bash
npx playwright install chromium   # só da primeira vez (cerca de 100 MB)
npm run test:e2e
```

`E2E_CHANNEL=chrome npm run test:e2e` usa o Google Chrome instalado em vez do Chromium do Playwright, `npx playwright test --headed` mostra o browser e `npx playwright show-trace test-results/<teste>/trace.zip` abre o registo de um teste que falhou.
````

- [ ] **Step 2: Especificação**

Em `docs/superpowers/specs/2026-10-03-spacework-design.md`, na tabela de variáveis da secção 2, trocar:

```markdown
| `SESSION_TTL_DAYS` | 14 |
```

por:

```markdown
| `SESSION_TTL_DAYS` | 14 |
| `REGISTRATION_OPEN` | true |
```

Na secção 4, «Registo e login», trocar:

```markdown
(a enumeração de emails pelo registo é um compromisso aceite na v1).
```

por:

```markdown
(a enumeração de emails pelo registo é um compromisso aceite na v1). Com `REGISTRATION_OPEN` definida e diferente de `true` (sem a variável o registo fica aberto) o registo está fechado: 403 `registration_closed`, antes de gastar o PBKDF2 da senha; o login não muda.
```

No ponto do login, trocar:

```markdown
é feita na mesma uma verificação de hash "falsa", para não haver diferença de tempo.
```

por:

```markdown
é feita na mesma uma verificação de hash "falsa" (contra uma constante pré-calculada, `DUMMY_PASSWORD_HASH`, com as iterações das senhas verdadeiras), para não haver diferença de tempo.
```

Na secção 10, trocar:

```markdown
- **E2E de fumo** (Playwright): registo, login, criar pasta, carregar, mover, excluir, restaurar.
```

por:

```markdown
- **Ponta a ponta** (Playwright, Chromium, contra a aplicação construída com `vite preview`, D1 e R2 simulados em `.e2e-state`): o fumo (registo, login, criar pasta, carregar, mover, excluir, restaurar), os envios (o `Content-Length` do browser, arrastar e largar, a quota), a pré-visualização, a partilha (copiar, a página pública sem sessão, o descarregamento como anexo, a revogação), a CSP em vigor, o painel do administrador, o teclado e o foco, «Sair» com envios e o ecrã de um telemóvel.
```

Em «Por confirmar em produção», trocar:

```markdown
3. Tamanho dos lotes do cron no plano gratuito (máximo de 50 subpedidos por invocação; o desenho do Plano 4 gasta 32 no pior caso: confirmar em produção que a contagem é a esperada e que o gatilho de hora a hora corre).
```

por:

```markdown
3. Tamanho dos lotes do cron no plano gratuito (máximo de 50 subpedidos por invocação; o desenho do Plano 4 gasta 32 no pior caso: confirmar em produção que a contagem é a esperada e que o gatilho de hora a hora corre).
4. O gatilho do cron devolve a promessa da manutenção (`async scheduled`): confirmar no painel da Cloudflare que uma execução com erro aparece como falhada, e medir o CPU da pior execução (4 páginas de 1000 objetos do R2 e 450 ids) contra os 10 ms do plano gratuito.
5. O `observability` está ligado sem os registos de invocação (o token de um link de partilha vai no caminho do URL): confirmar que os registos mostram o relatório do cron e os erros e que não mostram URLs.
```

- [ ] **Step 3: Índice dos planos**

O índice já tem o 5A como «Escrito, por executar» (veio com o commit deste plano). Passa a «Concluído». O bloco «Plano 5 (deploy)» deixa de ser uma lista de pendentes: regista o que o 5A resolveu, o que fica sem plano e o que é do 5B, que **não se pode fazer sem o dono** (cria recursos na conta da Cloudflare, usa as suas credenciais e mede coisas que só existem em produção).

Em `docs/superpowers/plans/README.md`, na tabela do topo, trocar:

```markdown
| 5A | [Endurecimento e testes de ponta a ponta](2026-10-05-05a-endurecimento-e-testes-e2e.md) | Cabeçalhos de segurança (CSP), registos sem tokens, o cron com falha visível, `REGISTRATION_OPEN`, a passagem de acessibilidade dos diálogos e menus, e a suíte Playwright (fumo, envios, partilha, admin, teclado) contra a aplicação construída | Escrito, por executar |
```

por:

```markdown
| 5A | [Endurecimento e testes de ponta a ponta](2026-10-05-05a-endurecimento-e-testes-e2e.md) | Cabeçalhos de segurança (CSP), registos sem tokens, o cron com falha visível, `REGISTRATION_OPEN`, a passagem de acessibilidade dos diálogos e menus, e a suíte Playwright (fumo, envios, partilha, admin, teclado) contra a aplicação construída | Concluído |
```

Nos pendentes do Plano 2, no ponto do CSP `sandbox`, trocar:

```markdown
confirmar no Plano 5, com o Playwright.
```

por:

```markdown
confirmar no Plano 5, com o Playwright (feito no Plano 5A).
```

Nos pendentes do Plano 2B, no ponto do Playwright, trocar:

```markdown
confirmar também o arrastar-e-largar e o envio com `Content-Length` num browser real.
```

por:

```markdown
confirmar também o arrastar-e-largar e o envio com `Content-Length` num browser real (o arrastar-e-largar e o `Content-Length` ficaram feitos no Plano 5A; o leitor de PDF no Chrome com interface ficou sem plano: ver «Fica sem plano (5A)» no bloco do Plano 5).
```

O bloco «Plano 5 (deploy)» e a decisão do dono sobre o registo passam a registar o que se resolveu, o que fica e o que é do 5B. Trocar:

```markdown
**Plano 5 (deploy)**
- Medir o CPU do PBKDF2 no plano gratuito (10 ms): login, registo e troca de senha (esta faz 2 PBKDF2); trocar `getDummyHash` por uma constante pré-calculada; ativar `observability`.
- `/api/health` com `try/catch`; `Cache-Control: no-store` e CSP nas respostas da API/SPA; no seed, a dica de migrações escolhida pelo destino (`db:migrate:remote` com `--remote`).
- README: os comandos `--remote` só funcionam depois de criar a D1 de produção (o `database_id` do `wrangler.jsonc` é provisório).
- Novo (revisão final do 2A): confirmar se o limite de 100 MB do corpo na Cloudflare é decimal ou binário face a `MAX_UPLOAD_BYTES = 104857600`.
- Novo: medir na D1 de produção o efeito de uma consulta longa (cada base processa uma consulta de cada vez).
- Novo: confirmar com o Playwright o CSP `sandbox` do descarregamento (já aplicado no Plano 3A: ver Plano 2).
- Novo (revisão final do 2B), passagem de acessibilidade e de browser real (Playwright): as cargas que não passam pelo `apiFetch` (a imagem e o `<iframe>` da pré-visualização, a ligação «Descarregar») não passam pelo tratamento do 401: com a sessão expirada ou um ficheiro apagado mostram um erro genérico ou o JSON; `Modal` sem alternativa quando o botão de origem desaparece (depois de mover ou excluir o foco cai para `<body>`) e sem bloqueio do scroll nem `inert`; `ConfirmDialog` sem `aria-describedby`; `NameDialog` com o erro local a persistir e sem testes de Esc/Enter; `RowMenu` sem Home/End nem abrir com ArrowDown e a rebentar com `actions` vazio; `Breadcrumb` sem `break-all` (rolagem horizontal no telemóvel); botão `danger` com o anel de foco índigo; «A carregar…» sem `role="status"` e a lista pisca ao mudar de pasta; `PreviewDialog` deixa o Tab sair do `<iframe>`.
- Novo: zona de largar — texto largado num diálogo é engolido e um ficheiro largado sobre um diálogo é enviado; faltam testes do contador e do realce; sem limite de tamanho (`Infinity`) enquanto `GET /api/config` não chega (o servidor impõe-no na mesma); verificar o arrastar-e-largar e o envio com `Content-Length` num browser real.
- Novo (manutenção dos testes): `test:watch` só vigia o Worker; `mockApi` casa a primeira rota; `errorMessage` mostra o texto de qualquer `Error`; `UploadManager` sem proteção se o `upload` injetado lançar em modo síncrono, e o `onSettled` recebe o estado «uploading» num cancelamento; `isFileBody` fraco; o teste do ciclo em `tree.test.ts` não alcança a guarda `seen`; o teste «sem tentar de novo» só passa porque o cliente de teste não repete (usar `createQueryClient()`); o teste ligado à classe `bg-indigo-50`; `pathname.startsWith("/pasta/")` repetido no layout.
- Novo (3B), browser real com o Playwright: o botão «Copiar» do diálogo «Partilhar…» (a área de transferência precisa de permissão; no painel do Claude foi negada e o texto ficou selecionado); descarregar pelo link público sem sessão (`Content-Disposition: attachment`); abrir `/s/<token>` pelo fallback de SPA do Worker; «Sair» com um envio grande a decorrer; o `Esc` e o foco nos diálogos novos (partilha, esvaziar a lixeira, sair com envios).
- Novo (4), browser real com o Playwright: o painel `/admin` (alterar a quota, suspender e reativar, apagar uma conta); a conta suspensa perde a sessão e o login dá erro; a quota 0 impede um envio; a conta apagada fica «A remover» e desaparece depois da manutenção. Em produção: confirmar que o gatilho `0 * * * *` corre, que a execução mais pesada cabe nos 50 subpedidos (se não couber, baixar `TRASH_BLOCKS`, `PENDING_BLOCKS` ou `ACCOUNTS_PER_RUN` em `cron.ts` e `account-removal.ts`) e decidir um alerta para quando a execução termina com erro. Medir também o tempo de CPU da pior execução do cron (4 páginas de 1000 objetos do R2 e 450 ids) contra o limite do plano gratuito; confirmar se uma rejeição dentro de `ctx.waitUntil` marca a execução como falhada (se não, `async scheduled` com `await`); registar o relatório de sucesso quando o `observability` estiver ligado.
- Novo (revisão final do 3A): teste de fumo que elimine um ficheiro de vez e confirme que o objeto sai do R2 e que o `meta.changes` do `INSERT … SELECT … WHERE` das partilhas é 1 na D1 real; regras de limite de pedidos da Cloudflare para `/api/public/*` e para o registo (as pesquisas e as listagens gastam linhas lidas da D1; os ficheiros de 0 bytes não gastam quota); os tokens das partilhas vão no caminho do URL e por isso entram nos registos do `observability` (decidir se se desliga o registo desses pedidos); confirmar com o Playwright o CSP do descarregamento.

**Decisão do dono (spec)**
- O registo é aberto e cada conta traz 1 GiB de R2 e um PBKDF2: não há limite de ritmo. Opções: regra de *rate limiting* da Cloudflare em `/api/auth/*` ou uma variável para fechar o registo.
```

por:

```markdown
**Plano 5 (endurecimento, testes de ponta a ponta e deploy): o endurecimento e os testes ficaram no Plano 5A; o deploy é o Plano 5B**
- Resolvido no 5A (Worker): o hash fictício do login é uma constante (`DUMMY_PASSWORD_HASH`: o primeiro login falhado de cada arranque deixou de pagar dois PBKDF2); `GET /api/health` responde `503 { ok: false }` e regista o erro quando a D1 falha; a dica do `seed:master` segue o destino (`migrateCommand`); a variável `REGISTRATION_OPEN` (só `true` mantém o registo aberto; fechado, `POST /api/auth/register` dá `403 registration_closed` antes do PBKDF2); o gatilho `scheduled` devolve a promessa da manutenção (rejeita se um passo falhou: a execução fica marcada como falhada), o relatório do cron vai para o registo numa linha JSON e `purgeInBlocks` conta bloco a bloco.
- Resolvido no 5A (cabeçalhos e registos): `Content-Security-Policy` nas páginas da aplicação (`public/_headers`: scripts, estilos, ligações e `<iframe>` só da própria origem, sem `unsafe-inline`; a API não leva CSP; as respostas de ficheiros têm a sua (`default-src 'none'; sandbox`), exceto a pré-visualização de PDF, que não a pode ter); `observability` ligado sem os registos de invocação, porque o token de um link de partilha vai no caminho do URL (o relatório do cron e os erros, que são `console.log` e `console.error`, continuam a ir para o registo).
- Resolvido no 5A (acessibilidade): o `Modal` tem `aria-describedby`, bloqueia a rolagem da página e, se o botão que o abriu desapareceu, devolve o foco ao `<main>`; o `ConfirmDialog` descreve a pergunta; o erro de validação do `NameDialog` desaparece ao escrever (e há testes de Enter); a zona de largar ignora o que cai num diálogo; o `RowMenu` abre com a seta para baixo, salta com Home e End e não desenha nada sem ações; o botão de perigo tem o anel de foco vermelho; «A carregar…» é uma região de estado (`Loading`); o título e o caminho de uma pasta de nome enorme partem-se no telemóvel e a tabela de contas já não alarga a página.
- Resolvido no 5A (browser real, `npm run test:e2e`): o teste de fumo da especificação (registo, login, pasta, envio, mover, excluir, restaurar); o `Content-Length` do envio e o arrastar-e-largar; a pré-visualização (a imagem com `default-src 'none'; sandbox`, o PDF sem CSP e com `Range`); a partilha (copiar com e sem permissão da área de transferência, a página pública sem sessão pelo fallback de SPA do Worker, o descarregamento sempre como anexo isolado, a revogação); a CSP em vigor, sem violações e a bloquear um script injetado; o painel `/admin` (a quota 0 impede os envios, suspender e reativar, apagar, e a manutenção que remove a conta e liberta o email); «Sair» com um envio a decorrer; o teclado e o foco dos diálogos e do menu; o ecrã de um telemóvel (375 px).
- Fica sem plano (5A): a pré-visualização de um PDF no Chrome com interface (o leitor fica com o foco depois de carregar e o Esc não fecha o diálogo: não se vê sem interface, por isso os testes não o apanham); as cargas que não passam pelo `apiFetch` (a imagem e a `<iframe>` da pré-visualização, a ligação «Descarregar») não passam pelo tratamento do 401: com a sessão expirada ou um ficheiro apagado mostram um erro genérico ou o JSON; o resto da página não fica `inert` enquanto há um diálogo; o `PreviewDialog` deixa o Tab sair da `<iframe>`; a lista pisca ao mudar de pasta; faltam testes do contador e do realce da zona de largar, e há um limite de tamanho `Infinity` enquanto `GET /api/config` não chega (o servidor impõe-no na mesma); o relatório do cron não distingue as falhas do R2 (o `purgeFiles` só as regista).
- Fica sem plano (manutenção dos testes): `test:watch` só vigia o Worker; `mockApi` casa a primeira rota; `errorMessage` mostra o texto de qualquer `Error`; `UploadManager` sem proteção se o `upload` injetado lançar em modo síncrono, e o `onSettled` recebe o estado «uploading» num cancelamento; `isFileBody` fraco; o teste do ciclo em `tree.test.ts` não alcança a guarda `seen`; o teste «sem tentar de novo» só passa porque o cliente de teste não repete (usar `createQueryClient()`); o teste ligado à classe `bg-indigo-50`; `pathname.startsWith("/pasta/")` repetido no layout.
- Plano 5B (deploy), por fazer com o dono (cada passo toca na conta da Cloudflare ou nas credenciais, por isso nenhum se executa sem ele): criar a D1 e o bucket R2 de produção e pôr os IDs no `wrangler.jsonc` (o `database_id` é provisório: os comandos `--remote` do README só funcionam depois disto), `wrangler d1 migrations apply --remote`, `seed:master --remote` e `wrangler deploy`; medir o CPU do PBKDF2 no plano gratuito (10 ms) no login, no registo e na troca de senha (esta faz 2 PBKDF2) e o da pior execução do cron (4 páginas de 1000 objetos do R2 e 450 ids), e confirmar que cabe nos 50 subpedidos (se não, baixar `TRASH_BLOCKS`, `PENDING_BLOCKS` ou `ACCOUNTS_PER_RUN`); confirmar que o gatilho `0 * * * *` corre, que uma execução com erro aparece como falhada no painel (o `scheduled` já devolve a promessa) e decidir um alerta; confirmar se o limite de 100 MB do corpo na Cloudflare é decimal ou binário face a `MAX_UPLOAD_BYTES = 104857600`; medir na D1 de produção o efeito de uma consulta longa (cada base processa uma consulta de cada vez); um teste de fumo em produção que elimine um ficheiro de vez e confirme que o objeto sai do R2 e que o `meta.changes` do `INSERT … SELECT … WHERE` das partilhas é 1 na D1 real; confirmar na Cloudflare os cabeçalhos do `_headers` (a CSP) e que os registos mostram o relatório do cron e os erros e não mostram URLs; regras de limite de pedidos da Cloudflare para `/api/auth/*` (registo e login) e `/api/public/*` (as pesquisas e as listagens gastam linhas lidas da D1; os ficheiros de 0 bytes não gastam quota); decidir se se fecha o registo (`REGISTRATION_OPEN=false`) depois de criar as contas.

**Decisão do dono (spec)**
- O registo é aberto e cada conta traz 1 GiB de R2 e um PBKDF2: não há limite de ritmo. Resolvido em parte no 5A: a variável `REGISTRATION_OPEN` fecha o registo. A regra de *rate limiting* da Cloudflare em `/api/auth/*` fica para o 5B.
```

- [ ] **Step 4: Verificação manual**

Os testes de ponta a ponta cobrem quase tudo. Falta o que só uma pessoa vê, numa máquina com Chrome:

1. `npm run test:e2e` tem de passar duas vezes seguidas (cada execução reconstrói a aplicação e recomeça com a base vazia). Uma vez com `npx playwright test --headed`, para ver os ecrãs a mexer.
2. **O PDF no Chrome com interface:** `npm run dev`, registar uma conta fictícia numa base local limpa, carregar um PDF, «Pré-visualizar», esperar que o leitor carregue e carregar em Esc. É o pendente que continua sem plano (o leitor fica com o foco e o Esc não fecha o diálogo): confirmar que o botão «Fechar» e o clique no fundo funcionam.
3. **O registo fechado:** criar `.dev.vars` com `REGISTRATION_OPEN=false`, reiniciar o `npm run dev`, tentar criar uma conta pela interface: aparece «O registo está fechado. Peça uma conta ao administrador.» e quem já tem conta continua a entrar. Apagar o `.dev.vars` no fim.
4. Apagar `.wrangler`, `.e2e-state` e `test-results` no fim (estão no `.gitignore`).

- [ ] **Step 5: Verificação final e commit**

Run: `npx vitest run`
Expected: `Test Files  37 passed (37)`, `Tests  327 passed (327)`.

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  36 passed (36)`, `Tests  284 passed (284)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npm run build`
Expected: `✓ built in ...` duas vezes (Worker e cliente).

Run: `npx playwright test`
Expected: `22 passed` (a duração varia).

Commit:

```bash
git add README.md docs
git commit -m "Documenta o endurecimento, a configuração e os testes de ponta a ponta e fecha o Plano 5A" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Auto-revisão do plano contra a especificação e o índice

| Requisito | Onde |
|---|---|
| Índice, Plano 5: trocar `getDummyHash` por uma constante pré-calculada (a medição do CPU do PBKDF2 é do 5B) | Task 1 |
| Índice, Plano 5: `/api/health` com `try/catch`; a dica do seed escolhida pelo destino; o README sobre os comandos `--remote` | Tasks 1 e 9 |
| Índice, Plano 5: ativar `observability` (e a decisão sobre os tokens no caminho do URL) | Task 3 |
| Índice, Plano 5: CSP nas respostas da API/SPA (a API fica sem, e porquê) | Tasks 3 e 7 |
| Índice, Plano 4: o `scheduled` que falha à vista, o relatório no registo, as contagens do relatório | Task 2 |
| Decisão do dono (spec): o registo aberto, com uma variável para o fechar | Task 1 |
| Spec §10: o teste de fumo (registo, login, criar pasta, carregar, mover, excluir, restaurar) | Task 6 |
| Índice (2A, 3A): o CSP `sandbox` do descarregamento, autenticado e público, num browser real | Tasks 7 |
| Índice (2B): `Modal` com foco de reserva, rolagem e `aria-describedby`; `NameDialog`; `RowMenu`; botão de perigo; «A carregar…»; `Breadcrumb` | Tasks 4, 5 e 8 |
| Índice: a zona de largar sobre um diálogo; o arrastar-e-largar e o envio com `Content-Length` num browser real | Tasks 4, 7 e 8 |
| Índice (3B): «Copiar» (com e sem permissão), o descarregamento sem sessão, o fallback de SPA, «Sair» com envios, o Esc e o foco | Tasks 7 e 8 |
| Índice (4): o painel `/admin` num browser real; a manutenção que remove a conta | Task 8 |
| Índice (2B, 4): a tabela de contas e o nome enorme de uma pasta no telemóvel | Task 8 |

**Fora deste plano (Plano 5B, só com o dono):** criar a D1 e o R2 de produção, `wrangler deploy`, o master em produção, as medições na Cloudflare (CPU do PBKDF2 e do cron, a contagem real de subpedidos, o limite de 100 MB do corpo, uma consulta longa na D1), os alertas, as regras de limite de pedidos e o teste de fumo em produção. Ficam sem plano (e registados no índice): o PDF no Chrome com interface, as cargas fora do `apiFetch` com a sessão expirada, o `inert` por baixo dos diálogos, o Tab que sai da `<iframe>` da pré-visualização, a lista que pisca ao mudar de pasta e os pendentes de manutenção dos testes.

**Totais de testes (medidos na execução deste plano numa pasta limpa):** Worker: Test Files 37 passed (37); Tests 327 passed (327). Interface: Test Files 36 passed (36); Tests 284 passed (284). Ponta a ponta: 22 testes do Playwright.

## Notas da execução

- **Decisões que a especificação deixa em aberto:** o Plano 5 do índice juntava o que se faz sem a Cloudflare e o deploy; **dividiu-se em 5A (este) e 5B**, porque o deploy cria recursos na conta do dono, usa as suas credenciais e mede coisas que só existem em produção: não se pode executar nem validar por replay. A decisão do dono sobre o registo (a especificação oferece uma regra de limite de pedidos ou uma variável para o fechar) fez-se pela variável, `REGISTRATION_OPEN`, que não muda nada por defeito; a regra de limite de pedidos fica para o 5B. **Só `true` mantém o registo aberto**: um erro de escrita fecha-o em vez de o deixar aberto sem ninguém dar por isso. O `scheduled` devolve a promessa em vez de a entregar ao `waitUntil`, porque não se sabe se a Cloudflare marca como falhada uma execução em que só o `waitUntil` rejeitou. O `observability` fica ligado sem os registos de invocação, porque são eles que trazem o URL (e o token de um link de partilha vai no caminho).
- **A CSP é mais estrita do que o previsto:** a primeira versão permitia os atributos `style` (`style-src-attr 'unsafe-inline'`) por causa das barras de progresso. Ao tirá-lo para ver o que partia, nada partiu: o React escreve os estilos pelo CSSOM, que a CSP não bloqueia. A política final não tem `unsafe-inline` em lado nenhum. O teste do percurso inteiro foi posto à prova: tirar `img-src 'self'` fez-lhe falhar com a violação da imagem da pré-visualização.
- **Defeitos que os testes de ponta a ponta encontraram, já corrigidos neste plano:** a tabela de contas fazia a página rolar 270 px no telemóvel, apesar de estar num contentor com `overflow-x-auto` (o texto só para leitores de ecrã, que é `position: absolute`, ficava posicionado em relação à janela e não ao contentor); um nome de pasta enorme alargava a página 957 px (o caminho não partia palavras e o título, um item flexível, não encolhia: `break-all` e `min-w-0`). Dois defeitos de teste, ambos corrigidos: o teste de fumo preenchia o email no formulário de login, que ainda estava no ecrã, antes de a página de registo aparecer (passou a esperar pelo título); e o teste da pesquisa, que procura «a» região de estado, apanhava o «A carregar…» do layout (passou a esperar pela sessão).
- **Correções que as revisões acrescentaram à primeira versão do código** (e que este plano já traz): a guarda do largar sobre um diálogo olhava ao alvo do evento e falhava no fundo escurecido, que cobre o ecrã todo (passou a ver se há um diálogo aberto, `dialogOpen()`); o teste de «Copiar» sem permissão confiava no que o browser faz por omissão (passou a forçar a recusa da área de transferência); dois testes de ponta a ponta afirmavam menos do que diziam (o do largar sobre um diálogo passou a contar os pedidos `PUT /api/files`, e o da lista do administrador espera pela lista e tem um controlo positivo); a CSP perdeu o `data:` do `img-src` e o teste fixa o conjunto de diretivas; o teste do hash fictício confere o tamanho do salt e do hash (uma constante malformada saltaria o PBKDF2 em silêncio); o `sql()` dos testes mostra o erro do `wrangler` e tem um limite de tempo; o `webServer` apaga o estado, constrói, migra e só então serve (o `wrangler` segue o ficheiro de redirecionamento até ao `dist/`, que a construção recria: com o `dist/` apagado, migrar primeiro falhava); e a documentação diz que as respostas de ficheiros levam a sua CSP exceto a pré-visualização de PDF, e que o cron falhado no painel está por confirmar em produção.
- **O que os testes de ponta a ponta não veem:** o leitor de PDF do Chrome com interface (apropria-se do foco e o Esc deixa de fechar o diálogo) e tudo o que só existe em produção. Estão no índice dos planos.
- **Verificação manual:** feita durante a escrita deste plano. A suíte do Playwright correu várias vezes seguidas sem falhas, e confirmou-se à mão que um `.dev.vars` com `REGISTRATION_OPEN=false` fecha o registo (`403 registration_closed`) sem tocar no resto. O PDF no Chrome com interface fica para quem executar o plano (Task 9).
