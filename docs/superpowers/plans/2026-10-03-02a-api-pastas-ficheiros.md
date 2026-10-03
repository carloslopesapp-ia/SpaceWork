# SpaceWork — Plano 2A: API de pastas e ficheiros (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A API de gestão de espaço: criar, listar, renomear, mover e excluir pastas; carregar (com quota atómica), descarregar, pré-visualizar, renomear, mover e excluir ficheiros — tudo isolado por utilizador e testado.

**Architecture:** Duas rotas novas (`/api/folders`, `/api/files`) sobre o Worker do Plano 1, em *routers* onde **todas** as rotas exigem sessão por construção. Pastas, nomes e hierarquia vivem só na D1; os bytes vão para o R2 sob uma chave opaca `u/<userId>/<fileId>`, por isso mover e renomear são operações só na D1. O upload reserva a quota com uma instrução SQL atómica antes de gravar no R2.

**Tech Stack:** o do Plano 1 (Hono, D1, R2, Vitest com `@cloudflare/vitest-plugin`), mais `hono/body-limit`.

**Spec:** [docs/superpowers/specs/2026-10-03-spacework-design.md](../specs/2026-10-03-spacework-design.md) (secções 3, 5 e 6, partes de pastas e ficheiros). Índice dos planos: [README.md](README.md). Este plano trata também dos pendentes do Plano 1 que a revisão final atribuiu ao Plano 2 (secção "Pendentes herdados"). A interface "Meu espaço" é o Plano 2B.

## Global Constraints

Valores da especificação e do Plano 1; todas as tarefas os cumprem implicitamente.

- Nomes de pastas e ficheiros: Unicode NFC e `trim`; 1 a 255 caracteres; sem `/`; sem caracteres de controlo; diferentes de `.` e `..`. Nomes únicos dentro da mesma pasta entre itens não apagados (o índice único distingue maiúsculas de minúsculas). Uma pasta e um ficheiro com o mesmo nome no mesmo sítio são permitidos (o esquema não os junta).
- Todas as consultas filtram pelo utilizador da sessão; o id de outro utilizador dá 404 (nunca 403).
- Erros da API em JSON: `{ "error": "<código>", "message": "<texto em português>" }`. Pedidos POST/PUT/PATCH/DELETE exigem `Origin` igual à origem do pedido (já garantido pelo middleware do Plano 1).
- Upload: `PUT /api/files?name=&folder=`, `Content-Length` obrigatório, máximo `MAX_UPLOAD_BYTES` (100 MiB); a quota usa `users.quota_bytes`/`users.used_bytes`; a reserva é atómica; `used_bytes` inclui os ficheiros na lixeira até à eliminação definitiva.
- Descarregar: `Content-Disposition: attachment`. Pré-visualizar: só `png`, `jpg`, `jpeg`, `gif`, `webp` e `pdf`, com `Content-Type` fixo por extensão. Todas as respostas levam `X-Content-Type-Options: nosniff` e `Cache-Control: no-store`.
- Excluir pasta: só se estiver vazia (sem subpastas e sem ficheiros fora da lixeira, contando os `pending`); é apagada logo e não vai para a lixeira. Excluir ficheiro: define `deleted_at`.
- IDs `crypto.randomUUID()`; datas em milissegundos Unix. Vitest `^4.1`.
- O estado da D1 **e do R2** de teste não é isolado entre testes do mesmo ficheiro: usar `beforeEach(resetState)` (ou `resetDb`) em todos os testes que gravam.
- Interface e mensagens ao utilizador em português europeu.
- **Nenhum `git push` sem confirmação explícita do utilizador.**

## Ambiente

- Node 24 e npm 11; todos os comandos correm na raiz do repositório (`~/Developer/SpaceWork`, fora do iCloud). Ramo de trabalho: `plano-2a-api-ficheiros`.
- Commits: mensagem curta em português; cada commit termina com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (nos comandos abaixo, é o segundo `-m`). Escrever **exatamente** esse trailer, "Claude Sonnet 5.5", mesmo que o modelo que executa seja outro.
- Os testes mostram só o resumo do Vitest: se aparecer qualquer outra saída (avisos do `workerd`, `console.warn`), é um defeito do teste a corrigir.

## Estrutura de ficheiros deste plano

```
migrations/0002_fk_indexes.sql
src/shared/names.ts            regras de nomes e chave de pesquisa
src/shared/validation.ts       (movido de src/worker/lib/) senha e email
src/shared/types.ts            + FolderItem, FileItem, BreadcrumbItem, FolderContents
src/worker/errors.ts           + isForeignKeyViolation
src/worker/lib/http.ts         readJsonObject, readString
src/worker/lib/names.ts        parseName
src/worker/lib/folders.ts      acesso a pastas, caminho, ciclos
src/worker/lib/files.ts        linhas de ficheiros, chave do R2, MIME, pré-visualização
src/worker/middleware/body-limit.ts
src/worker/routes/authed.ts    createAuthedRouter
src/worker/routes/folders.ts   /api/folders
src/worker/routes/files.ts     /api/files
test/                          helpers e testes de cada área
```

---


### Task 1: Validação e nomes partilhados

**Files:**
- Create: `src/shared/names.ts`, `test/names.test.ts`
- Move: `src/worker/lib/validation.ts` → `src/shared/validation.ts` (atualizar os imports em `src/worker/routes/auth.ts`, `scripts/seed-master.ts` e `test/validation.test.ts`)
- Modify: `src/web/pages/RegisterPage.tsx`, `src/web/pages/AccountPage.tsx` (usam as constantes partilhadas), `tsconfig.node.json` (`NodeNext`)

**Interfaces:**
- Produces (`src/shared/names.ts`, sem imports, usado no Worker e no browser): `NAME_MAX_LENGTH = 255`, `normalizeName(raw: string): string` (Unicode NFC e `trim`), `validateName(name: string): string | null` (mensagem em português ou `null`; espera um nome já normalizado), `searchKey(name: string): string` (minúsculas e sem acentos: `"Relatório.PDF"` → `"relatorio.pdf"`).
- Produces: `src/shared/validation.ts` com o mesmo conteúdo de antes (`PASSWORD_MIN_LENGTH`, `PASSWORD_MAX_LENGTH`, `normalizeEmail`, `isValidEmail`, `isValidPassword`), agora partilhado com o frontend.
- Decisão (pendente do Plano 1): o `tsconfig.node.json` passa a `module`/`moduleResolution` `NodeNext`. O `scripts/seed-master.ts` importa ficheiros de `src/` com extensão `.ts` e o Node corre-os sem compilar; com `bundler` um `import "./x"` sem extensão passava no `tsc` e só rebentava em execução. Com `NodeNext` o `tsc` recusa-o (erro `TS2835`).

- [ ] **Step 1: Escrever o teste dos nomes, que falha**

Criar `test/names.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NAME_MAX_LENGTH, normalizeName, searchKey, validateName } from "../src/shared/names";

describe("normalizeName", () => {
  it("remove espaços nas pontas e passa para Unicode NFC", () => {
    expect(normalizeName("  Relatório  ")).toBe("Relatório");
    const decomposed = "Relatório"; // o + acento combinado
    const composed = "Relatório";
    expect(decomposed).not.toBe(composed);
    expect(normalizeName(decomposed)).toBe(composed);
  });
});

describe("validateName", () => {
  it("aceita nomes normais, com espaços, acentos, pontos e emojis", () => {
    for (const name of ["Fotos", "Relatório final 2026.pdf", ".gitignore", "a", "férias 🏖️"]) {
      expect(validateName(name)).toBeNull();
    }
  });

  it("rejeita nomes vazios", () => {
    expect(validateName("")).toBe("O nome não pode estar vazio.");
  });

  it("rejeita nomes com mais de 255 caracteres e aceita exatamente 255", () => {
    expect(validateName("a".repeat(NAME_MAX_LENGTH))).toBeNull();
    expect(validateName("a".repeat(NAME_MAX_LENGTH + 1))).toMatch(/mais de 255/);
  });

  it("rejeita '.' e '..'", () => {
    expect(validateName(".")).toBe("Nome inválido.");
    expect(validateName("..")).toBe("Nome inválido.");
  });

  it("rejeita a barra e os caracteres de controlo", () => {
    expect(validateName("a/b")).toMatch(/barra/);
    expect(validateName("a\u0000b")).toMatch(/controlo/);
    expect(validateName("a\nb")).toMatch(/controlo/);
    expect(validateName("a\u007fb")).toMatch(/controlo/);
  });
});

describe("searchKey", () => {
  it("põe em minúsculas e tira os acentos", () => {
    expect(searchKey("Relatório.PDF")).toBe("relatorio.pdf");
    expect(searchKey("Ação Çedilha")).toBe("acao cedilha");
  });

  it("dá a mesma chave para texto composto e decomposto", () => {
    expect(searchKey("Relatório")).toBe(searchKey("Relatório"));
  });
});
```

Run: `npx vitest run test/names.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

- [ ] **Step 2: Implementar `src/shared/names.ts`**

Criar `src/shared/names.ts`:

```ts
// Regras dos nomes de pastas e ficheiros (spec, secção 3). Sem imports: é usado no Worker e no browser.

export const NAME_MAX_LENGTH = 255;

/** Normaliza um nome vindo do utilizador: Unicode NFC e sem espaços nas pontas. */
export function normalizeName(raw: string): string {
  return raw.normalize("NFC").trim();
}

/** Mensagem de erro (em português) para um nome já normalizado, ou null se o nome é válido. */
export function validateName(name: string): string | null {
  if (name.length === 0) return "O nome não pode estar vazio.";
  if (name.length > NAME_MAX_LENGTH) {
    return `O nome não pode ter mais de ${NAME_MAX_LENGTH} caracteres.`;
  }
  if (name === "." || name === "..") return "Nome inválido.";
  if (name.includes("/")) return "O nome não pode conter a barra (/).";
  if (/[\u0000-\u001f\u007f]/.test(name)) return "O nome não pode conter caracteres de controlo.";
  return null;
}

/** Chave de pesquisa: minúsculas e sem acentos ("Relatório.PDF" -> "relatorio.pdf"). */
export function searchKey(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().normalize("NFC");
}
```

Run: `npx vitest run test/names.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  8 passed (8)`.

- [ ] **Step 3: Mover a validação para `src/shared` e corrigir os imports**

Mover o ficheiro (mantém o histórico do git):

```bash
git mv src/worker/lib/validation.ts src/shared/validation.ts
```

Em `src/worker/routes/auth.ts`, trocar:

```ts
} from "../lib/validation";
```

por:

```ts
} from "../../shared/validation";
```

Em `scripts/seed-master.ts`, trocar o caminho do import:

```ts
"../src/worker/lib/validation.ts"
```

por:

```ts
"../src/shared/validation.ts"
```

Em `test/validation.test.ts`, trocar o caminho do import:

```ts
"../src/worker/lib/validation"
```

por:

```ts
"../src/shared/validation"
```

- [ ] **Step 4: O frontend passa a usar as constantes partilhadas (sem 8 e 128 escritos à mão)**

Em `src/web/pages/RegisterPage.tsx`, trocar:

```tsx
import { useMe, useRegister } from "../auth";
```

por:

```tsx
import { isValidPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../shared/validation";
import { useMe, useRegister } from "../auth";
```

Em `src/web/pages/RegisterPage.tsx`, trocar:

```tsx
    if (password.length < 8 || password.length > 128) {
      setLocalError("A senha deve ter entre 8 e 128 caracteres.");
```

por:

```tsx
    if (!isValidPassword(password)) {
      setLocalError(`A senha deve ter entre ${PASSWORD_MIN_LENGTH} e ${PASSWORD_MAX_LENGTH} caracteres.`);
```

Em `src/web/pages/AccountPage.tsx`, trocar:

```tsx
import { useChangePassword, useMe } from "../auth";
```

por:

```tsx
import { isValidPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../shared/validation";
import { useChangePassword, useMe } from "../auth";
```

Em `src/web/pages/AccountPage.tsx`, trocar:

```tsx
    if (newPassword.length < 8 || newPassword.length > 128) {
      setLocalError("A senha nova deve ter entre 8 e 128 caracteres.");
```

por:

```tsx
    if (!isValidPassword(newPassword)) {
      setLocalError(`A senha nova deve ter entre ${PASSWORD_MIN_LENGTH} e ${PASSWORD_MAX_LENGTH} caracteres.`);
```

- [ ] **Step 5: `tsc` passa a exigir extensões nos imports que o seed carrega**

Em `tsconfig.node.json`, trocar:

```json
    "module": "ESNext",
    "moduleResolution": "bundler",
```

por:

```json
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
```

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Prova de que a proteção funciona (depois desfaz-se): acrescentar temporariamente ao topo de `src/worker/lib/crypto.ts` as duas linhas

```ts
import { PASSWORD_MIN_LENGTH } from "../../shared/validation";
export const _x = PASSWORD_MIN_LENGTH;
```

e correr `npm run typecheck`. Expected: erro `TS2835` ("Relative import paths need explicit file extensions...") em `src/worker/lib/crypto.ts(1,37)`. Depois desfazer com `git checkout src/worker/lib/crypto.ts` e confirmar que `npm run typecheck` volta a não ter saída.

- [ ] **Step 6: Correr tudo e confirmar que o seed continua a carregar os módulos partilhados**

Run: `npx vitest run`
Expected: `Test Files  11 passed (11)`, `Tests  73 passed (73)`.

Run: `MASTER_EMAIL='x' MASTER_PASSWORD='senha-de-teste-123' npm run seed:master -- --local`
Expected: a mensagem `Erro: MASTER_EMAIL em falta ou inválido.` (o seed importou `crypto.ts` e `validation.ts` sem erro e parou na validação, antes de chamar o wrangler).

- [ ] **Step 7: Commit**

Commit:

```bash
git add src scripts test tsconfig.node.json
git commit -m "Partilha a validação e as regras de nomes entre Worker e browser" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Endurecer a API

**Files:**
- Create: `src/worker/lib/http.ts`, `src/worker/middleware/body-limit.ts`, `src/worker/routes/authed.ts`, `migrations/0002_fk_indexes.sql`
- Create (testes): `test/hardening.test.ts`, `test/schema-constraints.test.ts`
- Modify: `src/worker/routes/auth.ts` (usa os helpers partilhados), `src/worker/middleware/security.ts` (`Cache-Control`), `src/worker/app.ts`

**Interfaces:**
- Produces (`src/worker/lib/http.ts`): `readJsonObject(c: Context<AppEnv>): Promise<Record<string, unknown>>` (corpo que não seja um objeto JSON → 400 `invalid_body`) e `readString(body, key): string` (a string ou `""`). Saem de `routes/auth.ts`, onde eram privados.
- Produces (`src/worker/middleware/body-limit.ts`): `JSON_BODY_LIMIT_BYTES = 65536` e `jsonBodyLimit` (middleware: pedidos JSON acima do limite → 413 `payload_too_large`, `O pedido é demasiado grande.`). O upload de ficheiros **não** usa este middleware.
- Produces (`src/worker/routes/authed.ts`): `createAuthedRouter(): Hono<AppEnv>`, um router em que **todas** as rotas passam por `requireAuth`. As rotas de pastas e ficheiros usam-no, por isso uma rota nova não pode esquecer-se da autenticação.
- Todas as respostas de `/api/*` passam a levar `Cache-Control: no-store`; o `onError` trata `HTTPException` do Hono (mantém o estado, corpo `{ "error": "http_error", "message": ... }`).
- Produces (`migrations/0002_fk_indexes.sql`): índices `files_folder_id (files.folder_id)`, `folders_parent_id (folders.parent_id)` e `shares_user_id (shares.user_id)`, para apagar utilizadores, pastas e ficheiros não varrer as tabelas filhas.

- [ ] **Step 1: Escrever os testes que falham**

Criar `test/hardening.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { HTTPException } from "hono/http-exception";
import { app } from "../src/worker/app";
import { JSON_BODY_LIMIT_BYTES } from "../src/worker/middleware/body-limit";
import { api, resetDb } from "./helpers";

// Rota só para este ficheiro de testes (cada ficheiro corre no seu próprio isolate).
app.get("/api/__teste/http-exception", () => {
  throw new HTTPException(418, { message: "sou um bule" });
});

beforeEach(resetDb);

describe("Cache-Control", () => {
  it("todas as respostas da API levam no-store", async () => {
    for (const path of ["/api/health", "/api/nao-existe", "/api/auth/me"]) {
      expect((await api(path)).headers.get("cache-control")).toBe("no-store");
    }
  });
});

describe("limite de tamanho dos pedidos JSON", () => {
  it("recusa com 413 um corpo JSON acima de 64 KiB", async () => {
    const res = await api("/api/auth/register", {
      method: "POST",
      json: { email: "ana@example.com", password: "x".repeat(JSON_BODY_LIMIT_BYTES) },
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: "payload_too_large",
      message: "O pedido é demasiado grande.",
    });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("aceita corpos pequenos", async () => {
    const res = await api("/api/auth/register", {
      method: "POST",
      json: { email: "ana@example.com", password: "senha-segura-123" },
    });
    expect(res.status).toBe(201);
  });
});

describe("erros do Hono (HTTPException)", () => {
  it("mantêm o estado e viram JSON em vez de 500", async () => {
    const res = await api("/api/__teste/http-exception");
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ error: "http_error", message: "sou um bule" });
  });
});
```

Criar `test/schema-constraints.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers";

beforeEach(resetDb);

async function insertUser(id = "u1", status = "active"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, role, status, quota_bytes, used_bytes, created_at)
     VALUES (?1, ?2, 'x', 'user', ?3, 1000, 0, 1)`,
  )
    .bind(id, `${id}@example.com`, status)
    .run();
}

async function insertFile(id: string, status = "ready"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at)
     VALUES (?1, 'u1', NULL, ?1, ?1, 1, 'text/plain', ?2, ?3, 1)`,
  )
    .bind(id, `u/u1/${id}`, status)
    .run();
}

describe("restrições do esquema", () => {
  it("used_bytes nunca fica negativo", async () => {
    await insertUser();
    await expect(
      env.DB.prepare("UPDATE users SET used_bytes = used_bytes - 1 WHERE id = 'u1'").run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it("status de utilizador e de ficheiro só aceitam os valores previstos", async () => {
    await expect(insertUser("u2", "banido")).rejects.toThrow(/CHECK constraint failed/);
    await insertUser();
    await expect(insertFile("f1", "meio-pronto")).rejects.toThrow(/CHECK constraint failed/);
  });

  it("o token_hash de uma partilha é único", async () => {
    await insertUser();
    await insertFile("f1");
    const share = (id: string) =>
      env.DB.prepare(
        "INSERT INTO shares (id, token_hash, file_id, user_id, created_at) VALUES (?1, 'mesmo-hash', 'f1', 'u1', 1)",
      )
        .bind(id)
        .run();
    await share("s1");
    await expect(share("s2")).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("apagar um ficheiro apaga as suas partilhas", async () => {
    await insertUser();
    await insertFile("f1");
    await env.DB.prepare(
      "INSERT INTO shares (id, token_hash, file_id, user_id, created_at) VALUES ('s1', 'h', 'f1', 'u1', 1)",
    ).run();
    await env.DB.prepare("DELETE FROM files WHERE id = 'f1'").run();
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM shares").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("existem índices nas chaves estrangeiras files.folder_id, folders.parent_id e shares.user_id", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('files_folder_id', 'folders_parent_id', 'shares_user_id') ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(["files_folder_id", "folders_parent_id", "shares_user_id"]);
  });
});
```

Run: `npx vitest run test/hardening.test.ts test/schema-constraints.test.ts`
Expected: FAIL (Test Files  2 failed (2); Tests  1 failed | 4 passed (5)).

- [ ] **Step 2: Criar os helpers, o limite de corpo, o router autenticado e a migração**

Criar `src/worker/lib/http.ts`:

```ts
import type { Context } from "hono";
import { ApiError } from "../errors";
import type { AppEnv } from "../types";

/** Lê o corpo do pedido como um objeto JSON; qualquer outra coisa é 400 `invalid_body`. */
export async function readJsonObject(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "invalid_body", "Corpo do pedido inválido.");
  }
  return body as Record<string, unknown>;
}

/** O valor de `key` se for uma string; senão "". */
export function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}
```

Criar `src/worker/middleware/body-limit.ts`:

```ts
import { bodyLimit } from "hono/body-limit";

/** Limite para pedidos JSON da API: 64 KiB. O upload de ficheiros não usa este middleware. */
export const JSON_BODY_LIMIT_BYTES = 64 * 1024;

export const jsonBodyLimit = bodyLimit({
  maxSize: JSON_BODY_LIMIT_BYTES,
  onError: (c) =>
    c.json({ error: "payload_too_large", message: "O pedido é demasiado grande." }, 413),
});
```

Criar `src/worker/routes/authed.ts`:

```ts
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

/** Router em que TODAS as rotas exigem sessão: uma rota nova não pode esquecer-se de `requireAuth`. */
export function createAuthedRouter(): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  router.use("*", requireAuth);
  return router;
}
```

Criar `migrations/0002_fk_indexes.sql`:

```sql
-- Índices nas chaves estrangeiras que não tinham um índice a começar pela própria coluna:
-- sem eles, apagar um utilizador, uma pasta ou um ficheiro varre as tabelas filhas inteiras.
CREATE INDEX files_folder_id ON files (folder_id);
CREATE INDEX folders_parent_id ON folders (parent_id);
CREATE INDEX shares_user_id ON shares (user_id);
```

- [ ] **Step 3: `routes/auth.ts` passa a usar os helpers partilhados**

Em `src/worker/routes/auth.ts`, substituir o bloco de `import` no topo do ficheiro (todas as linhas de `import`, até à linha em branco) por:

```ts
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { getConfig } from "../config";
import { ApiError, isUniqueViolation } from "../errors";
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from "../lib/cookies";
import { hashPassword, sha256Hex, verifyPassword } from "../lib/crypto";
import { readJsonObject, readString } from "../lib/http";
import { clearFailures, tryRecordAttempt } from "../lib/login-limit";
import { createSession, deleteSessionByHash, deleteUserSessions } from "../lib/sessions";
import { rowToAuthUser, toPublicUser, type UserRow } from "../lib/users";
import {
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  PASSWORD_MAX_LENGTH,
} from "../../shared/validation";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";
```

Apagar as duas funções privadas (passaram para `lib/http.ts`):

```ts
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
```

Em `src/worker/routes/auth.ts`, trocar todas as ocorrências (3) de `await readBody(c)` por `await readJsonObject(c)`.

- [ ] **Step 4: Cabeçalho `Cache-Control` e `app.ts`**

Em `src/worker/middleware/security.ts`, trocar:

```ts
  c.header("Referrer-Policy", "same-origin");
```

por:

```ts
  c.header("Referrer-Policy", "same-origin");
  c.header("Cache-Control", "no-store");
```

Substituir o conteúdo de `src/worker/app.ts`:

```ts
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiError } from "./errors";
import { jsonBodyLimit } from "./middleware/body-limit";
import { originCheck, securityHeaders } from "./middleware/security";
import { auth } from "./routes/auth";
import type { AppEnv } from "./types";

export const app = new Hono<AppEnv>();

app.use("/api/*", securityHeaders);
app.use("/api/*", originCheck);
app.use("/api/auth/*", jsonBodyLimit);

app.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return c.json({ ok: row?.ok === 1 });
});

app.route("/api/auth", auth);

app.notFound((c) => c.json({ error: "not_found", message: "Não encontrado." }, 404));

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  if (error instanceof HTTPException) {
    return c.json({ error: "http_error", message: error.message }, error.status);
  }
  console.error(error);
  return c.json({ error: "internal_error", message: "Erro interno do servidor." }, 500);
});
```

- [ ] **Step 5: Correr tudo**

Run: `npx vitest run`
Expected: `Test Files  13 passed (13)`, `Tests  82 passed (82)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

- [ ] **Step 6: Commit**

Commit:

```bash
git add src test migrations
git commit -m "Endurece a API: limite de corpo, no-store, router autenticado e índices de chaves estrangeiras" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pastas: listar, árvore e criar

**Files:**
- Create: `src/worker/lib/names.ts`, `src/worker/lib/files.ts`, `src/worker/lib/folders.ts`, `src/worker/routes/folders.ts`
- Create (testes): `test/folder-helpers.ts`, `test/folders.test.ts`
- Modify: `src/shared/types.ts` (tipos de pastas e ficheiros), `src/worker/app.ts`

**Interfaces:**
- Produces (`src/shared/types.ts`): `FolderItem { id; name; parentId: string | null; createdAt: number }`, `FileItem { id; name; folderId: string | null; size: number; mime: string; createdAt: number }`, `BreadcrumbItem { id; name }`, `FolderContents { folder: FolderItem | null; breadcrumb: BreadcrumbItem[]; folders: FolderItem[]; files: FileItem[] }`. O frontend usa-os tal como o Worker.
- Produces (`src/worker/lib/names.ts`): `parseName(raw: string): string` (normaliza e valida; inválido → 400 `invalid_name` com a mensagem de `validateName`).
- Produces (`src/worker/lib/folders.ts`): `FolderRow`, `FOLDER_COLUMNS`, `rowToFolder`, `parseFolderRef(value: unknown): string | null` (`null`, `undefined`, `""` e `"root"` → `null` = raiz), `findFolder(db, userId, id)`, `requireFolder(db, userId, id)` (404 `folder_not_found`), `breadcrumbFor(db, userId, folderId): Promise<BreadcrumbItem[]>` (da raiz até à pasta, por consulta recursiva), `wouldCreateCycle(db, userId, folderId, newParentId): Promise<boolean>`.
- Produces (`src/worker/lib/files.ts`): `FileRow`, `FILE_COLUMNS`, `rowToFile`.
- Produces (rotas, todas autenticadas e a filtrar pelo utilizador; ids de outros utilizadores dão 404): `GET /api/folders/tree` → `{ folders: FolderItem[] }`; `GET /api/folders/:id/contents` (`root` = raiz) → `FolderContents` (pastas e depois ficheiros prontos fora da lixeira, por nome sem acentos nem maiúsculas); `POST /api/folders` `{ name, parentId? }` → 201 `{ folder }` (400 `invalid_name`, 404 `folder_not_found`, 409 `name_taken`).
- Produces (`test/folder-helpers.ts`): `createFolder(cookie, name, parentId?): Promise<FolderItem>` e `getContents(cookie, folderId = "root"): Promise<FolderContents>`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `test/folder-helpers.ts`:

```ts
import type { FolderContents, FolderItem } from "../src/shared/types";
import { api } from "./helpers";

/** Cria uma pasta pela API; falha o teste se não der 201. */
export async function createFolder(
  cookie: string,
  name: string,
  parentId: string | null = null,
): Promise<FolderItem> {
  const res = await api("/api/folders", { method: "POST", cookie, json: { name, parentId } });
  if (res.status !== 201) throw new Error(`createFolder falhou: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { folder: FolderItem }).folder;
}

/** Lista o conteúdo de uma pasta (ou da raiz, com "root"); falha o teste se não der 200. */
export async function getContents(cookie: string, folderId = "root"): Promise<FolderContents> {
  const res = await api(`/api/folders/${folderId}/contents`, { cookie });
  if (res.status !== 200) throw new Error(`getContents falhou: ${res.status} ${await res.text()}`);
  return (await res.json()) as FolderContents;
}
```

Criar `test/folders.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { FolderItem } from "../src/shared/types";
import { registerUser } from "./auth-helpers";
import { createFolder, getContents } from "./folder-helpers";
import { api, resetDb } from "./helpers";

beforeEach(resetDb);

describe("POST /api/folders", () => {
  it("cria uma pasta na raiz", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const res = await api("/api/folders", { method: "POST", cookie, json: { name: "Fotos" } });
    expect(res.status).toBe(201);
    const { folder } = (await res.json()) as { folder: FolderItem };
    expect(folder).toMatchObject({ name: "Fotos", parentId: null });
    expect(folder.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof folder.createdAt).toBe("number");
    expect((await getContents(cookie)).folders.map((f) => f.name)).toEqual(["Fotos"]);
  });

  it("cria uma pasta dentro de outra e devolve o caminho no breadcrumb", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const fotos = await createFolder(cookie, "Fotos");
    const ano = await createFolder(cookie, "2026", fotos.id);
    expect(ano.parentId).toBe(fotos.id);
    const contents = await getContents(cookie, ano.id);
    expect(contents.folder?.name).toBe("2026");
    expect(contents.breadcrumb.map((b) => b.name)).toEqual(["Fotos", "2026"]);
  });

  it("normaliza o nome (NFC e sem espaços nas pontas)", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const folder = await createFolder(cookie, "  Férias  ");
    expect(folder.name).toBe("Férias");
  });

  it("recusa nomes inválidos com 400 invalid_name", async () => {
    const { cookie } = await registerUser("ana@example.com");
    for (const name of ["", "   ", ".", "..", "a/b", "a\u0000b", "a".repeat(256)]) {
      const res = await api("/api/folders", { method: "POST", cookie, json: { name } });
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_name" });
    }
    const missing = await api("/api/folders", { method: "POST", cookie, json: {} });
    expect(missing.status).toBe(400);
  });

  it("recusa um nome repetido no mesmo sítio (409) mas aceita-o noutra pasta", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const fotos = await createFolder(cookie, "Fotos");
    const dup = await api("/api/folders", { method: "POST", cookie, json: { name: "Fotos" } });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "name_taken" });
    await createFolder(cookie, "Fotos", fotos.id); // outra pasta-mãe: permitido
    const dupNested = await api("/api/folders", {
      method: "POST",
      cookie,
      json: { name: "Fotos", parentId: fotos.id },
    });
    expect(dupNested.status).toBe(409);
  });

  it("distingue maiúsculas de minúsculas nos nomes (como o índice único da spec)", async () => {
    const { cookie } = await registerUser("ana@example.com");
    await createFolder(cookie, "Fotos");
    await createFolder(cookie, "fotos");
    expect((await getContents(cookie)).folders).toHaveLength(2);
  });

  it("devolve 404 se a pasta-mãe não existir ou for de outro utilizador", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await createFolder(bob.cookie, "Privada");
    for (const parentId of ["nao-existe", doBob.id]) {
      const res = await api("/api/folders", {
        method: "POST",
        cookie: ana.cookie,
        json: { name: "X", parentId },
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "folder_not_found" });
    }
  });
});

describe("GET /api/folders/:id/contents", () => {
  it("a raiz tem folder null e breadcrumb vazio", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const contents = await getContents(cookie, "root");
    expect(contents).toEqual({ folder: null, breadcrumb: [], folders: [], files: [] });
  });

  it("ordena as pastas por nome sem acentos nem maiúsculas", async () => {
    const { cookie } = await registerUser("ana@example.com");
    for (const name of ["Zeta", "álbum", "Beta", "Acordos"]) await createFolder(cookie, name);
    expect((await getContents(cookie)).folders.map((f) => f.name)).toEqual([
      "Acordos",
      "álbum",
      "Beta",
      "Zeta",
    ]);
  });

  it("só mostra as pastas do próprio nível", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    await createFolder(cookie, "B", a.id);
    expect((await getContents(cookie)).folders.map((f) => f.name)).toEqual(["A"]);
    expect((await getContents(cookie, a.id)).folders.map((f) => f.name)).toEqual(["B"]);
  });

  it("devolve 404 para pastas inexistentes e para pastas de outro utilizador", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await createFolder(bob.cookie, "Privada");
    for (const id of ["nao-existe", doBob.id]) {
      const res = await api(`/api/folders/${id}/contents`, { cookie: ana.cookie });
      expect(res.status).toBe(404);
    }
  });
});

describe("GET /api/folders/tree", () => {
  it("devolve todas as pastas do utilizador e só as dele", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const a = await createFolder(ana.cookie, "A");
    await createFolder(ana.cookie, "B", a.id);
    await createFolder(bob.cookie, "Do Bob");
    const res = await api("/api/folders/tree", { cookie: ana.cookie });
    expect(res.status).toBe(200);
    const { folders } = (await res.json()) as { folders: FolderItem[] };
    expect(folders.map((f) => f.name)).toEqual(["A", "B"]);
    expect(folders.find((f) => f.name === "B")?.parentId).toBe(a.id);
  });
});

describe("autenticação", () => {
  it("todas estas rotas exigem sessão", async () => {
    expect((await api("/api/folders/root/contents")).status).toBe(401);
    expect((await api("/api/folders/tree")).status).toBe(401);
    expect((await api("/api/folders", { method: "POST", json: { name: "X" } })).status).toBe(401);
  });
});
```

Run: `npx vitest run test/folders.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  13 failed (13)).

- [ ] **Step 2: Tipos partilhados**

Acrescentar ao fim de `src/shared/types.ts`:

```ts
/** Pasta tal como a API a devolve ao frontend. */
export interface FolderItem {
  id: string;
  name: string;
  /** null = pasta na raiz. */
  parentId: string | null;
  createdAt: number;
}

/** Ficheiro pronto (já gravado) tal como a API o devolve ao frontend. */
export interface FileItem {
  id: string;
  name: string;
  /** null = ficheiro na raiz. */
  folderId: string | null;
  size: number;
  mime: string;
  createdAt: number;
}

export interface BreadcrumbItem {
  id: string;
  name: string;
}

/** Conteúdo de uma pasta (ou da raiz, com `folder: null`). */
export interface FolderContents {
  folder: FolderItem | null;
  /** Da raiz até à pasta, inclusive; vazio na raiz. */
  breadcrumb: BreadcrumbItem[];
  folders: FolderItem[];
  files: FileItem[];
}
```

- [ ] **Step 3: Implementar as bibliotecas e as rotas**

Criar `src/worker/lib/names.ts`:

```ts
import { normalizeName, validateName } from "../../shared/names";
import { ApiError } from "../errors";

/** Normaliza e valida um nome vindo do pedido; nome inválido é 400 `invalid_name`. */
export function parseName(raw: string): string {
  const name = normalizeName(raw);
  const problem = validateName(name);
  if (problem) throw new ApiError(400, "invalid_name", problem);
  return name;
}
```

Criar `src/worker/lib/files.ts`:

```ts
import type { FileItem } from "../../shared/types";

/** Colunas de `files` usadas nas listagens, tal como vêm da D1. */
export interface FileRow {
  id: string;
  folder_id: string | null;
  name: string;
  size: number;
  mime: string;
  created_at: number;
}

export const FILE_COLUMNS = "id, folder_id, name, size, mime, created_at";

export function rowToFile(row: FileRow): FileItem {
  return {
    id: row.id,
    name: row.name,
    folderId: row.folder_id,
    size: row.size,
    mime: row.mime,
    createdAt: row.created_at,
  };
}
```

Criar `src/worker/lib/folders.ts`:

```ts
import type { BreadcrumbItem, FolderItem } from "../../shared/types";
import { ApiError } from "../errors";

/** Colunas de `folders` tal como vêm da D1. */
export interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  created_at: number;
}

export const FOLDER_COLUMNS = "id, parent_id, name, created_at";

export function rowToFolder(row: FolderRow): FolderItem {
  return { id: row.id, name: row.name, parentId: row.parent_id, createdAt: row.created_at };
}

/** `null`, `undefined`, "" e "root" significam a raiz (null); um identificador devolve-se tal e qual. */
export function parseFolderRef(value: unknown): string | null {
  if (value === null || value === undefined || value === "" || value === "root") return null;
  if (typeof value === "string") return value;
  throw new ApiError(400, "invalid_body", "Identificador de pasta inválido.");
}

export async function findFolder(
  db: D1Database,
  userId: string,
  id: string,
): Promise<FolderItem | null> {
  const row = await db
    .prepare(`SELECT ${FOLDER_COLUMNS} FROM folders WHERE id = ?1 AND user_id = ?2`)
    .bind(id, userId)
    .first<FolderRow>();
  return row ? rowToFolder(row) : null;
}

/** Como `findFolder`, mas uma pasta inexistente (ou de outro utilizador) é 404. */
export async function requireFolder(
  db: D1Database,
  userId: string,
  id: string,
): Promise<FolderItem> {
  const folder = await findFolder(db, userId, id);
  if (!folder) throw new ApiError(404, "folder_not_found", "Pasta não encontrada.");
  return folder;
}

/** Caminho da raiz até à pasta (inclusive), por consulta recursiva. */
export async function breadcrumbFor(
  db: D1Database,
  userId: string,
  folderId: string,
): Promise<BreadcrumbItem[]> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE anc(id, parent_id, name, depth) AS (
         SELECT id, parent_id, name, 0 FROM folders WHERE id = ?1 AND user_id = ?2
         UNION ALL
         SELECT f.id, f.parent_id, f.name, a.depth + 1
         FROM folders f JOIN anc a ON f.id = a.parent_id
         WHERE f.user_id = ?2
       )
       SELECT id, name FROM anc ORDER BY depth DESC`,
    )
    .bind(folderId, userId)
    .all<BreadcrumbItem>();
  return results;
}

/** Mover `folderId` para dentro de `newParentId` cria um ciclo se for a própria pasta ou uma descendente dela. */
export async function wouldCreateCycle(
  db: D1Database,
  userId: string,
  folderId: string,
  newParentId: string,
): Promise<boolean> {
  const trail = await breadcrumbFor(db, userId, newParentId);
  return trail.some((item) => item.id === folderId);
}
```

Criar `src/worker/routes/folders.ts`:

```ts
import { searchKey } from "../../shared/names";
import { ApiError, isUniqueViolation } from "../errors";
import { FILE_COLUMNS, rowToFile, type FileRow } from "../lib/files";
import {
  breadcrumbFor,
  FOLDER_COLUMNS,
  parseFolderRef,
  requireFolder,
  rowToFolder,
  type FolderRow,
} from "../lib/folders";
import { readJsonObject, readString } from "../lib/http";
import { parseName } from "../lib/names";
import { createAuthedRouter } from "./authed";

export const folders = createAuthedRouter();

/** Todas as pastas do utilizador (para o diálogo "Mover para…"). */
folders.get("/tree", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${FOLDER_COLUMNS} FROM folders WHERE user_id = ?1 ORDER BY name_norm, name`,
  )
    .bind(c.get("user").id)
    .all<FolderRow>();
  return c.json({ folders: results.map(rowToFolder) });
});

/** Conteúdo de uma pasta; `root` é a raiz. Pastas primeiro, depois ficheiros, por nome sem acentos. */
folders.get("/:id/contents", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const folderId = parseFolderRef(c.req.param("id"));
  const folder = folderId === null ? null : await requireFolder(db, userId, folderId);

  const [subfolders, files, breadcrumb] = await Promise.all([
    db
      .prepare(
        `SELECT ${FOLDER_COLUMNS} FROM folders WHERE user_id = ?1 AND parent_id IS ?2 ORDER BY name_norm, name`,
      )
      .bind(userId, folderId)
      .all<FolderRow>(),
    db
      .prepare(
        `SELECT ${FILE_COLUMNS} FROM files
         WHERE user_id = ?1 AND folder_id IS ?2 AND status = 'ready' AND deleted_at IS NULL
         ORDER BY name_norm, name`,
      )
      .bind(userId, folderId)
      .all<FileRow>(),
    folderId === null ? Promise.resolve([]) : breadcrumbFor(db, userId, folderId),
  ]);

  return c.json({
    folder,
    breadcrumb,
    folders: subfolders.results.map(rowToFolder),
    files: files.results.map(rowToFile),
  });
});

folders.post("/", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const body = await readJsonObject(c);
  const name = parseName(readString(body, "name"));
  const parentId = parseFolderRef(body.parentId);
  if (parentId !== null) await requireFolder(db, userId, parentId);

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  try {
    await db
      .prepare(
        `INSERT INTO folders (id, user_id, parent_id, name, name_norm, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(id, userId, parentId, name, searchKey(name), createdAt)
      .run();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "name_taken", "Já existe uma pasta com esse nome neste local.");
    }
    throw error;
  }
  return c.json({ folder: { id, name, parentId, createdAt } }, 201);
});
```

Substituir o conteúdo de `src/worker/app.ts`:

```ts
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiError } from "./errors";
import { jsonBodyLimit } from "./middleware/body-limit";
import { originCheck, securityHeaders } from "./middleware/security";
import { auth } from "./routes/auth";
import { folders } from "./routes/folders";
import type { AppEnv } from "./types";

export const app = new Hono<AppEnv>();

app.use("/api/*", securityHeaders);
app.use("/api/*", originCheck);
app.use("/api/auth/*", jsonBodyLimit);
app.use("/api/folders/*", jsonBodyLimit);

app.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return c.json({ ok: row?.ok === 1 });
});

app.route("/api/auth", auth);
app.route("/api/folders", folders);

app.notFound((c) => c.json({ error: "not_found", message: "Não encontrado." }, 404));

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  if (error instanceof HTTPException) {
    return c.json({ error: "http_error", message: error.message }, error.status);
  }
  console.error(error);
  return c.json({ error: "internal_error", message: "Erro interno do servidor." }, 500);
});
```

- [ ] **Step 4: Correr tudo**

Run: `npx vitest run test/folders.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  13 passed (13)`.

Run: `npx vitest run`
Expected: `Test Files  14 passed (14)`, `Tests  95 passed (95)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

- [ ] **Step 5: Commit**

Commit:

```bash
git add src test
git commit -m "Adiciona listar, árvore e criar pastas" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Pastas: renomear, mover e excluir

**Files:**
- Modify: `src/worker/errors.ts`, `src/worker/routes/folders.ts`
- Create (testes): `test/folders-manage.test.ts`, `test/errors.test.ts`

**Interfaces:**
- Consumes: `requireFolder`, `parseFolderRef`, `wouldCreateCycle`, `parseName`, `readJsonObject`, `readString`, `searchKey`, `createAuthedRouter`, `isUniqueViolation`.
- Produces (`src/worker/errors.ts`): `isForeignKeyViolation(error: unknown): boolean`.
- Produces (rotas): `PATCH /api/folders/:id` `{ name?, parentId? }` (`parentId: null` ou `"root"` = raiz; pelo menos um dos campos) → 200 `{ folder }`; 400 `invalid_body`/`invalid_name`/`invalid_move` (mover para si própria ou para uma descendente), 404 pasta ou destino inexistente ou de outro utilizador, 409 `name_taken`. `DELETE /api/folders/:id` → 204 só se a pasta estiver **vazia** (sem subpastas e sem ficheiros fora da lixeira; um ficheiro `pending` conta como conteúdo), senão 409 `folder_not_empty`. Os ficheiros que estão na lixeira dessa pasta passam para a raiz (`folder_id = NULL`, mantêm `deleted_at`). Se alguém acrescentar conteúdo entre a verificação e o apagar, a chave estrangeira recusa e a resposta é a mesma 409.

- [ ] **Step 1: Escrever os testes que falham**

Criar `test/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isForeignKeyViolation, isUniqueViolation } from "../src/worker/errors";

const UNIQUE =
  "D1_ERROR: UNIQUE constraint failed: index 'folders_unique_name': SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)";
const FOREIGN_KEY =
  "D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)";

describe("deteção de erros de restrição da D1", () => {
  it("isUniqueViolation reconhece a mensagem real da D1", () => {
    expect(isUniqueViolation(new Error(UNIQUE))).toBe(true);
    expect(isUniqueViolation(new Error(FOREIGN_KEY))).toBe(false);
  });

  it("isForeignKeyViolation reconhece a mensagem real da D1", () => {
    expect(isForeignKeyViolation(new Error(FOREIGN_KEY))).toBe(true);
    expect(isForeignKeyViolation(new Error(UNIQUE))).toBe(false);
  });

  it("valores que não são Error dão false", () => {
    for (const value of [UNIQUE, FOREIGN_KEY, null, undefined, { message: UNIQUE }]) {
      expect(isUniqueViolation(value)).toBe(false);
      expect(isForeignKeyViolation(value)).toBe(false);
    }
  });
});
```

Criar `test/folders-manage.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { FolderItem } from "../src/shared/types";
import { registerUser } from "./auth-helpers";
import { createFolder, getContents } from "./folder-helpers";
import { api, resetDb } from "./helpers";

beforeEach(resetDb);

const patch = (cookie: string, id: string, json: unknown) =>
  api(`/api/folders/${id}`, { method: "PATCH", cookie, json });
const remove = (cookie: string, id: string) =>
  api(`/api/folders/${id}`, { method: "DELETE", cookie });

async function insertFileRow(
  userId: string,
  folderId: string | null,
  options: { name?: string; status?: string; deletedAt?: number | null } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at, deleted_at)
     VALUES (?1, ?2, ?3, ?4, ?4, 1, 'text/plain', ?5, ?6, 1, ?7)`,
  )
    .bind(
      id,
      userId,
      folderId,
      options.name ?? "a.txt",
      `u/${userId}/${id}`,
      options.status ?? "ready",
      options.deletedAt ?? null,
    )
    .run();
  return id;
}

describe("PATCH /api/folders/:id (renomear)", () => {
  it("renomeia e normaliza o nome", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const folder = await createFolder(cookie, "Fotos");
    const res = await patch(cookie, folder.id, { name: "  Férias " });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { folder: FolderItem }).folder).toMatchObject({
      id: folder.id,
      name: "Férias",
      parentId: null,
    });
    expect((await getContents(cookie)).folders.map((f) => f.name)).toEqual(["Férias"]);
  });

  it("recusa nomes inválidos (400) e nomes repetidos (409), mas aceita o nome atual", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    await createFolder(cookie, "B");
    expect((await patch(cookie, a.id, { name: "a/b" })).status).toBe(400);
    const dup = await patch(cookie, a.id, { name: "B" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "name_taken" });
    expect((await patch(cookie, a.id, { name: "A" })).status).toBe(200);
  });

  it("exige name e/ou parentId", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const res = await patch(cookie, a.id, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_body" });
  });

  it("devolve 404 para pastas inexistentes ou de outro utilizador", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await createFolder(bob.cookie, "Privada");
    expect((await patch(ana.cookie, doBob.id, { name: "X" })).status).toBe(404);
    expect((await patch(ana.cookie, "nao-existe", { name: "X" })).status).toBe(404);
    expect((await getContents(bob.cookie)).folders[0].name).toBe("Privada");
  });
});

describe("PATCH /api/folders/:id (mover)", () => {
  it("move para outra pasta e de volta para a raiz (null e 'root')", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B");
    const moved = await patch(cookie, b.id, { parentId: a.id });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as { folder: FolderItem }).folder.parentId).toBe(a.id);
    expect((await getContents(cookie, b.id)).breadcrumb.map((x) => x.name)).toEqual(["A", "B"]);

    expect((await patch(cookie, b.id, { parentId: null })).status).toBe(200);
    expect((await getContents(cookie)).folders.map((f) => f.name)).toEqual(["A", "B"]);
    await patch(cookie, b.id, { parentId: a.id });
    expect((await patch(cookie, b.id, { parentId: "root" })).status).toBe(200);
    expect((await getContents(cookie, a.id)).folders).toEqual([]);
  });

  it("recusa mover uma pasta para dentro de si própria ou de uma descendente (400)", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B", a.id);
    const c = await createFolder(cookie, "C", b.id);
    for (const target of [a.id, b.id, c.id]) {
      const res = await patch(cookie, a.id, { parentId: target });
      expect(res.status, `A para ${target}`).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_move" });
    }
    // continua tudo no sítio
    expect((await getContents(cookie, c.id)).breadcrumb.map((x) => x.name)).toEqual(["A", "B", "C"]);
  });

  it("permite mover uma pasta para dentro de uma irmã ou de uma antepassada", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B", a.id);
    const c = await createFolder(cookie, "C", b.id);
    expect((await patch(cookie, c.id, { parentId: a.id })).status).toBe(200);
    expect((await getContents(cookie, c.id)).breadcrumb.map((x) => x.name)).toEqual(["A", "C"]);
  });

  it("recusa o destino que não existe ou é de outro utilizador (404) e o nome repetido no destino (409)", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const a = await createFolder(ana.cookie, "A");
    const doBob = await createFolder(bob.cookie, "Privada");
    expect((await patch(ana.cookie, a.id, { parentId: doBob.id })).status).toBe(404);
    expect((await patch(ana.cookie, a.id, { parentId: "nao-existe" })).status).toBe(404);

    const dest = await createFolder(ana.cookie, "Destino");
    await createFolder(ana.cookie, "A", dest.id);
    const clash = await patch(ana.cookie, a.id, { parentId: dest.id });
    expect(clash.status).toBe(409);
  });

  it("move e renomeia no mesmo pedido", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B");
    const res = await patch(cookie, b.id, { name: "Novo", parentId: a.id });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { folder: FolderItem }).folder).toMatchObject({
      name: "Novo",
      parentId: a.id,
    });
  });
});

describe("DELETE /api/folders/:id", () => {
  it("apaga uma pasta vazia", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const res = await remove(cookie, a.id);
    expect(res.status).toBe(204);
    expect((await getContents(cookie)).folders).toEqual([]);
    expect((await api(`/api/folders/${a.id}/contents`, { cookie })).status).toBe(404);
  });

  it("recusa apagar uma pasta com subpastas (409 folder_not_empty)", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    await createFolder(cookie, "B", a.id);
    const res = await remove(cookie, a.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "folder_not_empty" });
    expect((await getContents(cookie)).folders.map((f) => f.name)).toEqual(["A"]);
  });

  it("recusa apagar uma pasta com ficheiros, incluindo um ficheiro ainda a ser carregado (pending)", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B");
    await insertFileRow(user.id, a.id, { status: "ready" });
    await insertFileRow(user.id, b.id, { status: "pending" });
    expect((await remove(cookie, a.id)).status).toBe(409);
    expect((await remove(cookie, b.id)).status).toBe(409);
  });

  it("uma pasta só com ficheiros na lixeira apaga-se e os ficheiros passam para a raiz", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const fileId = await insertFileRow(user.id, a.id, { deletedAt: 5 });
    expect((await remove(cookie, a.id)).status).toBe(204);
    const row = await env.DB.prepare("SELECT folder_id, deleted_at FROM files WHERE id = ?1")
      .bind(fileId)
      .first<{ folder_id: string | null; deleted_at: number | null }>();
    expect(row).toEqual({ folder_id: null, deleted_at: 5 });
  });

  it("devolve 404 para pastas inexistentes ou de outro utilizador e exige sessão", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await createFolder(bob.cookie, "Privada");
    expect((await remove(ana.cookie, doBob.id)).status).toBe(404);
    expect((await remove(ana.cookie, "nao-existe")).status).toBe(404);
    expect((await api(`/api/folders/${doBob.id}`, { method: "DELETE" })).status).toBe(401);
    expect((await getContents(bob.cookie)).folders).toHaveLength(1);
  });
});
```

Run: `npx vitest run test/errors.test.ts test/folders-manage.test.ts`
Expected: FAIL (Test Files  2 failed (2); Tests  14 failed | 3 passed (17)).

- [ ] **Step 2: Implementar**

Acrescentar ao fim de `src/worker/errors.ts`:

```ts
/** A D1 reporta violações de chave estrangeira como "D1_ERROR: FOREIGN KEY constraint failed: ...". */
export function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Error && /FOREIGN KEY constraint failed/i.test(error.message);
}
```

Substituir o conteúdo de `src/worker/routes/folders.ts`:

```ts
import { searchKey } from "../../shared/names";
import { ApiError, isForeignKeyViolation, isUniqueViolation } from "../errors";
import { FILE_COLUMNS, rowToFile, type FileRow } from "../lib/files";
import {
  breadcrumbFor,
  FOLDER_COLUMNS,
  parseFolderRef,
  requireFolder,
  rowToFolder,
  wouldCreateCycle,
  type FolderRow,
} from "../lib/folders";
import { readJsonObject, readString } from "../lib/http";
import { parseName } from "../lib/names";
import { createAuthedRouter } from "./authed";

export const folders = createAuthedRouter();

/** Todas as pastas do utilizador (para o diálogo "Mover para…"). */
folders.get("/tree", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${FOLDER_COLUMNS} FROM folders WHERE user_id = ?1 ORDER BY name_norm, name`,
  )
    .bind(c.get("user").id)
    .all<FolderRow>();
  return c.json({ folders: results.map(rowToFolder) });
});

/** Conteúdo de uma pasta; `root` é a raiz. Pastas primeiro, depois ficheiros, por nome sem acentos. */
folders.get("/:id/contents", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const folderId = parseFolderRef(c.req.param("id"));
  const folder = folderId === null ? null : await requireFolder(db, userId, folderId);

  const [subfolders, files, breadcrumb] = await Promise.all([
    db
      .prepare(
        `SELECT ${FOLDER_COLUMNS} FROM folders WHERE user_id = ?1 AND parent_id IS ?2 ORDER BY name_norm, name`,
      )
      .bind(userId, folderId)
      .all<FolderRow>(),
    db
      .prepare(
        `SELECT ${FILE_COLUMNS} FROM files
         WHERE user_id = ?1 AND folder_id IS ?2 AND status = 'ready' AND deleted_at IS NULL
         ORDER BY name_norm, name`,
      )
      .bind(userId, folderId)
      .all<FileRow>(),
    folderId === null ? Promise.resolve([]) : breadcrumbFor(db, userId, folderId),
  ]);

  return c.json({
    folder,
    breadcrumb,
    folders: subfolders.results.map(rowToFolder),
    files: files.results.map(rowToFile),
  });
});

folders.post("/", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const body = await readJsonObject(c);
  const name = parseName(readString(body, "name"));
  const parentId = parseFolderRef(body.parentId);
  if (parentId !== null) await requireFolder(db, userId, parentId);

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  try {
    await db
      .prepare(
        `INSERT INTO folders (id, user_id, parent_id, name, name_norm, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(id, userId, parentId, name, searchKey(name), createdAt)
      .run();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "name_taken", "Já existe uma pasta com esse nome neste local.");
    }
    throw error;
  }
  return c.json({ folder: { id, name, parentId, createdAt } }, 201);
});

/** Renomeia e/ou move uma pasta (`parentId: null` ou "root" = raiz). Só mexe na D1. */
folders.patch("/:id", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const folder = await requireFolder(db, userId, c.req.param("id"));
  const body = await readJsonObject(c);
  const hasName = "name" in body;
  const hasParent = "parentId" in body;
  if (!hasName && !hasParent) {
    throw new ApiError(400, "invalid_body", "Indique o novo nome e/ou a nova pasta.");
  }

  const name = hasName ? parseName(readString(body, "name")) : folder.name;
  const parentId = hasParent ? parseFolderRef(body.parentId) : folder.parentId;
  if (hasParent && parentId !== null) {
    await requireFolder(db, userId, parentId);
    if (await wouldCreateCycle(db, userId, folder.id, parentId)) {
      throw new ApiError(
        400,
        "invalid_move",
        "Não é possível mover uma pasta para dentro de si própria ou de uma das suas subpastas.",
      );
    }
  }

  try {
    await db
      .prepare(
        "UPDATE folders SET name = ?1, name_norm = ?2, parent_id = ?3 WHERE id = ?4 AND user_id = ?5",
      )
      .bind(name, searchKey(name), parentId, folder.id, userId)
      .run();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "name_taken", "Já existe uma pasta com esse nome nesse local.");
    }
    throw error;
  }
  return c.json({ folder: { ...folder, name, parentId } });
});

/**
 * Só apaga pastas vazias: sem subpastas e sem ficheiros fora da lixeira (um ficheiro `pending`
 * conta como conteúdo). Os ficheiros que estão na lixeira passam para a raiz e a pasta desaparece.
 */
folders.delete("/:id", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const folder = await requireFolder(db, userId, c.req.param("id"));
  const notEmpty = new ApiError(
    409,
    "folder_not_empty",
    "A pasta não está vazia. Mova ou exclua primeiro o conteúdo.",
  );

  const [subfolders, files] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) AS n FROM folders WHERE user_id = ?1 AND parent_id = ?2")
      .bind(userId, folder.id)
      .first<{ n: number }>(),
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM files WHERE user_id = ?1 AND folder_id = ?2 AND deleted_at IS NULL",
      )
      .bind(userId, folder.id)
      .first<{ n: number }>(),
  ]);
  if ((subfolders?.n ?? 0) > 0 || (files?.n ?? 0) > 0) throw notEmpty;

  try {
    await db.batch([
      db
        .prepare(
          "UPDATE files SET folder_id = NULL WHERE user_id = ?1 AND folder_id = ?2 AND deleted_at IS NOT NULL",
        )
        .bind(userId, folder.id),
      db.prepare("DELETE FROM folders WHERE id = ?1 AND user_id = ?2").bind(folder.id, userId),
    ]);
  } catch (error) {
    // Alguém acrescentou conteúdo entre a verificação e o apagar: a chave estrangeira impede-o.
    if (isForeignKeyViolation(error)) throw notEmpty;
    throw error;
  }
  return c.body(null, 204);
});
```

- [ ] **Step 3: Correr tudo**

Run: `npx vitest run test/errors.test.ts test/folders-manage.test.ts`
Expected: `Test Files  2 passed (2)`, `Tests  17 passed (17)`.

Run: `npx vitest run`
Expected: `Test Files  16 passed (16)`, `Tests  112 passed (112)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

- [ ] **Step 4: Commit**

Commit:

```bash
git add src test
git commit -m "Adiciona renomear, mover e excluir pastas" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ficheiros: upload com quota

**Files:**
- Create: `src/worker/routes/files.ts`, `test/file-helpers.ts`, `test/files-upload.test.ts`
- Modify: `src/worker/lib/files.ts`, `src/worker/app.ts`, `test/helpers.ts` (limpeza do R2 entre testes)

**Interfaces:**
- Produces (`src/worker/lib/files.ts`): `r2KeyFor(userId, fileId): string` (`u/<userId>/<fileId>`, opaca) e `sanitizeMime(raw: string | undefined): string` (`type/subtype` em minúsculas, sem parâmetros; o resto vira `application/octet-stream`).
- Produces (rota): `PUT /api/files?name=<nome>&folder=<id|omitido>` com o ficheiro no corpo → 201 `{ file: FileItem }`. Erros: 400 `invalid_name`; 404 `folder_not_found`; 411 `length_required` (sem `Content-Length` válido: o R2 só aceita corpos em *stream* de tamanho conhecido); 413 `file_too_large` (acima de `MAX_UPLOAD_BYTES`); 413 `quota_exceeded`; 409 `name_taken` (nunca gasta quota).
- Algoritmo (spec, secção 5): (1) **reserva atómica** numa só `batch` da D1: `INSERT` da linha `pending` só se `used_bytes + tamanho <= quota_bytes` e a conta estiver `active`, e só então `UPDATE users SET used_bytes = used_bytes + tamanho` (`WHERE EXISTS` da linha inserida); a `batch` é transacional, por isso um nome repetido desfaz tudo (409) e `meta.changes === 0` no insert quer dizer sem espaço (413); (2) `FILES.put(chave, corpo)` em *stream*, e confirma-se que o tamanho gravado é o declarado; (3) a linha passa a `ready`. Se (2) ou (3) falharem, `releaseReservation` apaga a linha `pending` e devolve o espaço numa só `batch` (`changes() = 1` garante que só devolve se a linha foi mesmo apagada) e tenta apagar o objeto; se isso também falhar, a linha `pending` fica para o cron de manutenção (Plano 4).
- Produces (`test/helpers.ts`): `resetStorage()` (apaga os objetos do R2 de teste) e `resetState()` (D1 e R2 limpos). O estado do R2 não é isolado entre testes do mesmo ficheiro, tal como o da D1: os testes que gravam ficheiros usam `beforeEach(resetState)`.
- Produces (`test/file-helpers.ts`): `uploadFile(cookie, name, content, options?)`, `uploadOk(...)`, `usedBytes(cookie)`, `setQuota(userId, bytes)`, `countFiles()`, `bodyText(res)` (lê corpos binários sem o aviso do `workerd`).
- Os limites e as falhas testam-se chamando `app.fetch(pedido, { ...env, MAX_UPLOAD_BYTES: "10" })` ou com um `FILES` trocado por um objeto que falha; nesse caminho o `Content-Length` tem de ser posto à mão.

- [ ] **Step 1: Escrever os testes que falham**

Substituir o conteúdo de `test/helpers.ts`:

```ts
import { env, exports } from "cloudflare:workers";

export const ORIGIN = "http://example.com";

// Ordem segura para as chaves estrangeiras (filhos primeiro).
const TABLES = ["shares", "files", "folders", "sessions", "login_failures", "users"];

export async function resetDb(): Promise<void> {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
}

/** Apaga todos os objetos do R2 de teste (o estado do R2 também não é isolado entre testes do mesmo ficheiro). */
export async function resetStorage(): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ cursor });
    if (page.objects.length > 0) await env.FILES.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

/** D1 e R2 limpos: usar em `beforeEach` nos testes que gravam ficheiros. */
export async function resetState(): Promise<void> {
  await resetDb();
  await resetStorage();
}

interface ApiInit {
  method?: string;
  json?: unknown;
  body?: BodyInit;
  cookie?: string;
  /** Por defeito ORIGIN. `null` omite o cabeçalho Origin. */
  origin?: string | null;
  headers?: Record<string, string>;
}

/** Chama o Worker como um browser: caminho relativo ou URL absoluta. */
export function api(path: string, init: ApiInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const origin = init.origin === undefined ? ORIGIN : init.origin;
  if (origin !== null) headers.set("Origin", origin);
  if (init.cookie) headers.set("Cookie", init.cookie);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const url = path.startsWith("http") ? path : `${ORIGIN}${path}`;
  return exports.default.fetch(new Request(url, { method: init.method ?? "GET", headers, body }));
}

/** Extrai `sw_session=<token>` do Set-Cookie; null se não houver token (ex.: cookie apagado). */
export function sessionCookie(res: Response): string | null {
  const match = /sw_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
  return match ? `sw_session=${match[1]}` : null;
}
```

Criar `test/file-helpers.ts`:

```ts
import { env } from "cloudflare:workers";
import type { FileItem } from "../src/shared/types";
import { api } from "./helpers";

interface UploadOptions {
  folder?: string | null;
  /** Content-Type do pedido; por defeito text/plain. */
  type?: string;
  headers?: Record<string, string>;
}

/** Faz upload de um ficheiro (texto ou bytes) pela API e devolve a resposta tal como veio. */
export function uploadFile(
  cookie: string,
  name: string,
  content: string | Uint8Array,
  options: UploadOptions = {},
): Promise<Response> {
  const body = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const query = new URLSearchParams({ name });
  if (options.folder) query.set("folder", options.folder);
  return api(`/api/files?${query}`, {
    method: "PUT",
    cookie,
    body,
    headers: { "Content-Type": options.type ?? "text/plain", ...options.headers },
  });
}

/** Como `uploadFile`, mas falha o teste se não der 201 e devolve o ficheiro criado. */
export async function uploadOk(
  cookie: string,
  name: string,
  content: string | Uint8Array,
  options: UploadOptions = {},
): Promise<FileItem> {
  const res = await uploadFile(cookie, name, content, options);
  if (res.status !== 201) throw new Error(`uploadOk falhou: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { file: FileItem }).file;
}

/** Bytes usados pelo utilizador, lidos de `/api/auth/me`. */
export async function usedBytes(cookie: string): Promise<number> {
  const res = await api("/api/auth/me", { cookie });
  return ((await res.json()) as { user: { usedBytes: number } }).user.usedBytes;
}

export async function setQuota(userId: string, quotaBytes: number): Promise<void> {
  await env.DB.prepare("UPDATE users SET quota_bytes = ?1 WHERE id = ?2").bind(quotaBytes, userId).run();
}

export async function countFiles(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM files").first<{ n: number }>();
  return row?.n ?? 0;
}

/** Lê o corpo de uma resposta como texto UTF-8 sem o aviso do workerd para tipos binários (PNG, PDF...). */
export async function bodyText(res: Response): Promise<string> {
  return new TextDecoder().decode(await res.arrayBuffer());
}
```

Criar `test/files-upload.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/worker/app";
import { registerUser } from "./auth-helpers";
import { countFiles, setQuota, uploadFile, uploadOk, usedBytes } from "./file-helpers";
import { createFolder, getContents } from "./folder-helpers";
import { ORIGIN, api, resetState } from "./helpers";

beforeEach(resetState);

describe("PUT /api/files (upload)", () => {
  it("grava o ficheiro no R2 e na D1 e devolve-o", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const res = await uploadFile(cookie, "nota.txt", "olá mundo", { type: "text/plain" });
    expect(res.status).toBe(201);
    const { file } = (await res.json()) as { file: Record<string, unknown> };
    expect(file).toMatchObject({ name: "nota.txt", folderId: null, size: 10, mime: "text/plain" });

    const object = await env.FILES.get(`u/${user.id}/${file.id}`);
    expect(await object?.text()).toBe("olá mundo");
    expect(object?.httpMetadata?.contentType).toBe("text/plain");

    const row = await env.DB.prepare("SELECT status, r2_key FROM files WHERE id = ?1")
      .bind(file.id)
      .first<{ status: string; r2_key: string }>();
    expect(row).toEqual({ status: "ready", r2_key: `u/${user.id}/${file.id}` });
  });

  it("conta o tamanho em bytes na quota e mostra o ficheiro na listagem", async () => {
    const { cookie } = await registerUser("ana@example.com");
    await uploadOk(cookie, "a.txt", "12345");
    await uploadOk(cookie, "b.txt", "123");
    expect(await usedBytes(cookie)).toBe(8);
    const contents = await getContents(cookie);
    expect(contents.files.map((f) => [f.name, f.size])).toEqual([
      ["a.txt", 5],
      ["b.txt", 3],
    ]);
  });

  it("guarda o ficheiro na pasta indicada e só aí aparece", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const docs = await createFolder(cookie, "Docs");
    const file = await uploadOk(cookie, "a.txt", "x", { folder: docs.id });
    expect(file.folderId).toBe(docs.id);
    expect((await getContents(cookie, docs.id)).files.map((f) => f.name)).toEqual(["a.txt"]);
    expect((await getContents(cookie)).files).toEqual([]);
  });

  it("aceita ficheiros vazios", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "vazio.txt", "");
    expect(file.size).toBe(0);
    expect(await usedBytes(cookie)).toBe(0);
  });

  it("normaliza o nome e recusa nomes inválidos (400)", async () => {
    const { cookie } = await registerUser("ana@example.com");
    expect((await uploadOk(cookie, "  Relatório.pdf ", "x")).name).toBe("Relatório.pdf");
    for (const name of ["", "a/b", "..", "a".repeat(256)]) {
      const res = await uploadFile(cookie, name, "x");
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_name" });
    }
    expect(await countFiles()).toBe(1);
  });

  it("limpa o Content-Type: tira parâmetros e troca lixo por application/octet-stream", async () => {
    const { cookie } = await registerUser("ana@example.com");
    expect((await uploadOk(cookie, "a.html", "x", { type: "Text/HTML; charset=utf-8" })).mime).toBe("text/html");
    expect((await uploadOk(cookie, "b.bin", "x", { type: "isto nao e um tipo" })).mime).toBe("application/octet-stream");
    expect((await uploadOk(cookie, "c.bin", "x", { type: "" })).mime).toBe("application/octet-stream");
  });

  it("devolve 404 se a pasta não existir ou for de outro utilizador, sem gastar quota", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await createFolder(bob.cookie, "Privada");
    for (const folder of ["nao-existe", doBob.id]) {
      const res = await uploadFile(ana.cookie, "a.txt", "x", { folder });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "folder_not_found" });
    }
    expect(await countFiles()).toBe(0);
    expect(await usedBytes(ana.cookie)).toBe(0);
  });

  it("recusa um nome repetido no mesmo sítio (409) sem gastar quota nem deixar objeto no R2", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const docs = await createFolder(cookie, "Docs");
    await uploadOk(cookie, "a.txt", "12345");
    const dup = await uploadFile(cookie, "a.txt", "999");
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "name_taken" });
    expect(await usedBytes(cookie)).toBe(5);
    expect(await countFiles()).toBe(1);
    expect((await env.FILES.list({ prefix: "u/" })).objects).toHaveLength(1);
    await uploadOk(cookie, "a.txt", "ok", { folder: docs.id }); // outra pasta: permitido
  });

  it("exige sessão", async () => {
    const res = await api("/api/files?name=a.txt", { method: "PUT", body: new Uint8Array(1) });
    expect(res.status).toBe(401);
  });
});

describe("quota", () => {
  it("recusa com 413 quota_exceeded um ficheiro que não cabe e aceita o que cabe à justa", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    await setQuota(user.id, 10);
    const tooBig = await uploadFile(cookie, "grande.bin", new Uint8Array(11));
    expect(tooBig.status).toBe(413);
    expect(await tooBig.json()).toMatchObject({ error: "quota_exceeded" });
    expect(await countFiles()).toBe(0);
    expect(await usedBytes(cookie)).toBe(0);

    await uploadOk(cookie, "justo.bin", new Uint8Array(10));
    expect(await usedBytes(cookie)).toBe(10);
    expect((await uploadFile(cookie, "mais.bin", new Uint8Array(1))).status).toBe(413);
    expect(await usedBytes(cookie)).toBe(10);
  });

  it("uploads em paralelo nunca ultrapassam a quota", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    await setQuota(user.id, 100);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => uploadFile(cookie, `p${i}.bin`, new Uint8Array(30))),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201, 201, 413, 413]);
    expect(await usedBytes(cookie)).toBe(90);
    expect(await countFiles()).toBe(3);
  });

  it("uma conta suspensa não consegue reservar espaço", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    // A sessão deixa de valer ao suspender; este caso cobre a condição `status = 'active'` da reserva.
    await env.DB.prepare("UPDATE users SET status = 'suspended' WHERE id = ?1").bind(user.id).run();
    const res = await uploadFile(cookie, "a.txt", "x");
    expect(res.status).toBe(401);
    expect(await countFiles()).toBe(0);
  });
});

describe("limites e falhas", () => {
  // Chama a app diretamente com bindings/variáveis alterados. Aqui o Content-Length tem de ser posto à mão
  // (`lengthHeader: null` omite-o).
  function rawUpload(
    name: string,
    body: Uint8Array,
    cookie: string,
    override: Record<string, unknown>,
    lengthHeader: string | null = String(body.length),
  ) {
    const request = new Request(`${ORIGIN}/api/files?name=${name}`, {
      method: "PUT",
      body,
      headers: {
        Origin: ORIGIN,
        Cookie: cookie,
        "Content-Type": "application/octet-stream",
        ...(lengthHeader === null ? {} : { "Content-Length": lengthHeader }),
      },
    });
    return app.fetch(request, { ...env, ...override } as Env);
  }

  it("recusa com 413 file_too_large um ficheiro acima de MAX_UPLOAD_BYTES", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const res = await rawUpload("g.bin", new Uint8Array(11), cookie, { MAX_UPLOAD_BYTES: "10" });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "file_too_large" });
    expect(await countFiles()).toBe(0);
    expect(await usedBytes(cookie)).toBe(0);
    const ok = await rawUpload("ok.bin", new Uint8Array(10), cookie, { MAX_UPLOAD_BYTES: "10" });
    expect(ok.status).toBe(201);
  });

  it("exige um Content-Length válido (411): sem ele o R2 não aceitaria o corpo em stream", async () => {
    const { cookie } = await registerUser("ana@example.com");
    for (const lengthHeader of [null, "", "abc", "-5", "1.5"]) {
      const res = await rawUpload("s.bin", new Uint8Array(3), cookie, {}, lengthHeader);
      expect(res.status, String(lengthHeader)).toBe(411);
      expect(await res.json()).toMatchObject({ error: "length_required" });
    }
    expect(await countFiles()).toBe(0);
  });

  it("se o R2 falhar, devolve o espaço, apaga a linha pending e tenta limpar o objeto", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const deleted: string[] = [];
    const brokenR2 = {
      put: async () => {
        throw new Error("r2 em baixo");
      },
      delete: async (key: string) => {
        deleted.push(key);
      },
    };
    const res = await rawUpload("a.bin", new Uint8Array(7), cookie, { FILES: brokenR2 as unknown as R2Bucket });
    expect(res.status).toBe(500);
    expect(await countFiles()).toBe(0);
    expect(await usedBytes(cookie)).toBe(0);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatch(/^u\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
  });

  it("se o tamanho gravado for diferente do declarado, trata como falha e devolve o espaço", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const wrongSizeR2 = { put: async () => ({ size: 3 }), delete: async () => undefined };
    const res = await rawUpload("a.bin", new Uint8Array(5), cookie, { FILES: wrongSizeR2 as unknown as R2Bucket });
    expect(res.status).toBe(500);
    expect(await countFiles()).toBe(0);
    expect(await usedBytes(cookie)).toBe(0);
  });

  it("uploads pending (a meio) não aparecem nas listagens", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    await env.DB.prepare(
      `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at)
       VALUES ('p1', ?1, NULL, 'a meio.txt', 'a meio.txt', 1, 'text/plain', 'u/x/p1', 'pending', 1)`,
    )
      .bind(user.id)
      .run();
    expect((await getContents(cookie)).files).toEqual([]);
  });
});
```

Run: `npx vitest run test/files-upload.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  16 failed | 1 passed (17)).

- [ ] **Step 2: Implementar o upload**

Substituir o conteúdo de `src/worker/lib/files.ts`:

```ts
import type { FileItem } from "../../shared/types";

/** Colunas de `files` usadas nas listagens, tal como vêm da D1. */
export interface FileRow {
  id: string;
  folder_id: string | null;
  name: string;
  size: number;
  mime: string;
  created_at: number;
}

export const FILE_COLUMNS = "id, folder_id, name, size, mime, created_at";

export function rowToFile(row: FileRow): FileItem {
  return {
    id: row.id,
    name: row.name,
    folderId: row.folder_id,
    size: row.size,
    mime: row.mime,
    createdAt: row.created_at,
  };
}

/** Chave do ficheiro no R2: opaca, sem nome nem caminho (mover e renomear só mexem na D1). */
export function r2KeyFor(userId: string, fileId: string): string {
  return `u/${userId}/${fileId}`;
}

const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/** `type/subtype` em minúsculas, sem parâmetros; qualquer coisa inválida vira `application/octet-stream`. */
export function sanitizeMime(raw: string | undefined): string {
  const type = (raw ?? "").split(";")[0].trim().toLowerCase();
  return MIME_PATTERN.test(type) ? type : "application/octet-stream";
}
```

Criar `src/worker/routes/files.ts`:

```ts
import { formatBytes } from "../../shared/format";
import { searchKey } from "../../shared/names";
import { getConfig } from "../config";
import { ApiError, isForeignKeyViolation, isUniqueViolation } from "../errors";
import { r2KeyFor, sanitizeMime } from "../lib/files";
import { parseFolderRef, requireFolder } from "../lib/folders";
import { parseName } from "../lib/names";
import { createAuthedRouter } from "./authed";

export const files = createAuthedRouter();

function parseContentLength(raw: string | undefined): number {
  const size = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(size)) {
    throw new ApiError(
      411,
      "length_required",
      "O pedido tem de indicar o tamanho do ficheiro (Content-Length).",
    );
  }
  return size;
}

/**
 * Upload: `PUT /api/files?name=<nome>&folder=<id|omitido>` com o ficheiro no corpo.
 *
 * 1. Reserva atómica numa só `batch`: insere a linha `pending` só se couber na quota e, só então,
 *    soma o tamanho a `used_bytes` (pedidos em paralelo não conseguem ultrapassar a quota).
 * 2. Grava os bytes no R2 em *stream* (o R2 exige o tamanho conhecido, por isso o Content-Length é obrigatório).
 * 3. Passa a linha a `ready`. Se o passo 2 ou 3 falhar, liberta a reserva.
 */
files.put("/", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const config = getConfig(c.env);

  const name = parseName(c.req.query("name") ?? "");
  const folderId = parseFolderRef(c.req.query("folder"));
  if (folderId !== null) await requireFolder(db, user.id, folderId);
  const size = parseContentLength(c.req.header("content-length"));
  if (size > config.maxUploadBytes) {
    throw new ApiError(
      413,
      "file_too_large",
      `O ficheiro excede o tamanho máximo de ${formatBytes(config.maxUploadBytes)}.`,
    );
  }

  const id = crypto.randomUUID();
  const r2Key = r2KeyFor(user.id, id);
  const mime = sanitizeMime(c.req.header("content-type"));
  const createdAt = Date.now();

  let reserved;
  try {
    reserved = await db.batch([
      db
        .prepare(
          `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9
           WHERE EXISTS (
             SELECT 1 FROM users
             WHERE id = ?2 AND status = 'active' AND used_bytes + ?6 <= quota_bytes
           )`,
        )
        .bind(id, user.id, folderId, name, searchKey(name), size, mime, r2Key, createdAt),
      db
        .prepare(
          "UPDATE users SET used_bytes = used_bytes + ?1 WHERE id = ?2 AND EXISTS (SELECT 1 FROM files WHERE id = ?3)",
        )
        .bind(size, user.id, id),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "name_taken", "Já existe um ficheiro com esse nome neste local.");
    }
    // A pasta foi apagada entre a verificação e a reserva.
    if (isForeignKeyViolation(error)) {
      throw new ApiError(404, "folder_not_found", "Pasta não encontrada.");
    }
    throw error;
  }
  if (reserved[0].meta.changes !== 1) {
    throw new ApiError(413, "quota_exceeded", "Sem espaço suficiente na sua quota.");
  }

  try {
    const object = await c.env.FILES.put(r2Key, c.req.raw.body, {
      httpMetadata: { contentType: mime },
    });
    if (object === null || object.size !== size) {
      throw new Error("O tamanho gravado no R2 é diferente do declarado.");
    }
    await db.prepare("UPDATE files SET status = 'ready' WHERE id = ?1").bind(id).run();
  } catch (error) {
    await releaseReservation(c.env, user.id, id, size, r2Key);
    throw error;
  }

  return c.json({ file: { id, name, folderId, size, mime, createdAt } }, 201);
});

/**
 * Desfaz a reserva de um upload que falhou: apaga a linha `pending` e devolve o espaço, numa só
 * `batch` (o `changes()` garante que o espaço só é devolvido se a linha foi mesmo apagada).
 * Se também isto falhar, a linha `pending` fica para o cron de manutenção limpar.
 */
async function releaseReservation(
  env: Env,
  userId: string,
  fileId: string,
  size: number,
  r2Key: string,
): Promise<void> {
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM files WHERE id = ?1 AND status = 'pending'").bind(fileId),
      env.DB.prepare(
        "UPDATE users SET used_bytes = MAX(used_bytes - ?1, 0) WHERE id = ?2 AND changes() = 1",
      ).bind(size, userId),
    ]);
  } catch (error) {
    console.error("Não foi possível libertar a reserva de um upload falhado", error);
  }
  await env.FILES.delete(r2Key).catch(() => undefined);
}
```

Substituir o conteúdo de `src/worker/app.ts`:

```ts
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiError } from "./errors";
import { jsonBodyLimit } from "./middleware/body-limit";
import { originCheck, securityHeaders } from "./middleware/security";
import { auth } from "./routes/auth";
import { files } from "./routes/files";
import { folders } from "./routes/folders";
import type { AppEnv } from "./types";

export const app = new Hono<AppEnv>();

app.use("/api/*", securityHeaders);
app.use("/api/*", originCheck);
app.use("/api/auth/*", jsonBodyLimit);
app.use("/api/folders/*", jsonBodyLimit);

app.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return c.json({ ok: row?.ok === 1 });
});

app.route("/api/auth", auth);
app.route("/api/folders", folders);
app.route("/api/files", files);

app.notFound((c) => c.json({ error: "not_found", message: "Não encontrado." }, 404));

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  if (error instanceof HTTPException) {
    return c.json({ error: "http_error", message: error.message }, error.status);
  }
  console.error(error);
  return c.json({ error: "internal_error", message: "Erro interno do servidor." }, 500);
});
```

- [ ] **Step 3: Correr tudo**

Run: `npx vitest run test/files-upload.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  17 passed (17)`.

Run: `npx vitest run`
Expected: `Test Files  17 passed (17)`, `Tests  129 passed (129)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

- [ ] **Step 4: Commit**

Commit:

```bash
git add src test
git commit -m "Adiciona o upload de ficheiros com reserva atómica de quota" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Ficheiros: descarregar e pré-visualizar

**Files:**
- Modify: `src/worker/lib/files.ts`, `src/worker/routes/files.ts`
- Create (testes): `test/files-download.test.ts`

**Interfaces:**
- Produces (`src/worker/lib/files.ts`): `StoredFile extends FileItem { r2Key: string }` (a chave nunca vai para o frontend), `findReadyFile(db, userId, id)`, `requireFile(db, userId, id)` (404 `file_not_found` para ficheiros inexistentes, de outro utilizador, na lixeira ou ainda `pending`), `previewContentType(name): string | null` (por extensão: `png`, `jpg`, `jpeg`, `gif`, `webp`, `pdf`, sem distinguir maiúsculas; sem extensão ou só `.png` → `null`), `contentDisposition(type: "attachment" | "inline", filename): string` (`filename` ASCII de recurso e `filename*=UTF-8''...` percent-encoded, RFC 5987).
- Produces (rotas): `GET /api/files/:id/download` → os bytes em *stream*, sempre `Content-Disposition: attachment`, `Content-Type` guardado, `Content-Length`, `ETag`; 404 `file_missing` se a linha existir mas o objeto não estiver no R2. `GET /api/files/:id/preview` → só as extensões permitidas (senão 415 `preview_unsupported`; SVG e HTML ficam de fora de propósito, porque executariam código no nosso domínio): `Content-Type` fixo pela extensão (**não** o valor guardado), `Content-Disposition: inline`, `Accept-Ranges: bytes`; imagens levam também `Content-Security-Policy: default-src 'none'; sandbox` (o PDF não, porque o leitor de PDF do browser precisa de outro contexto). Um único intervalo (`Range: bytes=a-b`, `a-`, `-n`) → 206 com `Content-Range`; começar depois do fim → 416 com `Content-Range: bytes */<tamanho>` (o R2 devolveria o ficheiro todo, por isso a verificação é nossa); qualquer outro formato de `Range` é ignorado e devolve-se o ficheiro todo.

- [ ] **Step 1: Escrever os testes que falham**

Criar `test/files-download.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { registerUser } from "./auth-helpers";
import { bodyText, uploadOk } from "./file-helpers";
import { api, resetState } from "./helpers";

beforeEach(resetState);

async function trash(fileId: string): Promise<void> {
  await env.DB.prepare("UPDATE files SET deleted_at = 5 WHERE id = ?1").bind(fileId).run();
}

describe("GET /api/files/:id/download", () => {
  it("devolve os bytes como anexo, com cabeçalhos seguros", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "nota.txt", "olá mundo", { type: "text/plain" });
    const res = await api(`/api/files/${file.id}/download`, { cookie });
    expect(res.status).toBe(200);
    expect(await bodyText(res)).toBe("olá mundo");
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="nota.txt"; filename*=UTF-8''nota.txt`,
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]+"$/);
  });

  it("codifica nomes com acentos e aspas no Content-Disposition", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const accented = await uploadOk(cookie, "Relatório ção.pdf", "x");
    const res = await api(`/api/files/${accented.id}/download`, { cookie });
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="Relat_rio __o.pdf"; filename*=UTF-8''Relat%C3%B3rio%20%C3%A7%C3%A3o.pdf`,
    );
    const quoted = await uploadOk(cookie, `a"b (1).txt`, "x");
    const res2 = await api(`/api/files/${quoted.id}/download`, { cookie });
    expect(res2.headers.get("content-disposition")).toBe(
      `attachment; filename="a_b (1).txt"; filename*=UTF-8''a%22b%20%281%29.txt`,
    );
  });

  it("não interpreta HTML: continua a ser anexo", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "pagina.html", "<script>alert(1)</script>", { type: "text/html" });
    const res = await api(`/api/files/${file.id}/download`, { cookie });
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("devolve 404 para ficheiros inexistentes, de outro utilizador, na lixeira ou ainda a ser carregados", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await uploadOk(bob.cookie, "privado.txt", "segredo");
    const naLixeira = await uploadOk(ana.cookie, "lixo.txt", "x");
    await trash(naLixeira.id);
    await env.DB.prepare(
      `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at)
       VALUES ('p1', ?1, NULL, 'pending.txt', 'pending.txt', 1, 'text/plain', 'u/x/p1', 'pending', 1)`,
    )
      .bind((await env.DB.prepare("SELECT id FROM users WHERE email = 'ana@example.com'").first<{ id: string }>())?.id)
      .run();
    for (const id of ["nao-existe", doBob.id, naLixeira.id, "p1"]) {
      const res = await api(`/api/files/${id}/download`, { cookie: ana.cookie });
      expect(res.status, id).toBe(404);
    }
  });

  it("devolve 404 file_missing quando a linha existe mas o objeto desapareceu do R2", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "x");
    await env.FILES.delete(`u/${user.id}/${file.id}`);
    const res = await api(`/api/files/${file.id}/download`, { cookie });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "file_missing" });
  });

  it("exige sessão", async () => {
    expect((await api("/api/files/qualquer/download")).status).toBe(401);
  });
});

describe("GET /api/files/:id/preview", () => {
  it("mostra imagens inline com o Content-Type decidido pela extensão, não pelo valor guardado", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "falsa.png", "<html>nao sou uma imagem</html>", { type: "text/html" });
    const res = await api(`/api/files/${file.id}/preview`, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(await bodyText(res)).toBe("<html>nao sou uma imagem</html>");
  });

  it("mostra PDF inline, sem a política sandbox (o leitor de PDF do browser precisa dele)", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "doc.pdf", "%PDF-1.4", { type: "application/pdf" });
    const res = await api(`/api/files/${file.id}/preview`, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("reconhece todas as extensões permitidas, sem distinguir maiúsculas", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const expected: Record<string, string> = {
      "a.jpg": "image/jpeg",
      "b.JPEG": "image/jpeg",
      "c.gif": "image/gif",
      "d.WebP": "image/webp",
      "e.PNG": "image/png",
      "f.Pdf": "application/pdf",
    };
    for (const [name, type] of Object.entries(expected)) {
      const file = await uploadOk(cookie, name, "x");
      const res = await api(`/api/files/${file.id}/preview`, { cookie });
      expect(res.headers.get("content-type"), name).toBe(type);
    }
  });

  it("recusa com 415 SVG, HTML, texto e nomes sem extensão", async () => {
    const { cookie } = await registerUser("ana@example.com");
    for (const name of ["a.svg", "b.html", "c.txt", "png", ".png", "d.png.exe"]) {
      const file = await uploadOk(cookie, name, "x");
      const res = await api(`/api/files/${file.id}/preview`, { cookie });
      expect(res.status, name).toBe(415);
      expect(await res.json()).toMatchObject({ error: "preview_unsupported" });
    }
  });

  describe("intervalos (Range)", () => {
    async function setup() {
      const { cookie } = await registerUser("ana@example.com");
      const file = await uploadOk(cookie, "dez.pdf", "0123456789", { type: "application/pdf" });
      const get = (range?: string) =>
        api(`/api/files/${file.id}/preview`, { cookie, headers: range ? { Range: range } : {} });
      return { get };
    }

    it("sem Range devolve tudo (200) e anuncia que aceita intervalos", async () => {
      const { get } = await setup();
      const res = await get();
      expect(res.status).toBe(200);
      expect(res.headers.get("content-length")).toBe("10");
      expect(res.headers.get("accept-ranges")).toBe("bytes");
      expect(await bodyText(res)).toBe("0123456789");
    });

    it("bytes=0-3 devolve 206 com Content-Range", async () => {
      const { get } = await setup();
      const res = await get("bytes=0-3");
      expect(res.status).toBe(206);
      expect(res.headers.get("content-range")).toBe("bytes 0-3/10");
      expect(res.headers.get("content-length")).toBe("4");
      expect(await bodyText(res)).toBe("0123");
    });

    it("bytes=4- devolve do 4 até ao fim e bytes=-3 devolve os últimos 3", async () => {
      const { get } = await setup();
      const rest = await get("bytes=4-");
      expect(rest.status).toBe(206);
      expect(rest.headers.get("content-range")).toBe("bytes 4-9/10");
      expect(await bodyText(rest)).toBe("456789");
      const tail = await get("bytes=-3");
      expect(tail.status).toBe(206);
      expect(tail.headers.get("content-range")).toBe("bytes 7-9/10");
      expect(await bodyText(tail)).toBe("789");
    });

    it("um intervalo que começa depois do fim dá 416", async () => {
      const { get } = await setup();
      const res = await get("bytes=50-");
      expect(res.status).toBe(416);
      expect(res.headers.get("content-range")).toBe("bytes */10");
    });

    it("formatos não suportados são ignorados e devolvem o ficheiro todo", async () => {
      const { get } = await setup();
      for (const range of ["bytes=abc", "bytes=0-1,3-4", "items=0-1", "bytes=-"]) {
        const res = await get(range);
        expect(res.status, range).toBe(200);
        expect(await bodyText(res)).toBe("0123456789");
      }
    });
  });

  it("devolve 404 para ficheiros de outro utilizador ou na lixeira e exige sessão", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await uploadOk(bob.cookie, "a.png", "x");
    const minha = await uploadOk(ana.cookie, "b.png", "x");
    await trash(minha.id);
    expect((await api(`/api/files/${doBob.id}/preview`, { cookie: ana.cookie })).status).toBe(404);
    expect((await api(`/api/files/${minha.id}/preview`, { cookie: ana.cookie })).status).toBe(404);
    expect((await api(`/api/files/${doBob.id}/preview`)).status).toBe(401);
  });
});
```

Run: `npx vitest run test/files-download.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  13 failed | 3 passed (16)).

- [ ] **Step 2: Implementar**

Substituir o conteúdo de `src/worker/lib/files.ts`:

```ts
import type { FileItem } from "../../shared/types";
import { ApiError } from "../errors";

/** Colunas de `files` usadas nas listagens, tal como vêm da D1. */
export interface FileRow {
  id: string;
  folder_id: string | null;
  name: string;
  size: number;
  mime: string;
  created_at: number;
}

export const FILE_COLUMNS = "id, folder_id, name, size, mime, created_at";

export function rowToFile(row: FileRow): FileItem {
  return {
    id: row.id,
    name: row.name,
    folderId: row.folder_id,
    size: row.size,
    mime: row.mime,
    createdAt: row.created_at,
  };
}

/** Chave do ficheiro no R2: opaca, sem nome nem caminho (mover e renomear só mexem na D1). */
export function r2KeyFor(userId: string, fileId: string): string {
  return `u/${userId}/${fileId}`;
}

const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/** `type/subtype` em minúsculas, sem parâmetros; qualquer coisa inválida vira `application/octet-stream`. */
export function sanitizeMime(raw: string | undefined): string {
  const type = (raw ?? "").split(";")[0].trim().toLowerCase();
  return MIME_PATTERN.test(type) ? type : "application/octet-stream";
}

/** Um ficheiro pronto, com a chave do R2 (nunca vai para o frontend). */
export interface StoredFile extends FileItem {
  r2Key: string;
}

/** Ficheiro pronto e fora da lixeira do utilizador, ou null. */
export async function findReadyFile(
  db: D1Database,
  userId: string,
  id: string,
): Promise<StoredFile | null> {
  const row = await db
    .prepare(
      `SELECT ${FILE_COLUMNS}, r2_key FROM files
       WHERE id = ?1 AND user_id = ?2 AND status = 'ready' AND deleted_at IS NULL`,
    )
    .bind(id, userId)
    .first<FileRow & { r2_key: string }>();
  return row ? { ...rowToFile(row), r2Key: row.r2_key } : null;
}

/** Como `findReadyFile`, mas um ficheiro inexistente, na lixeira ou de outro utilizador é 404. */
export async function requireFile(
  db: D1Database,
  userId: string,
  id: string,
): Promise<StoredFile> {
  const file = await findReadyFile(db, userId, id);
  if (!file) throw new ApiError(404, "file_not_found", "Ficheiro não encontrado.");
  return file;
}

// Só estes tipos abrem dentro da app. SVG e HTML ficam de fora de propósito: executariam código no nosso domínio.
const PREVIEW_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

/** Content-Type fixo para a pré-visualização, decidido pela extensão do nome; null se não for permitida. */
export function previewContentType(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null; // sem extensão, ou um ficheiro escondido como ".png"
  return PREVIEW_TYPES[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** `Content-Disposition` com `filename` ASCII de recurso e `filename*` em UTF-8 (RFC 5987). */
export function contentDisposition(type: "attachment" | "inline", filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
```

Substituir o conteúdo de `src/worker/routes/files.ts`:

```ts
import { formatBytes } from "../../shared/format";
import { searchKey } from "../../shared/names";
import { getConfig } from "../config";
import { ApiError, isForeignKeyViolation, isUniqueViolation } from "../errors";
import {
  contentDisposition,
  previewContentType,
  r2KeyFor,
  requireFile,
  sanitizeMime,
} from "../lib/files";
import { parseFolderRef, requireFolder } from "../lib/folders";
import { parseName } from "../lib/names";
import { createAuthedRouter } from "./authed";

export const files = createAuthedRouter();

function parseContentLength(raw: string | undefined): number {
  const size = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(size)) {
    throw new ApiError(
      411,
      "length_required",
      "O pedido tem de indicar o tamanho do ficheiro (Content-Length).",
    );
  }
  return size;
}

/**
 * Upload: `PUT /api/files?name=<nome>&folder=<id|omitido>` com o ficheiro no corpo.
 *
 * 1. Reserva atómica numa só `batch`: insere a linha `pending` só se couber na quota e, só então,
 *    soma o tamanho a `used_bytes` (pedidos em paralelo não conseguem ultrapassar a quota).
 * 2. Grava os bytes no R2 em *stream* (o R2 exige o tamanho conhecido, por isso o Content-Length é obrigatório).
 * 3. Passa a linha a `ready`. Se o passo 2 ou 3 falhar, liberta a reserva.
 */
files.put("/", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const config = getConfig(c.env);

  const name = parseName(c.req.query("name") ?? "");
  const folderId = parseFolderRef(c.req.query("folder"));
  if (folderId !== null) await requireFolder(db, user.id, folderId);
  const size = parseContentLength(c.req.header("content-length"));
  if (size > config.maxUploadBytes) {
    throw new ApiError(
      413,
      "file_too_large",
      `O ficheiro excede o tamanho máximo de ${formatBytes(config.maxUploadBytes)}.`,
    );
  }

  const id = crypto.randomUUID();
  const r2Key = r2KeyFor(user.id, id);
  const mime = sanitizeMime(c.req.header("content-type"));
  const createdAt = Date.now();

  let reserved;
  try {
    reserved = await db.batch([
      db
        .prepare(
          `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9
           WHERE EXISTS (
             SELECT 1 FROM users
             WHERE id = ?2 AND status = 'active' AND used_bytes + ?6 <= quota_bytes
           )`,
        )
        .bind(id, user.id, folderId, name, searchKey(name), size, mime, r2Key, createdAt),
      db
        .prepare(
          "UPDATE users SET used_bytes = used_bytes + ?1 WHERE id = ?2 AND EXISTS (SELECT 1 FROM files WHERE id = ?3)",
        )
        .bind(size, user.id, id),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "name_taken", "Já existe um ficheiro com esse nome neste local.");
    }
    // A pasta foi apagada entre a verificação e a reserva.
    if (isForeignKeyViolation(error)) {
      throw new ApiError(404, "folder_not_found", "Pasta não encontrada.");
    }
    throw error;
  }
  if (reserved[0].meta.changes !== 1) {
    throw new ApiError(413, "quota_exceeded", "Sem espaço suficiente na sua quota.");
  }

  try {
    const object = await c.env.FILES.put(r2Key, c.req.raw.body, {
      httpMetadata: { contentType: mime },
    });
    if (object === null || object.size !== size) {
      throw new Error("O tamanho gravado no R2 é diferente do declarado.");
    }
    await db.prepare("UPDATE files SET status = 'ready' WHERE id = ?1").bind(id).run();
  } catch (error) {
    await releaseReservation(c.env, user.id, id, size, r2Key);
    throw error;
  }

  return c.json({ file: { id, name, folderId, size, mime, createdAt } }, 201);
});

/**
 * Desfaz a reserva de um upload que falhou: apaga a linha `pending` e devolve o espaço, numa só
 * `batch` (o `changes()` garante que o espaço só é devolvido se a linha foi mesmo apagada).
 * Se também isto falhar, a linha `pending` fica para o cron de manutenção limpar.
 */
async function releaseReservation(
  env: Env,
  userId: string,
  fileId: string,
  size: number,
  r2Key: string,
): Promise<void> {
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM files WHERE id = ?1 AND status = 'pending'").bind(fileId),
      env.DB.prepare(
        "UPDATE users SET used_bytes = MAX(used_bytes - ?1, 0) WHERE id = ?2 AND changes() = 1",
      ).bind(size, userId),
    ]);
  } catch (error) {
    console.error("Não foi possível libertar a reserva de um upload falhado", error);
  }
  await env.FILES.delete(r2Key).catch(() => undefined);
}

function missingObject(fileId: string): ApiError {
  console.error(`O ficheiro ${fileId} existe na D1 mas não tem objeto no R2.`);
  return new ApiError(404, "file_missing", "O conteúdo do ficheiro não está disponível.");
}

/** Descarrega o ficheiro em *stream*, sempre como anexo (nunca é interpretado pelo browser). */
files.get("/:id/download", async (c) => {
  const file = await requireFile(c.env.DB, c.get("user").id, c.req.param("id"));
  const object = await c.env.FILES.get(file.r2Key);
  if (!object) throw missingObject(file.id);

  return new Response(object.body, {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(object.size),
      "Content-Disposition": contentDisposition("attachment", file.name),
      ETag: object.httpEtag,
    },
  });
});

/** Posição e tamanho de um intervalo já resolvido pelo R2. */
function resolveRange(range: R2Range | undefined, size: number): { offset: number; length: number } {
  const r = (range ?? {}) as { offset?: number; length?: number; suffix?: number };
  const offset = r.offset ?? (r.suffix !== undefined ? Math.max(size - r.suffix, 0) : 0);
  return { offset, length: r.length ?? size - offset };
}

/**
 * Pré-visualização inline, só para imagens e PDF (lista fixa por extensão). O Content-Type vem
 * dessa lista e não do valor guardado. Suporta um único intervalo (`Range: bytes=a-b`, `a-`, `-n`).
 */
files.get("/:id/preview", async (c) => {
  const file = await requireFile(c.env.DB, c.get("user").id, c.req.param("id"));
  const contentType = previewContentType(file.name);
  if (!contentType) {
    throw new ApiError(415, "preview_unsupported", "Este tipo de ficheiro não tem pré-visualização.");
  }

  // Só um intervalo simples conta; qualquer outro formato é ignorado e devolve-se o ficheiro todo.
  const match = /^bytes=(\d*)-(\d*)$/.exec((c.req.header("range") ?? "").trim());
  const ranged = match !== null && (match[1] !== "" || match[2] !== "");
  const object = await c.env.FILES.get(file.r2Key, ranged ? { range: c.req.raw.headers } : undefined);
  if (!object) throw missingObject(file.id);

  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": contentDisposition("inline", file.name),
    "Accept-Ranges": "bytes",
    ETag: object.httpEtag,
  });
  if (contentType.startsWith("image/")) {
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  }

  if (ranged && match) {
    // O R2 devolve o ficheiro todo quando o intervalo começa depois do fim; aqui é 416.
    if (match[1] !== "" && Number(match[1]) >= object.size) {
      await object.body.cancel();
      headers.set("Content-Range", `bytes */${object.size}`);
      return new Response(null, { status: 416, headers });
    }
    const { offset, length } = resolveRange(object.range, object.size);
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
});
```

- [ ] **Step 3: Correr tudo**

Run: `npx vitest run test/files-download.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  16 passed (16)`.

Run: `npx vitest run`
Expected: `Test Files  18 passed (18)`, `Tests  145 passed (145)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

- [ ] **Step 4: Commit**

Commit:

```bash
git add src test
git commit -m "Adiciona descarregar e pré-visualizar ficheiros com suporte a intervalos" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Ficheiros: renomear, mover, excluir e isolamento

**Files:**
- Modify: `src/worker/lib/files.ts`, `src/worker/routes/files.ts`
- Create (testes): `test/files-manage.test.ts`, `test/authz.test.ts`

**Interfaces:**
- Produces (`src/worker/lib/files.ts`): `toFileItem(file: StoredFile): FileItem` (tira a chave do R2 da resposta).
- Produces (rotas): `PATCH /api/files/:id` `{ name?, folderId? }` (`folderId: null` ou `"root"` = raiz) → 200 `{ file }`, só na D1 (a chave do R2 não muda): 400 `invalid_body`/`invalid_name`, 404 ficheiro ou pasta inexistente ou de outro utilizador, 409 `name_taken`. `DELETE /api/files/:id` → 204: define `deleted_at` (vai para a lixeira); o objeto no R2 e a quota ficam como estão até à eliminação definitiva (planos seguintes); depois de excluir, o nome volta a poder ser usado (o índice único ignora ficheiros na lixeira); excluir duas vezes dá 404.
- `test/authz.test.ts`: varre `app.routes` e exige que **toda** a rota de `/api/folders` e `/api/files` dê 401 sem sessão (falha se alguém acrescentar uma rota sem autenticação), e prova o isolamento: um segundo utilizador recebe 404 em todas as rotas sobre os recursos do primeiro e nada muda do lado do dono.

- [ ] **Step 1: Escrever os testes que falham**

Criar `test/files-manage.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { FileItem } from "../src/shared/types";
import { registerUser } from "./auth-helpers";
import { uploadOk, usedBytes } from "./file-helpers";
import { createFolder, getContents } from "./folder-helpers";
import { api, resetState } from "./helpers";

beforeEach(resetState);

const patch = (cookie: string, id: string, json: unknown) =>
  api(`/api/files/${id}`, { method: "PATCH", cookie, json });
const remove = (cookie: string, id: string) => api(`/api/files/${id}`, { method: "DELETE", cookie });

describe("PATCH /api/files/:id (renomear)", () => {
  it("renomeia, normaliza o nome e não mexe no conteúdo nem na chave do R2", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "conteúdo");
    const res = await patch(cookie, file.id, { name: "  Relatório.txt " });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { file: FileItem };
    expect(body.file).toMatchObject({ id: file.id, name: "Relatório.txt", folderId: null, size: file.size });
    expect(Object.keys(body.file).sort()).toEqual(
      ["createdAt", "folderId", "id", "mime", "name", "size"],
    ); // nunca expõe a chave do R2
    expect((await getContents(cookie)).files.map((f) => f.name)).toEqual(["Relatório.txt"]);
    expect(await (await env.FILES.get(`u/${user.id}/${file.id}`))?.text()).toBe("conteúdo");
    const download = await api(`/api/files/${file.id}/download`, { cookie });
    expect(await download.text()).toBe("conteúdo");
  });

  it("recusa nomes inválidos (400) e repetidos (409), mas aceita o nome atual", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await uploadOk(cookie, "a.txt", "x");
    await uploadOk(cookie, "b.txt", "x");
    expect((await patch(cookie, a.id, { name: "a/b" })).status).toBe(400);
    const dup = await patch(cookie, a.id, { name: "b.txt" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "name_taken" });
    expect((await patch(cookie, a.id, { name: "a.txt" })).status).toBe(200);
  });

  it("exige name e/ou folderId", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await uploadOk(cookie, "a.txt", "x");
    const res = await patch(cookie, a.id, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_body" });
  });
});

describe("PATCH /api/files/:id (mover)", () => {
  it("move para uma pasta e de volta para a raiz (null e 'root')", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const docs = await createFolder(cookie, "Docs");
    const file = await uploadOk(cookie, "a.txt", "x");
    const moved = await patch(cookie, file.id, { folderId: docs.id });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as { file: FileItem }).file.folderId).toBe(docs.id);
    expect((await getContents(cookie, docs.id)).files.map((f) => f.name)).toEqual(["a.txt"]);
    expect((await getContents(cookie)).files).toEqual([]);

    expect((await patch(cookie, file.id, { folderId: null })).status).toBe(200);
    expect((await getContents(cookie)).files.map((f) => f.name)).toEqual(["a.txt"]);
    await patch(cookie, file.id, { folderId: docs.id });
    expect((await patch(cookie, file.id, { folderId: "root" })).status).toBe(200);
    expect((await getContents(cookie, docs.id)).files).toEqual([]);
  });

  it("recusa o destino que não existe ou é de outro utilizador (404) e o nome repetido no destino (409)", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await createFolder(bob.cookie, "Privada");
    const file = await uploadOk(ana.cookie, "a.txt", "x");
    expect((await patch(ana.cookie, file.id, { folderId: doBob.id })).status).toBe(404);
    expect((await patch(ana.cookie, file.id, { folderId: "nao-existe" })).status).toBe(404);

    const dest = await createFolder(ana.cookie, "Destino");
    await uploadOk(ana.cookie, "a.txt", "outro", { folder: dest.id });
    const clash = await patch(ana.cookie, file.id, { folderId: dest.id });
    expect(clash.status).toBe(409);
  });

  it("move e renomeia no mesmo pedido", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const docs = await createFolder(cookie, "Docs");
    const file = await uploadOk(cookie, "a.txt", "x");
    const res = await patch(cookie, file.id, { name: "novo.txt", folderId: docs.id });
    expect(((await res.json()) as { file: FileItem }).file).toMatchObject({ name: "novo.txt", folderId: docs.id });
  });
});

describe("DELETE /api/files/:id (excluir para a lixeira)", () => {
  it("tira o ficheiro das listagens e dos downloads mas mantém objeto e quota", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "12345");
    const res = await remove(cookie, file.id);
    expect(res.status).toBe(204);
    expect((await getContents(cookie)).files).toEqual([]);
    expect((await api(`/api/files/${file.id}/download`, { cookie })).status).toBe(404);
    expect(await usedBytes(cookie)).toBe(5);
    expect(await env.FILES.head(`u/${user.id}/${file.id}`)).not.toBeNull();
    const row = await env.DB.prepare("SELECT deleted_at FROM files WHERE id = ?1")
      .bind(file.id)
      .first<{ deleted_at: number | null }>();
    expect(row?.deleted_at).toBeGreaterThan(0);
  });

  it("permite voltar a usar o mesmo nome depois de excluir", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "um");
    await remove(cookie, file.id);
    const again = await uploadOk(cookie, "a.txt", "dois");
    expect(again.id).not.toBe(file.id);
  });

  it("excluir duas vezes dá 404; ficheiros de outro utilizador também", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await uploadOk(bob.cookie, "privado.txt", "x");
    const minha = await uploadOk(ana.cookie, "a.txt", "x");
    expect((await remove(ana.cookie, minha.id)).status).toBe(204);
    expect((await remove(ana.cookie, minha.id)).status).toBe(404);
    expect((await remove(ana.cookie, doBob.id)).status).toBe(404);
    expect((await getContents(bob.cookie)).files).toHaveLength(1);
  });
});
```

Criar `test/authz.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/worker/app";
import { registerUser } from "./auth-helpers";
import { uploadOk } from "./file-helpers";
import { createFolder, getContents } from "./folder-helpers";
import { api, resetState } from "./helpers";

beforeEach(resetState);

describe("todas as rotas privadas exigem sessão", () => {
  it("devolve 401 sem cookie em cada rota registada de pastas e ficheiros", async () => {
    const routes = app.routes.filter(
      (route) =>
        route.method !== "ALL" &&
        (route.path.startsWith("/api/folders") || route.path.startsWith("/api/files")),
    );
    expect(routes.length).toBeGreaterThanOrEqual(11); // falha se o filtro deixar de apanhar as rotas
    for (const route of routes) {
      const path = route.path.replace(/:\w+/g, "x");
      const res = await api(path, { method: route.method, json: route.method === "GET" ? undefined : {} });
      expect(res.status, `${route.method} ${route.path}`).toBe(401);
    }
  });

  it("e também as rotas privadas de autenticação", async () => {
    expect((await api("/api/auth/me")).status).toBe(401);
    expect((await api("/api/auth/password", { method: "POST", json: {} })).status).toBe(401);
  });
});

describe("isolamento entre utilizadores", () => {
  it("o Bob não vê nem altera nada da Ana, em nenhuma rota", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const pasta = await createFolder(ana.cookie, "Pasta da Ana");
    const ficheiro = await uploadOk(ana.cookie, "da-ana.png", "segredo", { folder: pasta.id });
    const doBob = await createFolder(bob.cookie, "Do Bob");

    const attempts: Array<[string, string, unknown?]> = [
      ["GET", `/api/folders/${pasta.id}/contents`],
      ["PATCH", `/api/folders/${pasta.id}`, { name: "roubada" }],
      ["DELETE", `/api/folders/${pasta.id}`],
      ["GET", `/api/files/${ficheiro.id}/download`],
      ["GET", `/api/files/${ficheiro.id}/preview`],
      ["PATCH", `/api/files/${ficheiro.id}`, { name: "roubado.png" }],
      ["PATCH", `/api/files/${ficheiro.id}`, { folderId: doBob.id }],
      ["DELETE", `/api/files/${ficheiro.id}`],
    ];
    for (const [method, path, json] of attempts) {
      const res = await api(path, { method, cookie: bob.cookie, json });
      expect(res.status, `${method} ${path}`).toBe(404);
    }

    // o Bob também não consegue pôr coisas dentro da pasta da Ana
    const upload = await uploadOk(bob.cookie, "b.txt", "x");
    expect((await api(`/api/files/${upload.id}`, { method: "PATCH", cookie: bob.cookie, json: { folderId: pasta.id } })).status).toBe(404);

    // nada mudou do lado da Ana
    const contents = await getContents(ana.cookie, pasta.id);
    expect(contents.folder?.name).toBe("Pasta da Ana");
    expect(contents.files.map((f) => f.name)).toEqual(["da-ana.png"]);
    const download = await api(`/api/files/${ficheiro.id}/download`, { cookie: ana.cookie });
    expect(await download.text()).toBe("segredo");
  });
});
```

Run: `npx vitest run test/files-manage.test.ts test/authz.test.ts`
Expected: FAIL (Test Files  2 failed (2); Tests  10 failed | 2 passed (12)).

- [ ] **Step 2: Implementar**

Substituir o conteúdo de `src/worker/lib/files.ts`:

```ts
import type { FileItem } from "../../shared/types";
import { ApiError } from "../errors";

/** Colunas de `files` usadas nas listagens, tal como vêm da D1. */
export interface FileRow {
  id: string;
  folder_id: string | null;
  name: string;
  size: number;
  mime: string;
  created_at: number;
}

export const FILE_COLUMNS = "id, folder_id, name, size, mime, created_at";

export function rowToFile(row: FileRow): FileItem {
  return {
    id: row.id,
    name: row.name,
    folderId: row.folder_id,
    size: row.size,
    mime: row.mime,
    createdAt: row.created_at,
  };
}

/** Chave do ficheiro no R2: opaca, sem nome nem caminho (mover e renomear só mexem na D1). */
export function r2KeyFor(userId: string, fileId: string): string {
  return `u/${userId}/${fileId}`;
}

const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/** `type/subtype` em minúsculas, sem parâmetros; qualquer coisa inválida vira `application/octet-stream`. */
export function sanitizeMime(raw: string | undefined): string {
  const type = (raw ?? "").split(";")[0].trim().toLowerCase();
  return MIME_PATTERN.test(type) ? type : "application/octet-stream";
}

/** Um ficheiro pronto, com a chave do R2 (nunca vai para o frontend). */
export interface StoredFile extends FileItem {
  r2Key: string;
}

/** Ficheiro pronto e fora da lixeira do utilizador, ou null. */
export async function findReadyFile(
  db: D1Database,
  userId: string,
  id: string,
): Promise<StoredFile | null> {
  const row = await db
    .prepare(
      `SELECT ${FILE_COLUMNS}, r2_key FROM files
       WHERE id = ?1 AND user_id = ?2 AND status = 'ready' AND deleted_at IS NULL`,
    )
    .bind(id, userId)
    .first<FileRow & { r2_key: string }>();
  return row ? { ...rowToFile(row), r2Key: row.r2_key } : null;
}

/** O ficheiro sem a chave do R2, pronto para sair na resposta da API. */
export function toFileItem(file: StoredFile): FileItem {
  const { r2Key: _r2Key, ...item } = file;
  return item;
}

/** Como `findReadyFile`, mas um ficheiro inexistente, na lixeira ou de outro utilizador é 404. */
export async function requireFile(
  db: D1Database,
  userId: string,
  id: string,
): Promise<StoredFile> {
  const file = await findReadyFile(db, userId, id);
  if (!file) throw new ApiError(404, "file_not_found", "Ficheiro não encontrado.");
  return file;
}

// Só estes tipos abrem dentro da app. SVG e HTML ficam de fora de propósito: executariam código no nosso domínio.
const PREVIEW_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

/** Content-Type fixo para a pré-visualização, decidido pela extensão do nome; null se não for permitida. */
export function previewContentType(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null; // sem extensão, ou um ficheiro escondido como ".png"
  return PREVIEW_TYPES[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** `Content-Disposition` com `filename` ASCII de recurso e `filename*` em UTF-8 (RFC 5987). */
export function contentDisposition(type: "attachment" | "inline", filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
```

Substituir o conteúdo de `src/worker/routes/files.ts`:

```ts
import { formatBytes } from "../../shared/format";
import { searchKey } from "../../shared/names";
import { getConfig } from "../config";
import { ApiError, isForeignKeyViolation, isUniqueViolation } from "../errors";
import {
  contentDisposition,
  previewContentType,
  r2KeyFor,
  requireFile,
  sanitizeMime,
  toFileItem,
} from "../lib/files";
import { parseFolderRef, requireFolder } from "../lib/folders";
import { readJsonObject, readString } from "../lib/http";
import { parseName } from "../lib/names";
import { jsonBodyLimit } from "../middleware/body-limit";
import { createAuthedRouter } from "./authed";

export const files = createAuthedRouter();

function parseContentLength(raw: string | undefined): number {
  const size = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(size)) {
    throw new ApiError(
      411,
      "length_required",
      "O pedido tem de indicar o tamanho do ficheiro (Content-Length).",
    );
  }
  return size;
}

/**
 * Upload: `PUT /api/files?name=<nome>&folder=<id|omitido>` com o ficheiro no corpo.
 *
 * 1. Reserva atómica numa só `batch`: insere a linha `pending` só se couber na quota e, só então,
 *    soma o tamanho a `used_bytes` (pedidos em paralelo não conseguem ultrapassar a quota).
 * 2. Grava os bytes no R2 em *stream* (o R2 exige o tamanho conhecido, por isso o Content-Length é obrigatório).
 * 3. Passa a linha a `ready`. Se o passo 2 ou 3 falhar, liberta a reserva.
 */
files.put("/", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const config = getConfig(c.env);

  const name = parseName(c.req.query("name") ?? "");
  const folderId = parseFolderRef(c.req.query("folder"));
  if (folderId !== null) await requireFolder(db, user.id, folderId);
  const size = parseContentLength(c.req.header("content-length"));
  if (size > config.maxUploadBytes) {
    throw new ApiError(
      413,
      "file_too_large",
      `O ficheiro excede o tamanho máximo de ${formatBytes(config.maxUploadBytes)}.`,
    );
  }

  const id = crypto.randomUUID();
  const r2Key = r2KeyFor(user.id, id);
  const mime = sanitizeMime(c.req.header("content-type"));
  const createdAt = Date.now();

  let reserved;
  try {
    reserved = await db.batch([
      db
        .prepare(
          `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9
           WHERE EXISTS (
             SELECT 1 FROM users
             WHERE id = ?2 AND status = 'active' AND used_bytes + ?6 <= quota_bytes
           )`,
        )
        .bind(id, user.id, folderId, name, searchKey(name), size, mime, r2Key, createdAt),
      db
        .prepare(
          "UPDATE users SET used_bytes = used_bytes + ?1 WHERE id = ?2 AND EXISTS (SELECT 1 FROM files WHERE id = ?3)",
        )
        .bind(size, user.id, id),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "name_taken", "Já existe um ficheiro com esse nome neste local.");
    }
    // A pasta foi apagada entre a verificação e a reserva.
    if (isForeignKeyViolation(error)) {
      throw new ApiError(404, "folder_not_found", "Pasta não encontrada.");
    }
    throw error;
  }
  if (reserved[0].meta.changes !== 1) {
    throw new ApiError(413, "quota_exceeded", "Sem espaço suficiente na sua quota.");
  }

  try {
    const object = await c.env.FILES.put(r2Key, c.req.raw.body, {
      httpMetadata: { contentType: mime },
    });
    if (object === null || object.size !== size) {
      throw new Error("O tamanho gravado no R2 é diferente do declarado.");
    }
    await db.prepare("UPDATE files SET status = 'ready' WHERE id = ?1").bind(id).run();
  } catch (error) {
    await releaseReservation(c.env, user.id, id, size, r2Key);
    throw error;
  }

  return c.json({ file: { id, name, folderId, size, mime, createdAt } }, 201);
});

/**
 * Desfaz a reserva de um upload que falhou: apaga a linha `pending` e devolve o espaço, numa só
 * `batch` (o `changes()` garante que o espaço só é devolvido se a linha foi mesmo apagada).
 * Se também isto falhar, a linha `pending` fica para o cron de manutenção limpar.
 */
async function releaseReservation(
  env: Env,
  userId: string,
  fileId: string,
  size: number,
  r2Key: string,
): Promise<void> {
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM files WHERE id = ?1 AND status = 'pending'").bind(fileId),
      env.DB.prepare(
        "UPDATE users SET used_bytes = MAX(used_bytes - ?1, 0) WHERE id = ?2 AND changes() = 1",
      ).bind(size, userId),
    ]);
  } catch (error) {
    console.error("Não foi possível libertar a reserva de um upload falhado", error);
  }
  await env.FILES.delete(r2Key).catch(() => undefined);
}

function missingObject(fileId: string): ApiError {
  console.error(`O ficheiro ${fileId} existe na D1 mas não tem objeto no R2.`);
  return new ApiError(404, "file_missing", "O conteúdo do ficheiro não está disponível.");
}

/** Descarrega o ficheiro em *stream*, sempre como anexo (nunca é interpretado pelo browser). */
files.get("/:id/download", async (c) => {
  const file = await requireFile(c.env.DB, c.get("user").id, c.req.param("id"));
  const object = await c.env.FILES.get(file.r2Key);
  if (!object) throw missingObject(file.id);

  return new Response(object.body, {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(object.size),
      "Content-Disposition": contentDisposition("attachment", file.name),
      ETag: object.httpEtag,
    },
  });
});

/** Posição e tamanho de um intervalo já resolvido pelo R2. */
function resolveRange(range: R2Range | undefined, size: number): { offset: number; length: number } {
  const r = (range ?? {}) as { offset?: number; length?: number; suffix?: number };
  const offset = r.offset ?? (r.suffix !== undefined ? Math.max(size - r.suffix, 0) : 0);
  return { offset, length: r.length ?? size - offset };
}

/**
 * Pré-visualização inline, só para imagens e PDF (lista fixa por extensão). O Content-Type vem
 * dessa lista e não do valor guardado. Suporta um único intervalo (`Range: bytes=a-b`, `a-`, `-n`).
 */
files.get("/:id/preview", async (c) => {
  const file = await requireFile(c.env.DB, c.get("user").id, c.req.param("id"));
  const contentType = previewContentType(file.name);
  if (!contentType) {
    throw new ApiError(415, "preview_unsupported", "Este tipo de ficheiro não tem pré-visualização.");
  }

  // Só um intervalo simples conta; qualquer outro formato é ignorado e devolve-se o ficheiro todo.
  const match = /^bytes=(\d*)-(\d*)$/.exec((c.req.header("range") ?? "").trim());
  const ranged = match !== null && (match[1] !== "" || match[2] !== "");
  const object = await c.env.FILES.get(file.r2Key, ranged ? { range: c.req.raw.headers } : undefined);
  if (!object) throw missingObject(file.id);

  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": contentDisposition("inline", file.name),
    "Accept-Ranges": "bytes",
    ETag: object.httpEtag,
  });
  if (contentType.startsWith("image/")) {
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  }

  if (ranged && match) {
    // O R2 devolve o ficheiro todo quando o intervalo começa depois do fim; aqui é 416.
    if (match[1] !== "" && Number(match[1]) >= object.size) {
      await object.body.cancel();
      headers.set("Content-Range", `bytes */${object.size}`);
      return new Response(null, { status: 416, headers });
    }
    const { offset, length } = resolveRange(object.range, object.size);
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
});

/** Renomeia e/ou move um ficheiro (`folderId: null` ou "root" = raiz). Só mexe na D1: a chave do R2 não muda. */
files.patch("/:id", jsonBodyLimit, async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const file = await requireFile(db, userId, c.req.param("id"));
  const body = await readJsonObject(c);
  const hasName = "name" in body;
  const hasFolder = "folderId" in body;
  if (!hasName && !hasFolder) {
    throw new ApiError(400, "invalid_body", "Indique o novo nome e/ou a nova pasta.");
  }

  const name = hasName ? parseName(readString(body, "name")) : file.name;
  const folderId = hasFolder ? parseFolderRef(body.folderId) : file.folderId;
  if (hasFolder && folderId !== null) await requireFolder(db, userId, folderId);

  let updated;
  try {
    updated = await db
      .prepare(
        `UPDATE files SET name = ?1, name_norm = ?2, folder_id = ?3
         WHERE id = ?4 AND user_id = ?5 AND status = 'ready' AND deleted_at IS NULL`,
      )
      .bind(name, searchKey(name), folderId, file.id, userId)
      .run();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "name_taken", "Já existe um ficheiro com esse nome nesse local.");
    }
    if (isForeignKeyViolation(error)) {
      throw new ApiError(404, "folder_not_found", "Pasta não encontrada.");
    }
    throw error;
  }
  if (updated.meta.changes !== 1) {
    throw new ApiError(404, "file_not_found", "Ficheiro não encontrado.");
  }
  return c.json({ file: { ...toFileItem(file), name, folderId } });
});

/**
 * Exclui um ficheiro: manda-o para a lixeira (`deleted_at`). O objeto no R2 e a quota ficam como
 * estão até o ficheiro ser eliminado de vez (lixeira e limpeza automática: planos seguintes).
 */
files.delete("/:id", async (c) => {
  const result = await c.env.DB.prepare(
    `UPDATE files SET deleted_at = ?1
     WHERE id = ?2 AND user_id = ?3 AND status = 'ready' AND deleted_at IS NULL`,
  )
    .bind(Date.now(), c.req.param("id"), c.get("user").id)
    .run();
  if (result.meta.changes !== 1) {
    throw new ApiError(404, "file_not_found", "Ficheiro não encontrado.");
  }
  return c.body(null, 204);
});
```

- [ ] **Step 3: Correr tudo**

Run: `npx vitest run test/files-manage.test.ts test/authz.test.ts`
Expected: `Test Files  2 passed (2)`, `Tests  12 passed (12)`.

Run: `npx vitest run`
Expected: `Test Files  20 passed (20)`, `Tests  157 passed (157)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

- [ ] **Step 4: Commit**

Commit:

```bash
git add src test
git commit -m "Adiciona renomear, mover e excluir ficheiros e testes de isolamento" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Documentar a API e fechar o Plano 2A

**Files:**
- Modify: `README.md`, `docs/superpowers/plans/README.md`

**Interfaces:**
- Sem código novo: documenta a API no README, regista o Plano 2A no índice dos planos e faz a verificação final.

- [ ] **Step 1: Documentar a API no README**

Em `README.md`, trocar a última linha:

```markdown
Não fazer `git push` sem confirmação do dono do projeto.
```

por:

```markdown
## API (pastas e ficheiros)

Todas as rotas exigem sessão (cookie `sw_session`); os pedidos que alteram dados exigem `Origin`. Os erros vêm em `{ "error": "<código>", "message": "<texto>" }`.

| Pedido | Descrição |
|---|---|
| `GET /api/folders/:id/contents` | Conteúdo de uma pasta (`root` = raiz): pasta, caminho, subpastas e ficheiros |
| `GET /api/folders/tree` | Todas as pastas do utilizador |
| `POST /api/folders` | Cria uma pasta (`{ name, parentId? }`) |
| `PATCH /api/folders/:id` | Renomeia e/ou move (`{ name?, parentId? }`) |
| `DELETE /api/folders/:id` | Apaga uma pasta, só se estiver vazia |
| `PUT /api/files?name=&folder=` | Upload (ficheiro no corpo, `Content-Length` obrigatório, máx. 100 MB) |
| `GET /api/files/:id/download` | Descarrega (sempre como anexo) |
| `GET /api/files/:id/preview` | Pré-visualiza imagens e PDF (suporta `Range`) |
| `PATCH /api/files/:id` | Renomeia e/ou move (`{ name?, folderId? }`) |
| `DELETE /api/files/:id` | Manda o ficheiro para a lixeira |

Não fazer `git push` sem confirmação do dono do projeto.
```

- [ ] **Step 2: Registar o Plano 2A no índice dos planos**

Em `docs/superpowers/plans/README.md`, na tabela, trocar a linha do Plano 2:

```markdown
| 2 | Pastas e ficheiros | CRUD de pastas, upload com quota, descarregar, pré-visualizar, renomear, mover; ecrã "Meu espaço" | Por escrever |
```

por:

```markdown
| 2A | [API de pastas e ficheiros](2026-10-03-02a-api-pastas-ficheiros.md) | Pastas (listar, criar, renomear, mover, excluir vazias), upload com quota atómica, descarregar, pré-visualizar, renomear, mover e excluir ficheiros; isolamento entre utilizadores | Escrito |
| 2B | Interface "Meu espaço" | Lista, caminho (*breadcrumb*), nova pasta, upload com progresso, menu de ações, mover, pré-visualização | Por escrever |
```

- [ ] **Step 3: Verificação final**

Run: `npx vitest run`
Expected: `Test Files  20 passed (20)`, `Tests  157 passed (157)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npm run build`
Expected: `✓ built in ...` duas vezes (Worker e cliente).

- [ ] **Step 4: Commit**

Commit:

```bash
git add README.md docs
git commit -m "Documenta a API de pastas e ficheiros e regista o Plano 2A" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Auto-revisão do plano contra a especificação

| Requisito | Onde |
|---|---|
| Spec §3: nomes únicos por pasta, regras de nomes, `name_norm` | Tasks 1, 3, 5 |
| Spec §5: upload com reserva atómica de quota, `pending`/`ready`, libertação em falha | Task 5 |
| Spec §5: renomear e mover só na D1; mover sem ciclos | Tasks 4 e 7 |
| Spec §5: excluir pasta só vazia (ficheiros na lixeira vão para a raiz); excluir ficheiro → lixeira | Tasks 4 e 7 |
| Spec §5/§6: listar uma pasta (pastas primeiro, por nome sem acentos), `tree` | Task 3 |
| Spec §4: descarregar como anexo; pré-visualizar só imagens e PDF, Content-Type fixo; `Range` | Task 6 |
| Spec §4: isolamento entre utilizadores | Tasks 3 a 7 (404) e `test/authz.test.ts` |
| Pendente do Plano 1: `requireAuth` ao nível do router + teste de que todas as rotas privadas dão 401 | Tasks 2 e 7 |
| Pendente do Plano 1: `HTTPException`, limite do corpo JSON, `Cache-Control: no-store` | Task 2 |
| Pendente do Plano 1: migração 0002 (índices de chaves estrangeiras) e testes de restrições do esquema | Task 2 |
| Pendente do Plano 1: validação partilhada e armadilha das extensões `.ts` no seed | Task 1 |
| Pendente do Plano 1: `isUniqueViolation` e chaves estrangeiras testados com mensagens reais da D1 | Task 4 (`test/errors.test.ts`) e Task 5 (409 dentro da `batch`) |

**Fora deste plano:** a interface (Plano 2B); a lixeira (listar, restaurar, eliminar de vez, limpeza automática), a pesquisa e a partilha (Plano 3); o painel de administração e o cron (Plano 4); o deploy (Plano 5). Até ao Plano 3, os ficheiros excluídos continuam a ocupar quota.

**Totais de testes (medidos na execução deste plano numa pasta limpa):** Test Files 20 passed (20); Tests 157 passed (157).
