# SpaceWork — Plano 4: administração de contas e manutenção por cron (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao master a gestão das contas (listar, mudar a quota, suspender, reativar e apagar) e pôr a manutenção a correr sozinha de hora a hora: elimina a lixeira expirada, os envios que ficaram a meio, as contas apagadas (ficheiros no R2 e linhas na D1) e o lixo de sessões, falhas de login e links velhos. Fecha também os pendentes do Plano 1 a 3 que eram deste plano.

**Architecture:** A API do admin é um router novo (`routes/admin.ts`) atrás de `requireAuth` e de um `requireAdmin`; só gere contas e quotas (um teste fixa a lista de rotas: nenhuma lê ficheiros alheios). Apagar uma conta só a põe em `deleting` (e termina as sessões): quem a remove é o cron. O cron (`cron.ts`, gatilho `scheduled` do Worker) tem quatro passos isolados (lixeira, envios pendentes, contas em remoção, limpeza), cada um idempotente e em lotes que cabem nos 50 subpedidos de uma invocação do plano gratuito; a eliminação de ficheiros é uma só função (`lib/purge.ts`) que serve o utilizador (esvaziar a lixeira) e a manutenção (vários donos). A interface acrescenta `/admin` (tabela de contas e o menu «⋮» com os diálogos), sobre o mesmo padrão de hooks do TanStack Query dos planos anteriores.

**Tech Stack:** o dos planos anteriores (Hono, D1, R2, React 19, React Router 8, TanStack Query 5, Tailwind 4, Vitest `^4.1`); nenhuma dependência nova.

**Spec:** [docs/superpowers/specs/2026-10-03-spacework-design.md](../specs/2026-10-03-spacework-design.md) (secção 6, rotas do admin; secção 7, cron de manutenção; secção 8, `/admin`). Índice dos planos: [README.md](README.md). Este plano trata também dos pendentes do Plano 4 do índice (secção «Pendentes herdados»).

## Global Constraints

Valores da especificação e dos planos anteriores; todas as tarefas os cumprem implicitamente.

- Interface em português europeu; as mensagens de erro da API já vêm em português e a interface mostra o `message` tal como vem.
- Só `role = admin` acede a `/api/admin/*` (403 `forbidden`). As rotas do admin gerem contas e quotas e **nada mais**: nenhuma rota vê ou descarrega ficheiros alheios, nem repõe senhas. Uma conta de administrador não se suspende nem se apaga (403 `admin_protected`; a quota pode mudar-se) e uma conta em remoção não se altera (409 `account_deleting`).
- A quota é um inteiro de bytes entre 0 e 2^50 (`MAX_QUOTA_BYTES`, 1 PiB; `isValidQuota`). Na API o campo é `quotaBytes` (a coluna da D1 é `quota_bytes`). Baixar a quota abaixo do uso só impede novos uploads.
- Suspender uma conta apaga as sessões dela **na mesma `batch`** do `UPDATE` (o filtro por `status` da autenticação não chega: ao reativar, as sessões antigas voltariam a valer). Apagar uma conta põe-na em `deleting` e termina as sessões; **o email continua ocupado até o cron a remover** (registar-se com ele dá 409).
- O cron é `0 * * * *`. Cada execução é idempotente e trabalha em lotes limitados: o plano gratuito dá **50 subpedidos por invocação** e cada chamada à D1 ou ao R2 conta (no pior caso: lixeira 13, envios pendentes 7, contas em remoção 11, limpeza 1, ou seja, 32). Cada passo falha sozinho (os outros correm na mesma, o erro vai para `report.errors`) e a execução termina com erro se algum falhou.
- Limites da D1 que o código respeita: no máximo 100 parâmetros por instrução (os blocos de `IN (...)` são de `PURGE_BATCH` = 50 ids mais o dono) e 100 KB de SQL; `batch()` é transacional. O R2 apaga até 1000 chaves por chamada.
- A remoção de uma conta apaga **primeiro** os objetos do R2 (pelo prefixo `u/<userId>/`, que apanha também os órfãos) e só depois as linhas da D1, filhos primeiro (partilhas, ficheiros, pastas, sessões, utilizador): se as linhas saíssem primeiro e o R2 falhasse, os objetos ficavam sem dono para sempre.
- Os testes do Worker correm no runtime Workers (`npx vitest run`); os da interface em jsdom (`npx vitest run -c vitest.web.config.ts`) e mostram só o resumo do Vitest: qualquer outra saída (avisos de `act`, `console.error`) é um defeito do teste a corrigir. Um teste que espera por um temporizador usa relógios reais com um intervalo curto, nunca `vi.useFakeTimers`.
- IDs `crypto.randomUUID()`; datas em milissegundos Unix. Vitest `^4.1`.
- **Nenhum `git push` sem confirmação explícita do utilizador.** Nenhuma credencial real em ficheiros, commits ou testes: o guião de verificação manual usa contas fictícias (`*@example.test`) numa base local limpa.

## Ambiente

- Node 24 e npm 11; todos os comandos correm na raiz do repositório (`~/Developer/SpaceWork`, fora do iCloud). Ramo de trabalho: `plano-4-admin-cron`.
- Commits: mensagem curta em português; cada commit termina com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (nos comandos abaixo, é o segundo `-m`). Escrever **exatamente** esse trailer, "Claude Sonnet 5.5", mesmo que o modelo que executa seja outro.
- As Tasks 1 a 5 tocam no Worker (`npx vitest run`); as Tasks 6 e 7 são da interface (`npx vitest run -c vitest.web.config.ts`); a Task 8 é documentação e a verificação final.
- A Task 8 traz um guião de verificação manual com contas **fictícias** numa base local limpa (apagar `.wrangler` no fim). Nunca se usam as credenciais do utilizador master, nem se escrevem em ficheiros.

## Estrutura de ficheiros deste plano

```
migrations/0003_maintenance_indexes.sql     índices parciais das varreduras do cron
wrangler.jsonc                              triggers.crons: ["0 * * * *"]
src/shared/types.ts                         + AdminUser
src/shared/validation.ts                    + MAX_QUOTA_BYTES, isValidQuota
src/worker/index.ts                         + scheduled (corre scheduledMaintenance)
src/worker/cron.ts                          runMaintenance, scheduledMaintenance (4 passos isolados)
src/worker/lib/purge.ts                     (era trash.ts) purgeFiles: purgeTrashed, purgeExpiredTrash, purgeStalePending
src/worker/lib/account-removal.ts           removeDeletingAccounts: R2 por prefixo e depois as linhas da D1
src/worker/lib/sessions.ts                  + deleteUserSessionsStatement
src/worker/routes/auth.ts                   troca de senha numa só batch
src/worker/routes/files.ts                  o upload só passa a `ready` se ainda estiver `pending` (409 upload_expired)
src/worker/routes/trash.ts                  usa lib/purge.ts; sem escrita inútil no 404
src/worker/routes/admin.ts                  GET/PATCH/DELETE /api/admin/users
src/worker/middleware/admin.ts              requireAdmin
src/worker/app.ts                           monta /api/admin
src/web/admin.ts                            useAdminUsers, useUpdateUser, useDeleteUser, parseQuotaGb, quotaToGbText
src/web/pages/AdminPage.tsx                 /admin: a tabela de contas
src/web/components/UserActions.tsx          o menu «⋮» de cada conta e os diálogos
src/web/components/QuotaDialog.tsx          alterar a quota em GB
src/web/components/UsageBar.tsx             + label
src/web/components/AppLayout.tsx            ligação «Admin» (só administradores)
src/web/App.tsx                             rota /admin
test/                                       cron, purge, account-removal, admin, upload-expired + ajudantes (insertUser, registerAdmin, seedFiles, dbFailingOn, envCountingSubrequests)
```

---


### Task 1: Arrumações no Worker de que a manutenção precisa: troca de senha atómica, envio que perdeu a reserva e índices das varreduras

**Files:**
- Create: `migrations/0003_maintenance_indexes.sql`, `test/upload-expired.test.ts`
- Modify: `src/worker/lib/sessions.ts`, `src/worker/routes/auth.ts`, `src/worker/routes/files.ts`
- Modify: `test/auth-logout-password.test.ts`, `test/file-helpers.ts`, `test/files-upload.test.ts`, `test/schema.test.ts`

**Interfaces:**
- Consumes: `registerUser`, `login`, `sessionCookie`, `dbWithBatchHook`, `dbWithStatementHook`, `fetchWithEnv`, `releaseReservation` (Planos anteriores).
- Produces: `deleteUserSessionsStatement(db, userId, exceptTokenHash?)` em `src/worker/lib/sessions.ts` (a Task 5 junta-a a outras escritas numa `batch`);
  `rawUpload(name, body, cookie, override, lengthHeader?)` em `test/file-helpers.ts` (movido de `files-upload.test.ts`); a resposta `409 upload_expired`;
  a migração `0003` com os índices que as consultas do cron (Tasks 3 e 4) usam.

- [ ] **Step 1: Trocar a senha e terminar as outras sessões numa só `batch` (teste primeiro)**

Pendente do Plano 1. Hoje a senha nova e o fim das outras sessões são duas escritas: se a segunda falhar, uma sessão roubada continua viva com a senha já trocada. A Task 5 também precisa de juntar «apagar as sessões» a outras escritas (suspender e apagar contas), por isso `lib/sessions.ts` passa a devolver a *instrução* (`deleteUserSessionsStatement`) em vez de a executar; a função antiga só tinha este utilizador.

Em `test/auth-logout-password.test.ts`, nos `import`, trocar:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { login, registerUser } from "./auth-helpers";
import { api, resetDb, sessionCookie } from "./helpers";
```

por:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { login, registerUser } from "./auth-helpers";
import { dbWithBatchHook, fetchWithEnv } from "./db-helpers";
import { api, buildRequest, resetDb, sessionCookie } from "./helpers";
```

Acrescentar ao fim de `test/auth-logout-password.test.ts`:

```ts
describe("POST /api/auth/password: atomicidade", () => {
  it("troca a senha e termina as outras sessões numa só batch, e a sessão atual continua", async () => {
    const { cookie } = await registerUser("ana@example.com", "senha-segura-123");
    const otherCookie = sessionCookie(await login("ana@example.com", "senha-segura-123"));
    expect(otherCookie).not.toBeNull();
    const batches: number[] = [];
    const db = dbWithBatchHook(async (call, runReal) => {
      batches.push(call);
      return runReal();
    });

    const res = await fetchWithEnv(
      buildRequest("/api/auth/password", {
        method: "POST",
        cookie,
        json: { currentPassword: "senha-segura-123", newPassword: "senha-nova-456" },
      }),
      { DB: db },
    );

    expect(res.status).toBe(204);
    expect(batches).toEqual([1]); // uma só batch: as duas escritas ficam ou não ficam juntas
    expect((await api("/api/auth/me", { cookie: otherCookie! })).status).toBe(401);
    expect((await api("/api/auth/me", { cookie })).status).toBe(200);
    expect((await login("ana@example.com", "senha-nova-456")).status).toBe(200);
  });
});
```

Run: `npx vitest run test/auth-logout-password.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  1 failed | 7 passed (8)).

Em `src/worker/lib/sessions.ts`, trocar:

```ts
/** Apaga as sessões de um utilizador, exceto (opcionalmente) a indicada. */
export async function deleteUserSessions(
  db: D1Database,
  userId: string,
  exceptTokenHash = "",
): Promise<void> {
  await db
    .prepare("DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2")
    .bind(userId, exceptTokenHash)
    .run();
}
```

por:

```ts
/**
 * A instrução que apaga as sessões de um utilizador, exceto (opcionalmente) a indicada. Devolve-se a instrução, sem a executar, para
 * se juntar a outras escritas na mesma `batch` (trocar a senha, suspender ou apagar uma conta): ou ficam todas, ou nenhuma.
 */
export function deleteUserSessionsStatement(
  db: D1Database,
  userId: string,
  exceptTokenHash = "",
): D1PreparedStatement {
  return db.prepare("DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2").bind(userId, exceptTokenHash);
}
```

Em `src/worker/routes/auth.ts`, nos `import`, trocar:

```ts
import { createSession, deleteSessionByHash, deleteUserSessions } from "../lib/sessions";
```

por:

```ts
import { createSession, deleteSessionByHash, deleteUserSessionsStatement } from "../lib/sessions";
```

Na rota `POST /password`, trocar:

```ts
  await db
    .prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2")
    .bind(await hashPassword(newPassword), user.id)
    .run();
  await deleteUserSessions(db, user.id, c.get("sessionTokenHash"));
  return c.body(null, 204);
```

por:

```ts
  // A senha nova e o fim das outras sessões ficam ou não ficam juntos: com duas escritas, se a segunda falhasse,
  // uma sessão roubada continuava viva com a senha já trocada.
  await db.batch([
    db.prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2").bind(await hashPassword(newPassword), user.id),
    deleteUserSessionsStatement(db, user.id, c.get("sessionTokenHash")),
  ]);
  return c.body(null, 204);
```

Run: `npx vitest run test/auth-logout-password.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  8 passed (8)`.

- [ ] **Step 2: Um envio cuja reserva desapareceu não pode responder 201 (teste primeiro)**

Pendente do Plano 2A. O cron apaga os envios `pending` com mais de uma hora (e o fim de uma conta apaga tudo o que é dela). Se o envio acabar a seguir, o `UPDATE ... 'ready'` não encontra a linha (`changes() = 0`), mas o código atual ignora-o: responde 201 com um ficheiro que não existe e deixa o objeto no R2 sem dono. Passa a exigir `AND status = 'pending'`, a verificar `meta.changes`, a apagar o objeto e a responder `409 upload_expired`. Para o teste, `rawUpload` (que chama a app com bindings alterados) sai de `files-upload.test.ts` para `file-helpers.ts`.

Em `test/files-upload.test.ts`, apagar a função `rawUpload` e o comentário que a antecede (passam para `test/file-helpers.ts`):

```ts
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
  return fetchWithEnv(request, override);
}
```

Nos `import`, trocar:

```ts
import { dbWithBatchHook, dbWithStatementHook, fetchWithEnv, silenceErrors } from "./db-helpers";
import { countFiles, setQuota, uploadFile, uploadOk, usedBytes } from "./file-helpers";
```

por:

```ts
import { dbWithBatchHook, dbWithStatementHook, silenceErrors } from "./db-helpers";
import { countFiles, rawUpload, setQuota, uploadFile, uploadOk, usedBytes } from "./file-helpers";
```

No mesmo ficheiro, trocar:

```ts
import { ORIGIN, api, resetState } from "./helpers";
```

por:

```ts
import { api, resetState } from "./helpers";
```

Em `test/file-helpers.ts`, nos `import`, trocar:

```ts
import { api } from "./helpers";
```

por:

```ts
import { fetchWithEnv } from "./db-helpers";
import { ORIGIN, api } from "./helpers";
```

Acrescentar ao fim de `test/file-helpers.ts`:

```ts
/**
 * Faz um upload chamando a app diretamente com bindings/variáveis alterados (o resto vem de `env`). O Content-Length tem de ser posto
 * à mão (`lengthHeader: null` omite-o).
 */
export function rawUpload(
  name: string,
  body: Uint8Array,
  cookie: string,
  override: Record<string, unknown>,
  lengthHeader: string | null = String(body.length),
): Promise<Response> {
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
  return fetchWithEnv(request, override);
}
```

Run: `npx vitest run test/files-upload.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  25 passed (25)` (é um refactor: os testes do upload têm de continuar verdes).

Criar `test/upload-expired.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { registerUser } from "./auth-helpers";
import { dbWithStatementHook } from "./db-helpers";
import { countFiles, rawUpload, usedBytes } from "./file-helpers";
import { resetState } from "./helpers";

beforeEach(resetState);

describe("PUT /api/files: a reserva desapareceu antes de o envio acabar", () => {
  it("o objeto sai do R2, a quota não fica a dever nada e a resposta é 409 upload_expired (não 201)", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    // Imediatamente antes do `UPDATE ... 'ready'`, faz o que a manutenção faz a um envio pendente velho: devolve o espaço e apaga a linha.
    const db = dbWithStatementHook(/SET status = 'ready'/, async () => {
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET used_bytes = MAX(used_bytes - 5, 0) WHERE id = ?1").bind(user.id),
        env.DB.prepare("DELETE FROM files WHERE user_id = ?1 AND status = 'pending'").bind(user.id),
      ]);
    });

    const res = await rawUpload("a.txt", new TextEncoder().encode("12345"), cookie, { DB: db });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "upload_expired" });
    expect((await env.FILES.list({ prefix: "u/" })).objects).toHaveLength(0);
    expect(await usedBytes(cookie)).toBe(0);
    expect(await countFiles()).toBe(0);
  });
});
```

Run: `npx vitest run test/upload-expired.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  1 failed (1)).

Em `src/worker/routes/files.ts`, no passo 3 do upload, trocar:

```ts
    await db.prepare("UPDATE files SET status = 'ready' WHERE id = ?1").bind(id).run();
  } catch (error) {
```

por:

```ts
    const ready = await db
      .prepare("UPDATE files SET status = 'ready' WHERE id = ?1 AND status = 'pending'")
      .bind(id)
      .run();
    // Nenhuma linha passou a `ready`: a reserva foi limpa entretanto (a manutenção apaga os envios `pending` com mais de uma hora e as
    // contas em remoção). O objeto que acabou de ser gravado ficou sem linha: apaga-se, e o envio falha em vez de dizer que correu bem.
    if (ready.meta.changes !== 1) {
      await c.env.FILES.delete(r2Key).catch((error) => console.error(`Objeto órfão no R2: ${r2Key}`, error));
      throw new ApiError(409, "upload_expired", "O envio demorou demasiado e foi cancelado. Tente de novo.");
    }
  } catch (error) {
```

No comentário da rota, trocar:

```ts
 *    ficheiro existe e nada se desfaz (ver `releaseReservation`).
```

por:

```ts
 *    ficheiro existe e nada se desfaz (ver `releaseReservation`). Se a linha já nem existe (a manutenção limpou-a),
 *    apaga o objeto e responde 409 `upload_expired`.
```

Run: `npx vitest run test/upload-expired.test.ts test/files-upload.test.ts`
Expected: `Test Files  2 passed (2)`, `Tests  26 passed (26)`.

- [ ] **Step 3: Os índices das varreduras da manutenção (teste primeiro)**

Pendentes do Plano 1 e do 3A. O cron varre `files` por `deleted_at` e por `created_at` dos envios `pending`, `login_failures` por `failed_at`, `shares` por `revoked_at` e `expires_at`, e `users` em remoção. Os índices que existem começam por `user_id` ou por `email`: sem estes, cada hora lê as tabelas inteiras. São parciais, por isso ocupam quase nada. Uma migração nova (a `0002` já foi aplicada em quem tem a base): a Task 3 confirma com `EXPLAIN QUERY PLAN` que as consultas do cron os usam.

Acrescentar ao fim de `test/schema.test.ts`:

```ts
describe("índices da manutenção (migração 0003)", () => {
  const sqlOf = async (name: string): Promise<string | undefined> =>
    (
      await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?1")
        .bind(name)
        .first<{ sql: string }>()
    )?.sql;

  it("existem, e os parciais só cobrem as linhas que a manutenção procura", async () => {
    expect(await sqlOf("files_pending_created")).toMatch(/\(created_at\) WHERE status = 'pending'/);
    expect(await sqlOf("files_trash_expiry")).toMatch(/\(deleted_at\) WHERE deleted_at IS NOT NULL/);
    expect(await sqlOf("login_failures_failed_at")).toMatch(/\(failed_at\)/);
    expect(await sqlOf("shares_revoked_at")).toMatch(/\(revoked_at\) WHERE revoked_at IS NOT NULL/);
    expect(await sqlOf("shares_expires_at")).toMatch(/\(expires_at\) WHERE expires_at IS NOT NULL/);
    expect(await sqlOf("users_deleting")).toMatch(/\(created_at\) WHERE status = 'deleting'/);
  });
});
```

Run: `npx vitest run test/schema.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  1 failed | 7 passed (8)).

Criar `migrations/0003_maintenance_indexes.sql`:

```sql
-- Índices das varreduras do cron de manutenção (src/worker/cron.ts). Os que já existiam começam por `user_id` ou por `email`: sem
-- estes, cada execução leria as tabelas inteiras. Os parciais só cobrem as linhas que a manutenção procura, por isso ocupam quase nada.

-- Envios `pending` mais velhos do que o corte.
CREATE INDEX files_pending_created ON files (created_at) WHERE status = 'pending';
-- Ficheiros na lixeira há mais do que a retenção, de todos os utilizadores (`files_trash` começa por `user_id`).
CREATE INDEX files_trash_expiry ON files (deleted_at) WHERE deleted_at IS NOT NULL;
-- Falhas de login com mais de um dia (`login_failures_email` começa pelo email).
CREATE INDEX login_failures_failed_at ON login_failures (failed_at);
-- Partilhas revogadas ou expiradas há mais de 30 dias.
CREATE INDEX shares_revoked_at ON shares (revoked_at) WHERE revoked_at IS NOT NULL;
CREATE INDEX shares_expires_at ON shares (expires_at) WHERE expires_at IS NOT NULL;
-- Contas em remoção.
CREATE INDEX users_deleting ON users (created_at) WHERE status = 'deleting';
```

Run: `npx vitest run test/schema.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  8 passed (8)`.

- [ ] **Step 4: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  32 passed (32)`, `Tests  274 passed (274)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add migrations src test
git commit -m "Faz a troca de senha numa só batch, faz falhar o envio que perdeu a reserva e acrescenta os índices das varreduras da manutenção" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Eliminar de vez para a manutenção: ficheiros de vários donos e envios pendentes

**Files:**
- Move: `src/worker/lib/trash.ts` -> `src/worker/lib/purge.ts`
- Create: `test/purge.test.ts`
- Modify: `src/worker/routes/trash.ts`, `test/file-helpers.ts`

**Interfaces:**
- Consumes: `purgeTrashed(env, userId, ids)` e `TRASH_PURGE_BATCH` (Plano 3A), `registerUser`, `dbWithBatchHook`, `dbCountingPrepares`, `silenceErrors`.
- Produces: `seedFiles(userId, files)` e `SeedFile` em `test/file-helpers.ts` (linhas de `files` com objeto no R2 e quota, para os testes da manutenção); `PURGE_BATCH` (50), `purgeTrashed(env, userId, ids)` (igual a antes), `purgeExpiredTrash(env, ids)` (qualquer dono) e `purgeStalePending(env, ids)` (envios `pending` de qualquer dono) em `src/worker/lib/purge.ts`.
  Cada chamada gasta 2 chamadas à D1 e ao R2 (uma `batch` e um `delete`), por isso o cron (Task 3) faz as contas por blocos de `PURGE_BATCH`.

- [ ] **Step 1: Testes primeiro: vários donos, tipos de linha e quota**

O cron elimina ficheiros de todos os utilizadores. `purgeTrashed` só trabalha para um dono por chamada, o que obrigava a agrupar os ficheiros expirados por utilizador (uma chamada, e duas idas à D1 e ao R2, por dono, e o limite de 50 subpedidos por execução é pequeno). A mesma `batch` (descontar a quota e apagar as linhas, com `RETURNING` para saber que objetos sair do R2) passa a aceitar um dono ou nenhum (`ownerId = null`) e um *tipo* de linha: «na lixeira» ou «envio `pending`» (que também reservou quota e tem de a devolver). A condição está escrita uma só vez e vale para as duas instruções, que por isso nunca divergem. Resolve também o pendente do 3A sobre `DELETE /api/trash/:id` com 404 a escrever em `users`: o `UPDATE` agora só alcança os donos de linhas que existem. O ficheiro `trash.ts` passa a chamar-se `purge.ts` (já não é só da lixeira).

Acrescentar ao fim de `test/file-helpers.ts`:

```ts
export interface SeedFile {
  id: string;
  size?: number;
  status?: "ready" | "pending";
  /** Na lixeira desde este instante. */
  deletedAt?: number;
  /** Criado neste instante (por defeito 1, ou seja, há muito tempo). */
  createdAt?: number;
}

/** Insere linhas em `files` com o objeto no R2 e soma os tamanhos à quota do dono (como o upload e a lixeira deixam o estado). */
export async function seedFiles(userId: string, files: SeedFile[]): Promise<void> {
  await env.DB.batch([
    ...files.map((file) =>
      env.DB.prepare(
        `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at, deleted_at)
         VALUES (?1, ?2, NULL, ?1, ?1, ?3, 'text/plain', ?4, ?5, ?7, ?6)`,
      ).bind(
        file.id,
        userId,
        file.size ?? 10,
        `u/${userId}/${file.id}`,
        file.status ?? "ready",
        file.deletedAt ?? null,
        file.createdAt ?? 1,
      ),
    ),
    env.DB.prepare("UPDATE users SET used_bytes = used_bytes + ?1 WHERE id = ?2").bind(
      files.reduce((sum, file) => sum + (file.size ?? 10), 0),
      userId,
    ),
  ]);
  await Promise.all(files.map((file) => env.FILES.put(`u/${userId}/${file.id}`, "x")));
}
```

Criar `test/purge.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PURGE_BATCH, purgeExpiredTrash, purgeStalePending, purgeTrashed } from "../src/worker/lib/purge";
import { registerUser } from "./auth-helpers";
import { dbCountingPrepares, dbWithBatchHook, silenceErrors } from "./db-helpers";
import { seedFiles } from "./file-helpers";
import { resetState } from "./helpers";

beforeEach(resetState);
afterEach(() => vi.restoreAllMocks());

const used = async (userId: string): Promise<number> =>
  (await env.DB.prepare("SELECT used_bytes AS n FROM users WHERE id = ?1").bind(userId).first<{ n: number }>())!.n;
const rowExists = async (id: string): Promise<boolean> =>
  (await env.DB.prepare("SELECT 1 AS n FROM files WHERE id = ?1").bind(id).first()) !== null;
const objectExists = async (userId: string, id: string): Promise<boolean> =>
  (await env.FILES.head(`u/${userId}/${id}`)) !== null;

describe("purgeExpiredTrash (de qualquer dono)", () => {
  it("elimina ficheiros de vários donos numa só chamada e desconta a quota de cada um", async () => {
    const ana = (await registerUser("ana@example.com")).user;
    const bob = (await registerUser("bob@example.com")).user;
    const eva = (await registerUser("eva@example.com")).user;
    await seedFiles(ana.id, [{ id: "a1", size: 30, deletedAt: 5 }, { id: "a2", size: 20, deletedAt: 5 }, { id: "a3", size: 7 }]);
    await seedFiles(bob.id, [{ id: "b1", size: 100, deletedAt: 5 }]);
    await seedFiles(eva.id, [{ id: "e1", size: 40, deletedAt: 5 }]);

    const purged = await purgeExpiredTrash(env, ["a1", "a2", "b1"]);

    expect(purged).toBe(3);
    expect(await Promise.all(["a1", "a2", "b1"].map(rowExists))).toEqual([false, false, false]);
    expect(await objectExists(ana.id, "a1")).toBe(false);
    expect(await objectExists(bob.id, "b1")).toBe(false);
    expect(await used(ana.id)).toBe(7); // 30 + 20 + 7 - 50
    expect(await used(bob.id)).toBe(0);
    expect(await used(eva.id)).toBe(40); // não estava na lista
    expect(await rowExists("e1")).toBe(true);
  });

  it("não toca no que já não está na lixeira (um ficheiro restaurado, ou que nunca lá esteve) nem na sua quota", async () => {
    const ana = (await registerUser("ana@example.com")).user;
    await seedFiles(ana.id, [{ id: "a1", size: 30 }, { id: "a2", size: 20, deletedAt: 5 }]);

    expect(await purgeExpiredTrash(env, ["a1", "a2"])).toBe(1);

    expect(await rowExists("a1")).toBe(true);
    expect(await objectExists(ana.id, "a1")).toBe(true);
    expect(await used(ana.id)).toBe(30);
  });

  it("uma lista que não corresponde a nada não escreve em `users` (nenhuma linha alterada)", async () => {
    const ana = (await registerUser("ana@example.com")).user;
    await seedFiles(ana.id, [{ id: "a1", size: 30 }]);
    let changes: number[] = [];
    const db = dbWithBatchHook(async (_call, runReal) => {
      const results = await runReal();
      changes = results.map((result) => result.meta.changes);
      return results;
    });

    expect(await purgeExpiredTrash({ DB: db, FILES: env.FILES }, ["a1", "inexistente"])).toBe(0);

    expect(changes).toEqual([0, 0]);
  });

  it("a quota nunca fica abaixo de zero", async () => {
    const ana = (await registerUser("ana@example.com")).user;
    await seedFiles(ana.id, [{ id: "a1", size: 30, deletedAt: 5 }]);
    await env.DB.prepare("UPDATE users SET used_bytes = 10 WHERE id = ?1").bind(ana.id).run();

    await purgeExpiredTrash(env, ["a1"]);

    expect(await used(ana.id)).toBe(0);
  });

  it("se o R2 falha, regista as chaves, mas a base e a quota ficam certas", async () => {
    const ana = (await registerUser("ana@example.com")).user;
    await seedFiles(ana.id, [{ id: "a1", size: 30, deletedAt: 5 }]);
    const errors = silenceErrors();
    const brokenR2 = { delete: async () => Promise.reject(new Error("R2 em baixo")) } as unknown as R2Bucket;

    expect(await purgeExpiredTrash({ DB: env.DB, FILES: brokenR2 }, ["a1"])).toBe(1);

    expect(await rowExists("a1")).toBe(false);
    expect(await used(ana.id)).toBe(0);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining(`u/${ana.id}/a1`), expect.any(Error));
  });

  it("recusa mais de PURGE_BATCH ficheiros por chamada e uma lista vazia não toca na base", async () => {
    await expect(purgeExpiredTrash(env, Array.from({ length: PURGE_BATCH + 1 }, (_unused, i) => `x${i}`))).rejects.toThrow(
      /no máximo 50/,
    );
    const { db, sql } = dbCountingPrepares();
    expect(await purgeExpiredTrash({ DB: db, FILES: env.FILES }, [])).toBe(0);
    expect(sql).toEqual([]);
  });

  it("aceita exatamente PURGE_BATCH ficheiros", async () => {
    const ana = (await registerUser("ana@example.com")).user;
    const files = Array.from({ length: PURGE_BATCH }, (_unused, i) => ({ id: `f${i}`, size: 1, deletedAt: 5 }));
    await seedFiles(ana.id, files);

    expect(await purgeExpiredTrash(env, files.map((file) => file.id))).toBe(PURGE_BATCH);
    expect(await used(ana.id)).toBe(0);
  });
});

describe("purgeTrashed (de um utilizador)", () => {
  it("só toca nos ficheiros do dono indicado", async () => {
    const ana = (await registerUser("ana@example.com")).user;
    const bob = (await registerUser("bob@example.com")).user;
    await seedFiles(ana.id, [{ id: "a1", size: 30, deletedAt: 5 }]);
    await seedFiles(bob.id, [{ id: "b1", size: 20, deletedAt: 5 }]);

    expect(await purgeTrashed(env, bob.id, ["a1", "b1"])).toBe(1);

    expect(await rowExists("a1")).toBe(true);
    expect(await objectExists(ana.id, "a1")).toBe(true);
    expect(await used(ana.id)).toBe(30);
    expect(await rowExists("b1")).toBe(false);
    expect(await used(bob.id)).toBe(0);
  });
});

describe("purgeStalePending", () => {
  it("apaga só os envios pendentes e devolve o espaço que tinham reservado", async () => {
    const ana = (await registerUser("ana@example.com")).user;
    const bob = (await registerUser("bob@example.com")).user;
    await seedFiles(ana.id, [
      { id: "a1", size: 30, status: "pending" },
      { id: "a2", size: 5 }, // pronto: fica
      { id: "a3", size: 9, deletedAt: 5 }, // na lixeira: fica
    ]);
    await seedFiles(bob.id, [{ id: "b1", size: 11, status: "pending" }]);

    expect(await purgeStalePending(env, ["a1", "a2", "a3", "b1"])).toBe(2);

    expect(await Promise.all(["a1", "b1"].map(rowExists))).toEqual([false, false]);
    expect(await Promise.all(["a2", "a3"].map(rowExists))).toEqual([true, true]);
    expect(await objectExists(ana.id, "a1")).toBe(false);
    expect(await used(ana.id)).toBe(14); // 30 + 5 + 9 - 30
    expect(await used(bob.id)).toBe(0);
  });
});
```

Run: `npx vitest run test/purge.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

- [ ] **Step 2: Implementar `lib/purge.ts`**

Mover o ficheiro (mantém o histórico do git):

```bash
git mv src/worker/lib/trash.ts src/worker/lib/purge.ts
```

Substituir o conteúdo de `src/worker/lib/purge.ts`:

```ts
/** Ficheiros eliminados por chamada: o `IN (...)` e o dono têm de caber nos 100 parâmetros de uma instrução da D1. */
export const PURGE_BATCH = 50;

/** Que linhas de `files` se podem eliminar: as que estão na lixeira, ou os envios que nunca chegaram ao fim. */
const KIND_CONDITION = {
  trashed: "deleted_at IS NOT NULL",
  pending: "status = 'pending'",
} as const;

type PurgeKind = keyof typeof KIND_CONDITION;

/**
 * Elimina de vez as linhas de `files` de `ids` (no máximo `PURGE_BATCH`) que são do tipo `kind`, de `ownerId` ou, com `null`, de
 * qualquer dono. Numa só `batch` desconta a quota (o tamanho de cada dono, nunca abaixo de 0) e apaga as linhas. As duas instruções
 * têm a mesma condição, por isso só contam as linhas que ainda são do tipo certo: um ficheiro restaurado, ou um envio que acabou,
 * entretanto não é tocado. O `RETURNING` diz que linhas saíram mesmo e só os objetos dessas vão para fora do R2, numa só chamada.
 * Se o R2 falhar, o objeto fica órfão: as chaves ficam registadas no log, mas a quota e a base ficam certas.
 * Devolve quantos ficheiros foram eliminados.
 */
async function purgeFiles(
  env: Pick<Env, "DB" | "FILES">,
  ids: string[],
  kind: PurgeKind,
  ownerId: string | null,
): Promise<number> {
  if (ids.length === 0) return 0;
  if (ids.length > PURGE_BATCH) throw new Error(`purgeFiles: no máximo ${PURGE_BATCH} ficheiros por chamada.`);
  const marks = ids.map((_id, index) => `?${index + 1}`).join(", ");
  const owner = `?${ids.length + 1}`;
  const where = `${KIND_CONDITION[kind]} AND id IN (${marks}) AND (${owner} IS NULL OR user_id = ${owner})`;
  const [, deleted] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET used_bytes = MAX(used_bytes - (
         SELECT COALESCE(SUM(size), 0) FROM files WHERE files.user_id = users.id AND ${where}
       ), 0) WHERE id IN (SELECT user_id FROM files WHERE ${where})`,
    ).bind(...ids, ownerId),
    env.DB.prepare(`DELETE FROM files WHERE ${where} RETURNING r2_key`).bind(...ids, ownerId),
  ]);
  const keys = (deleted.results as { r2_key: string }[]).map((row) => row.r2_key);
  if (keys.length > 0) {
    await env.FILES.delete(keys).catch((error) => console.error(`Objetos órfãos no R2 (${keys.length}): ${keys.join(", ")}`, error));
  }
  return keys.length;
}

/** Elimina de vez ficheiros que estão na lixeira de um utilizador (`ids`, no máximo `PURGE_BATCH`). */
export function purgeTrashed(env: Pick<Env, "DB" | "FILES">, userId: string, ids: string[]): Promise<number> {
  return purgeFiles(env, ids, "trashed", userId);
}

/** Para a manutenção: elimina de vez ficheiros que estão na lixeira, sejam de quem forem (`ids`, no máximo `PURGE_BATCH`). */
export function purgeExpiredTrash(env: Pick<Env, "DB" | "FILES">, ids: string[]): Promise<number> {
  return purgeFiles(env, ids, "trashed", null);
}

/** Para a manutenção: apaga envios que nunca chegaram ao fim (`pending`), de quem forem, e devolve o espaço que reservaram. */
export function purgeStalePending(env: Pick<Env, "DB" | "FILES">, ids: string[]): Promise<number> {
  return purgeFiles(env, ids, "pending", null);
}
```

Em `src/worker/routes/trash.ts`, nos `import`, trocar:

```ts
import { purgeTrashed, TRASH_PURGE_BATCH } from "../lib/trash";
```

por:

```ts
import { PURGE_BATCH, purgeTrashed } from "../lib/purge";
```

Em `src/worker/routes/trash.ts`, trocar todas as ocorrências (2) de `TRASH_PURGE_BATCH` por `PURGE_BATCH`.

Run: `npx vitest run test/purge.test.ts test/trash.test.ts test/trash-restore.test.ts`
Expected: `Test Files  3 passed (3)`, `Tests  28 passed (28)`.

- [ ] **Step 3: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  33 passed (33)`, `Tests  283 passed (283)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src test
git commit -m "Generaliza o eliminar de vez a vários donos e aos envios pendentes, para a manutenção" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: O cron de manutenção por hora: lixeira expirada, envios pendentes e limpezas

**Files:**
- Create: `src/worker/cron.ts`, `test/cron.test.ts`
- Modify: `src/worker/index.ts`, `wrangler.jsonc`, `test/db-helpers.ts`, `test/auth-helpers.ts`

**Interfaces:**
- Consumes: `purgeExpiredTrash`, `purgeStalePending`, `PURGE_BATCH` (Task 2), `getConfig`, `seedFiles` (Task 2), as migrações da Task 1.
- Produces: `runMaintenance(env, now?)` → `MaintenanceReport` e `scheduledMaintenance(env, now?)` (lança se algum passo falhou) em `src/worker/cron.ts`; as consultas `EXPIRED_TRASH_SQL`, `STALE_PENDING_SQL` e `CLEANUP_SQL`;
  o gatilho `scheduled` do Worker e o cron `0 * * * *`; `insertUser(email, options?)` (`test/auth-helpers.ts`), `dbFailingOn(pattern)` e `envCountingSubrequests()` (`test/db-helpers.ts`).
  A Task 4 acrescenta o passo das contas em remoção.

- [ ] **Step 1: Ajudantes de teste: utilizadores por SQL, uma D1 que falha e a contagem de subpedidos**

Três ajudantes que os testes da manutenção (e os das Tasks 4 e 5) usam. `insertUser` põe utilizadores por SQL, sem o PBKDF2 do registo (100 000 iterações a cada conta tornaria lentos os testes que precisam de vários). `dbFailingOn` simula a D1 a falhar numa consulta. `envCountingSubrequests` embrulha `DB` e `FILES` e conta os subpedidos como o plano gratuito os conta: cada execução de uma instrução, cada `batch` (com as instruções que tiver) e cada operação do R2 é um.

Acrescentar ao fim de `test/auth-helpers.ts`:

```ts
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
```

Acrescentar ao fim de `test/db-helpers.ts`:

```ts
/** `DB` em Proxy cujo `prepare` lança quando o SQL casa com `pattern`: simula uma falha da D1 numa consulta. */
export function dbFailingOn(pattern: RegExp): D1Database {
  return new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          if (pattern.test(sql)) throw new Error("D1 em baixo");
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const REAL_STATEMENT = Symbol("instrução real");

/**
 * `env` com `DB` e `FILES` em Proxy que contam os subpedidos: cada execução de uma instrução (`run`, `first`, `all`, `raw`), cada `batch` e
 * cada operação do R2 é um subpedido (o plano gratuito do Workers dá 50 por invocação; uma `batch` com várias instruções conta uma vez).
 */
export function envCountingSubrequests(): { env: Env; count: () => number } {
  let calls = 0;
  const unwrap = (statement: D1PreparedStatement): D1PreparedStatement =>
    (statement as unknown as Record<symbol, D1PreparedStatement | undefined>)[REAL_STATEMENT] ?? statement;

  function wrap(statement: D1PreparedStatement): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, prop) {
        if (prop === REAL_STATEMENT) return target;
        if (prop === "bind") return (...values: unknown[]) => wrap(target.bind(...values));
        if (prop === "run" || prop === "first" || prop === "all" || prop === "raw") {
          return (...args: unknown[]) => {
            calls++;
            return (target[prop] as (...rest: unknown[]) => unknown)(...args);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  const db = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare") return (sql: string) => wrap(target.prepare(sql));
      if (prop === "batch") {
        return (statements: D1PreparedStatement[]) => {
          calls++;
          return target.batch(statements.map(unwrap));
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const files = new Proxy(env.FILES, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls++;
        return value.apply(target, args);
      };
    },
  });
  return { env: { ...env, DB: db, FILES: files } as Env, count: () => calls };
}
```

- [ ] **Step 2: O cron (testes primeiro)**

Os passos da secção 7 da especificação que não tocam em contas (a Task 4 trata das contas em remoção): (1) lixeira expirada, (2) envios `pending` com mais de uma hora, (3) limpeza de sessões expiradas, falhas de login com mais de um dia e partilhas revogadas ou expiradas há mais de 30 dias. Cada passo é idempotente e trabalha em lotes, para respeitar os 50 subpedidos por invocação do plano gratuito: a lixeira elimina no máximo 6 blocos de 50 por execução (13 subpedidos), os pendentes 3 blocos (7), a limpeza é uma só `batch` (1); o que não couber fica para a hora seguinte, e os mais antigos saem primeiro. Cada passo corre isolado (`try/catch`): se um falha, os outros correm e o erro fica no relatório, e o gatilho (`scheduledMaintenance`) falha a execução no fim para a falha aparecer no painel. Um teste confirma com `EXPLAIN QUERY PLAN` que as consultas usam os índices da migração 0003 (nenhuma varre a tabela inteira) e outro conta os subpedidos do pior caso: 21.

Criar `test/cron.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker";
import {
  CLEANUP_SQL,
  EXPIRED_TRASH_SQL,
  PENDING_BLOCKS,
  PENDING_MAX_AGE_MS,
  STALE_PENDING_SQL,
  TRASH_BLOCKS,
  runMaintenance,
  scheduledMaintenance,
} from "../src/worker/cron";
import { PURGE_BATCH } from "../src/worker/lib/purge";
import { insertUser } from "./auth-helpers";
import { dbFailingOn, envCountingSubrequests, silenceErrors } from "./db-helpers";
import { seedFiles } from "./file-helpers";
import { resetState } from "./helpers";

beforeEach(resetState);
afterEach(() => vi.restoreAllMocks());

const DAY = 86_400_000;
/** A hora programada das execuções destes testes. */
const NOW = 1_800_000_000_000;

const used = async (userId: string): Promise<number> =>
  (await env.DB.prepare("SELECT used_bytes AS n FROM users WHERE id = ?1").bind(userId).first<{ n: number }>())!.n;
const count = async (table: string): Promise<number> =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
const rowIds = async (table: string, column = "id"): Promise<string[]> =>
  (await env.DB.prepare(`SELECT ${column} AS v FROM ${table} ORDER BY ${column}`).all<{ v: string }>()).results.map((row) => row.v);

describe("runMaintenance: lixeira", () => {
  it("elimina o que está na lixeira há mais do que a retenção (de qualquer dono), desconta a quota e deixa o resto", async () => {
    const ana = await insertUser("ana@example.com");
    const bob = await insertUser("bob@example.com");
    await seedFiles(ana, [
      { id: "velho", size: 30, deletedAt: NOW - 31 * DAY },
      { id: "recente", size: 20, deletedAt: NOW - 29 * DAY },
      { id: "vivo", size: 5 },
    ]);
    await seedFiles(bob, [{ id: "velho-bob", size: 100, deletedAt: NOW - 40 * DAY }]);

    const report = await runMaintenance(env, NOW);

    expect(report).toMatchObject({ trashPurged: 2, errors: [] });
    expect(await rowIds("files")).toEqual(["recente", "vivo"]);
    expect((await env.FILES.list({ prefix: "u/" })).objects.map((o) => o.key.split("/")[2])).toEqual(
      expect.arrayContaining(["recente", "vivo"]),
    );
    expect((await env.FILES.list({ prefix: "u/" })).objects).toHaveLength(2);
    expect(await used(ana)).toBe(25); // 30 + 20 + 5 - 30
    expect(await used(bob)).toBe(0);
  });

  it("respeita TRASH_RETENTION_DAYS", async () => {
    const ana = await insertUser("ana@example.com");
    await seedFiles(ana, [{ id: "dois-dias", size: 10, deletedAt: NOW - 2 * DAY }]);

    expect((await runMaintenance(env, NOW)).trashPurged).toBe(0); // por defeito são 30 dias
    const report = await runMaintenance({ ...env, TRASH_RETENTION_DAYS: "1" } as unknown as Env, NOW);

    expect(report.trashPurged).toBe(1);
    expect(await count("files")).toBe(0);
  });

  it("trabalha por lotes: TRASH_BLOCKS × PURGE_BATCH por execução, e as execuções seguintes acabam o trabalho", async () => {
    const ana = await insertUser("ana@example.com");
    const total = TRASH_BLOCKS * PURGE_BATCH + 20;
    await seedFiles(
      ana,
      Array.from({ length: total }, (_unused, index) => ({ id: `f${String(index).padStart(3, "0")}`, size: 1, deletedAt: 5 + index })),
    );

    expect((await runMaintenance(env, NOW)).trashPurged).toBe(TRASH_BLOCKS * PURGE_BATCH);
    expect(await count("files")).toBe(20);
    expect((await runMaintenance(env, NOW)).trashPurged).toBe(20); // os mais velhos saem primeiro; sobraram os 20 mais recentes
    expect(await count("files")).toBe(0);
    expect(await used(ana)).toBe(0);
    expect((await runMaintenance(env, NOW)).trashPurged).toBe(0); // idempotente
  });
});

describe("runMaintenance: envios pendentes", () => {
  it("apaga os envios pendentes com mais de uma hora e devolve o espaço reservado, e deixa os recentes e os prontos", async () => {
    const ana = await insertUser("ana@example.com");
    await seedFiles(ana, [
      { id: "velho", size: 30, status: "pending", createdAt: NOW - PENDING_MAX_AGE_MS - 1 },
      { id: "novo", size: 20, status: "pending", createdAt: NOW - 1000 },
      { id: "pronto", size: 5 },
    ]);

    const report = await runMaintenance(env, NOW);

    expect(report).toMatchObject({ pendingPurged: 1, errors: [] });
    expect(await rowIds("files")).toEqual(["novo", "pronto"]);
    expect((await env.FILES.list({ prefix: "u/" })).objects).toHaveLength(2);
    expect(await used(ana)).toBe(25);
  });
});

describe("runMaintenance: limpeza", () => {
  it("limpa sessões expiradas, falhas de login com mais de um dia e partilhas revogadas ou expiradas há mais de 30 dias", async () => {
    const ana = await insertUser("ana@example.com");
    await seedFiles(ana, [{ id: "f1", size: 1 }]);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('valida', ?1, 1, ?2), ('expirada', ?1, 1, ?3)").bind(
        ana,
        NOW + DAY,
        NOW - 1,
      ),
      env.DB.prepare("INSERT INTO login_failures (email, failed_at) VALUES ('a@x', ?1), ('b@x', ?2)").bind(NOW - 2 * DAY, NOW - 1000),
      env.DB.prepare(
        `INSERT INTO shares (id, token_hash, file_id, user_id, created_at, expires_at, revoked_at) VALUES
           ('ativa', 't1', 'f1', ?1, 1, NULL, NULL),
           ('revogada-velha', 't2', 'f1', ?1, 1, NULL, ?2),
           ('revogada-nova', 't3', 'f1', ?1, 1, NULL, ?3),
           ('expirada-velha', 't4', 'f1', ?1, 1, ?2, NULL),
           ('expirada-nova', 't5', 'f1', ?1, 1, ?3, NULL)`,
      ).bind(ana, NOW - 31 * DAY, NOW - DAY),
    ]);

    const report = await runMaintenance(env, NOW);

    expect(report).toMatchObject({ sessionsDeleted: 1, loginFailuresDeleted: 1, sharesDeleted: 2, errors: [] });
    expect(await rowIds("sessions", "token_hash")).toEqual(["valida"]);
    expect(await rowIds("login_failures", "email")).toEqual(["b@x"]);
    expect(await rowIds("shares")).toEqual(["ativa", "expirada-nova", "revogada-nova"]);
  });
});

describe("runMaintenance: falhas e limites", () => {
  it("um passo que falha não impede os outros, e o gatilho falha a execução para a falha aparecer", async () => {
    const errors = silenceErrors();
    const ana = await insertUser("ana@example.com");
    await seedFiles(ana, [{ id: "velho", size: 10, status: "pending" }]);
    const broken = { ...env, DB: dbFailingOn(/FROM files WHERE deleted_at IS NOT NULL/) } as Env;

    const report = await runMaintenance(broken, NOW);

    expect(report.errors).toEqual(["lixeira: D1 em baixo"]);
    expect(report.pendingPurged).toBe(1); // o passo seguinte correu
    expect(errors).toHaveBeenCalled();
    await expect(scheduledMaintenance(broken, NOW)).rejects.toThrow(/Manutenção com erros: lixeira: D1 em baixo/);
  });

  it("no pior caso gasta 21 subpedidos, bem abaixo dos 50 do plano gratuito", async () => {
    const owners = await Promise.all(["a", "b", "c", "d"].map((name) => insertUser(`${name}@example.com`)));
    const perOwner = (TRASH_BLOCKS * PURGE_BATCH) / owners.length + 10; // mais do que cabe numa execução
    for (const [index, owner] of owners.entries()) {
      await seedFiles(
        owner,
        Array.from({ length: perOwner }, (_unused, i) => ({ id: `t${index}-${i}`, size: 1, deletedAt: 5 })),
      );
      await seedFiles(
        owner,
        Array.from({ length: (PENDING_BLOCKS * PURGE_BATCH) / owners.length + 5 }, (_unused, i) => ({ id: `p${index}-${i}`, size: 1, status: "pending" as const })),
      );
    }
    const { env: counted, count: subrequests } = envCountingSubrequests();

    const report = await runMaintenance(counted, NOW);

    expect(report).toMatchObject({ trashPurged: TRASH_BLOCKS * PURGE_BATCH, pendingPurged: PENDING_BLOCKS * PURGE_BATCH, errors: [] });
    // lixeira: 1 + 6 × 2; pendentes: 1 + 3 × 2; limpeza: 1
    expect(subrequests()).toBe(1 + TRASH_BLOCKS * 2 + (1 + PENDING_BLOCKS * 2) + 1);
    expect(subrequests()).toBeLessThanOrEqual(50);
  });
});

describe("as consultas da manutenção usam os índices", () => {
  const plan = async (sql: string, ...binds: number[]): Promise<string> =>
    (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all<{ detail: string }>()).results.map((row) => row.detail).join(" | ");

  it("nenhuma varre a tabela inteira", async () => {
    expect(await plan(EXPIRED_TRASH_SQL, 1, 1)).toMatch(/USING (COVERING )?INDEX files_trash_expiry/);
    expect(await plan(STALE_PENDING_SQL, 1, 1)).toMatch(/USING (COVERING )?INDEX files_pending_created/);
    expect(await plan(CLEANUP_SQL.sessions, 1)).toMatch(/USING (COVERING )?INDEX sessions_expires_at/);
    expect(await plan(CLEANUP_SQL.loginFailures, 1)).toMatch(/USING (COVERING )?INDEX login_failures_failed_at/);
    expect(await plan(CLEANUP_SQL.revokedShares, 1)).toMatch(/USING (COVERING )?INDEX shares_revoked_at/);
    expect(await plan(CLEANUP_SQL.expiredShares, 1)).toMatch(/USING (COVERING )?INDEX shares_expires_at/);
  });
});

describe("o gatilho do cron", () => {
  it("`scheduled` corre a manutenção à hora programada", async () => {
    const ana = await insertUser("ana@example.com");
    await seedFiles(ana, [{ id: "velho", size: 10, deletedAt: 5 }, { id: "vivo", size: 5 }]);
    const ctx = createExecutionContext();

    worker.scheduled!(createScheduledController({ scheduledTime: NOW, cron: "0 * * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(await rowIds("files")).toEqual(["vivo"]);
    expect(await used(ana)).toBe(5);
  });
});
```

Run: `npx vitest run test/cron.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/worker/cron.ts`:

```ts
import { getConfig } from "./config";
import { PURGE_BATCH, purgeExpiredTrash, purgeStalePending } from "./lib/purge";

const DAY_MS = 86_400_000;

/** Um envio `pending` com mais de uma hora já não vai acabar (um upload de 100 MB demora bem menos) e a reserva é libertada. */
export const PENDING_MAX_AGE_MS = 60 * 60_000;
/** As falhas de login só contam nos últimos 15 minutos; guardam-se um dia. */
export const LOGIN_FAILURE_MAX_AGE_MS = DAY_MS;
/** Os links revogados ou expirados guardam-se 30 dias e depois saem (os de ficheiros eliminados saem logo, em cascata). */
export const SHARE_KEEP_MS = 30 * DAY_MS;

/**
 * Quanto trabalho cabe numa execução. O plano gratuito do Workers dá 50 subpedidos por invocação e cada chamada à D1 ou ao R2 conta.
 * A conta de cada passo, no pior caso:
 *   - lixeira:   1 consulta + `TRASH_BLOCKS` × 2 (uma `batch` e um `delete` do R2 por bloco) = 13;
 *   - pendentes: 1 consulta + `PENDING_BLOCKS` × 2 = 7;
 *   - limpeza:   1 `batch` com as 4 instruções = 1.
 * O que não couber fica para a hora seguinte (cada passo é idempotente e retoma onde ficou).
 */
export const TRASH_BLOCKS = 6;
export const PENDING_BLOCKS = 3;

/** As consultas que escolhem o que eliminar: usam os índices parciais da migração 0003 (um teste confirma-o com `EXPLAIN QUERY PLAN`). */
export const EXPIRED_TRASH_SQL =
  "SELECT id FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ?1 ORDER BY deleted_at LIMIT ?2";
export const STALE_PENDING_SQL =
  "SELECT id FROM files WHERE status = 'pending' AND created_at < ?1 ORDER BY created_at LIMIT ?2";
export const CLEANUP_SQL = {
  sessions: "DELETE FROM sessions WHERE expires_at < ?1",
  loginFailures: "DELETE FROM login_failures WHERE failed_at < ?1",
  revokedShares: "DELETE FROM shares WHERE revoked_at IS NOT NULL AND revoked_at < ?1",
  expiredShares: "DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at < ?1",
} as const;

/** O que uma execução fez; `errors` tem os passos que falharam (os outros correram na mesma). */
export interface MaintenanceReport {
  trashPurged: number;
  pendingPurged: number;
  sessionsDeleted: number;
  loginFailuresDeleted: number;
  sharesDeleted: number;
  errors: string[];
}

async function selectIds(db: D1Database, sql: string, cutoff: number, limit: number): Promise<string[]> {
  const { results } = await db.prepare(sql).bind(cutoff, limit).all<{ id: string }>();
  return results.map((row) => row.id);
}

/** Elimina `ids` por blocos de `PURGE_BATCH`, um bloco de cada vez (cada bloco são 2 subpedidos). */
async function purgeInBlocks(ids: string[], purge: (block: string[]) => Promise<number>): Promise<number> {
  let purged = 0;
  for (let start = 0; start < ids.length; start += PURGE_BATCH) {
    purged += await purge(ids.slice(start, start + PURGE_BATCH));
  }
  return purged;
}

/**
 * A manutenção por hora (spec, secção 7). Cada passo é idempotente, trabalha em lotes limitados (ver `TRASH_BLOCKS`) e falha sozinho:
 * se um passo lança, os outros correm na mesma e o erro fica em `report.errors`. `now` é o instante da execução (os testes fixam-no).
 */
export async function runMaintenance(env: Env, now: number = Date.now()): Promise<MaintenanceReport> {
  const report: MaintenanceReport = {
    trashPurged: 0,
    pendingPurged: 0,
    sessionsDeleted: 0,
    loginFailuresDeleted: 0,
    sharesDeleted: 0,
    errors: [],
  };

  async function step(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      console.error(`Manutenção: o passo «${name}» falhou`, error);
      report.errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await step("lixeira", async () => {
    const cutoff = now - getConfig(env).trashRetentionDays * DAY_MS;
    const ids = await selectIds(env.DB, EXPIRED_TRASH_SQL, cutoff, TRASH_BLOCKS * PURGE_BATCH);
    report.trashPurged = await purgeInBlocks(ids, (block) => purgeExpiredTrash(env, block));
  });

  await step("envios pendentes", async () => {
    const ids = await selectIds(env.DB, STALE_PENDING_SQL, now - PENDING_MAX_AGE_MS, PENDING_BLOCKS * PURGE_BATCH);
    report.pendingPurged = await purgeInBlocks(ids, (block) => purgeStalePending(env, block));
  });

  await step("limpeza", async () => {
    const [sessions, loginFailures, revokedShares, expiredShares] = await env.DB.batch([
      env.DB.prepare(CLEANUP_SQL.sessions).bind(now),
      env.DB.prepare(CLEANUP_SQL.loginFailures).bind(now - LOGIN_FAILURE_MAX_AGE_MS),
      env.DB.prepare(CLEANUP_SQL.revokedShares).bind(now - SHARE_KEEP_MS),
      env.DB.prepare(CLEANUP_SQL.expiredShares).bind(now - SHARE_KEEP_MS),
    ]);
    report.sessionsDeleted = sessions.meta.changes;
    report.loginFailuresDeleted = loginFailures.meta.changes;
    report.sharesDeleted = revokedShares.meta.changes + expiredShares.meta.changes;
  });

  return report;
}

/** O que o gatilho do cron corre: a manutenção, e falha a execução (para aparecer no painel da Cloudflare) se algum passo falhou. */
export async function scheduledMaintenance(env: Env, now: number = Date.now()): Promise<MaintenanceReport> {
  const report = await runMaintenance(env, now);
  if (report.errors.length > 0) throw new Error(`Manutenção com erros: ${report.errors.join("; ")}`);
  return report;
}
```

Substituir o conteúdo de `src/worker/index.ts`:

```ts
import { app } from "./app";
import { scheduledMaintenance } from "./cron";

export default {
  fetch: app.fetch,
  // O cron por hora de `wrangler.jsonc`: `waitUntil` mantém a execução viva até a manutenção acabar.
  scheduled(controller, env, ctx) {
    ctx.waitUntil(scheduledMaintenance(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
```

Run: `npx vitest run test/cron.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  9 passed (9)`.

- [ ] **Step 3: O cron na configuração e os tipos**

Em `wrangler.jsonc`, a seguir aos buckets, trocar:

```
  "r2_buckets": [{ "binding": "FILES", "bucket_name": "spacework-files" }],
```

por:

```
  "r2_buckets": [{ "binding": "FILES", "bucket_name": "spacework-files" }],
  "triggers": { "crons": ["0 * * * *"] },
```

Pendente do Plano 1: regenerar os tipos quando o cron entrar em `wrangler.jsonc`. O gatilho não acrescenta nada ao `Env` (só os *bindings* e as variáveis entram), por isso `worker-configuration.d.ts` não muda; confirma-se com `git status`, que não deve mostrar o ficheiro.

Run: `npm run cf-typegen`
Expected: `✨ Types written to worker-configuration.d.ts`, e o `git status` não mostra alterações nesse ficheiro.

- [ ] **Step 4: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  34 passed (34)`, `Tests  292 passed (292)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src test wrangler.jsonc
git commit -m "Acrescenta o cron de manutenção por hora: lixeira expirada, envios pendentes e limpezas" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: O cron remove as contas em remoção: o R2 por prefixo e depois as linhas

**Files:**
- Create: `src/worker/lib/account-removal.ts`, `test/account-removal.test.ts`
- Modify: `src/worker/cron.ts`, `test/cron.test.ts`

**Interfaces:**
- Consumes: `runMaintenance`, `MaintenanceReport` (Task 3), `insertUser`, `envCountingSubrequests`, `seedFiles`, `silenceErrors`.
- Produces: `removeDeletingAccounts(env)` → `{ accountsRemoved, objectsDeleted }`, `removeAccountRows(db, userId)`, `ACCOUNTS_PER_RUN` (2), `SWEEP_PAGES` (2), `R2_PAGE` (1000) e `DELETING_ACCOUNTS_SQL` em `src/worker/lib/account-removal.ts`;
  o passo «contas em remoção» do cron e os campos `accountsRemoved` e `accountObjectsDeleted` do relatório. A Task 5 (a API do admin) põe as contas em `status = 'deleting'`; é este passo que as apaga.

- [ ] **Step 1: Testes primeiro**

Spec, secção 7, ponto 3 (e pendentes dos Planos 1 e 3A). Apagar uma conta pela API só a põe em `deleting` e termina as sessões; a remoção é do cron: (1) os objetos do R2 por **prefixo** `u/<id>/` (`list` de 1000 chaves e `delete` dessas chaves), e não pelas linhas de `files`, para saírem também os objetos órfãos de uma libertação de reserva que falhou (a Task 1 e o plano 3A deixam esses órfãos só no log); (2) só depois, e só quando o prefixo está vazio, as linhas, numa só `batch`: partilhas, ficheiros, pastas (num só `DELETE`: a D1 verifica as chaves estrangeiras no fim da instrução, por isso uma pasta e as suas subpastas saem juntas), sessões e o utilizador. A ordem é essa porque, se as linhas saíssem primeiro e o R2 falhasse, os objetos ficavam sem dono para sempre; assim uma falha só adia a remoção. Uma conta grande leva várias execuções (2 páginas de 1000 chaves por conta e por execução) e só desaparece, libertando o email, quando acaba. Cada instrução da `batch` leva a guarda «a conta está em remoção»: se um id de uma conta ativa chegasse aqui por engano, nada se apagava. O custo no pior caso é 1 + 2 × (2 × 2 + 1) = 11 subpedidos, e a execução inteira 32 (um teste mede-o com um R2 de mentira).

Criar `test/account-removal.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNTS_PER_RUN, DELETING_ACCOUNTS_SQL, R2_PAGE, SWEEP_PAGES, removeAccountRows } from "../src/worker/lib/account-removal";
import { runMaintenance } from "../src/worker/cron";
import { insertUser } from "./auth-helpers";
import { envCountingSubrequests, silenceErrors } from "./db-helpers";
import { seedFiles } from "./file-helpers";
import { api, resetState } from "./helpers";

beforeEach(resetState);
afterEach(() => vi.restoreAllMocks());

const NOW = 1_800_000_000_000;

const exists = async (table: string, column: string, value: string): Promise<boolean> =>
  (await env.DB.prepare(`SELECT 1 AS n FROM ${table} WHERE ${column} = ?1`).bind(value).first()) !== null;
const objectsOf = async (userId: string): Promise<number> => (await env.FILES.list({ prefix: `u/${userId}/` })).objects.length;

/** Uma conta com ficheiros (um deles na lixeira há pouco), pastas aninhadas, uma partilha, uma sessão e um objeto órfão no R2 (sem linha). */
async function populate(userId: string, label: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO folders (id, user_id, parent_id, name, name_norm, created_at) VALUES (?1, ?2, NULL, 'pai', 'pai', 1)").bind(`${label}-pai`, userId),
    env.DB.prepare("INSERT INTO folders (id, user_id, parent_id, name, name_norm, created_at) VALUES (?1, ?2, ?3, 'filha', 'filha', 1)").bind(`${label}-filha`, userId, `${label}-pai`),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, 1, ?3)").bind(`${label}-sessao`, userId, NOW + 1000),
  ]);
  await seedFiles(userId, [{ id: `${label}-f1`, size: 10 }, { id: `${label}-f2`, size: 20, deletedAt: NOW - 1000 }]);
  await env.DB.batch([
    env.DB.prepare("UPDATE files SET folder_id = ?1 WHERE id = ?2").bind(`${label}-filha`, `${label}-f1`),
    env.DB.prepare("INSERT INTO shares (id, token_hash, file_id, user_id, created_at) VALUES (?1, ?2, ?3, ?4, 1)").bind(`${label}-share`, `${label}-tok`, `${label}-f1`, userId),
  ]);
  await env.FILES.put(`u/${userId}/${label}-orfao`, "sem linha");
}

describe("contas em remoção (manutenção)", () => {
  it("apaga o R2 (órfãos incluídos), as linhas e o utilizador de uma conta em remoção, e não toca nas outras", async () => {
    const ana = await insertUser("ana@example.com");
    const bob = await insertUser("bob@example.com", { status: "deleting" });
    const carla = await insertUser("carla@example.com", { status: "suspended" });
    await populate(ana, "ana");
    await populate(bob, "bob");
    await populate(carla, "carla");

    const report = await runMaintenance(env, NOW);

    expect(report).toMatchObject({ accountsRemoved: 1, accountObjectsDeleted: 3, errors: [] });
    expect(await exists("users", "id", bob)).toBe(false);
    for (const [table, column, value] of [
      ["files", "id", "bob-f1"],
      ["folders", "id", "bob-pai"],
      ["folders", "id", "bob-filha"],
      ["sessions", "token_hash", "bob-sessao"],
      ["shares", "id", "bob-share"],
    ] as const) {
      expect(await exists(table, column, value), `${table} ${value}`).toBe(false);
    }
    expect(await objectsOf(bob)).toBe(0);
    // as outras contas ficam como estavam
    for (const [owner, label] of [[ana, "ana"], [carla, "carla"]] as const) {
      expect(await exists("users", "id", owner)).toBe(true);
      expect(await exists("files", "id", `${label}-f1`)).toBe(true);
      expect(await exists("shares", "id", `${label}-share`)).toBe(true);
      expect(await exists("sessions", "token_hash", `${label}-sessao`)).toBe(true);
      expect(await objectsOf(owner)).toBe(3);
    }
  });

  it("depois da remoção o email fica livre para um registo novo", async () => {
    await insertUser("bob@example.com", { status: "deleting" });
    const register = () => api("/api/auth/register", { method: "POST", json: { email: "bob@example.com", password: "senha-segura-123" } });
    expect((await register()).status).toBe(409); // enquanto a conta existe, o email está ocupado

    await runMaintenance(env, NOW);

    expect((await register()).status).toBe(201);
  });

  it("uma conta grande leva várias execuções: só quando o R2 fica vazio saem as linhas e o utilizador", async () => {
    const bob = await insertUser("bob@example.com", { status: "deleting" });
    await seedFiles(bob, [{ id: "f1", size: 1 }]);
    const extra = SWEEP_PAGES * R2_PAGE + 100 - 1; // com o objeto do `f1`, mais 100 do que cabe numa execução
    for (let start = 0; start < extra; start += 500) {
      await Promise.all(
        Array.from({ length: Math.min(500, extra - start) }, (_unused, i) => env.FILES.put(`u/${bob}/x${start + i}`, "x")),
      );
    }

    const first = await runMaintenance(env, NOW);

    expect(first).toMatchObject({ accountsRemoved: 0, accountObjectsDeleted: SWEEP_PAGES * R2_PAGE });
    expect(await exists("users", "id", bob)).toBe(true); // ainda em remoção, com as linhas
    expect(await exists("files", "id", "f1")).toBe(true);
    expect(await objectsOf(bob)).toBe(100);

    const second = await runMaintenance(env, NOW);

    expect(second).toMatchObject({ accountsRemoved: 1, accountObjectsDeleted: 100 });
    expect(await exists("users", "id", bob)).toBe(false);
    expect(await objectsOf(bob)).toBe(0);
  });

  it("se o R2 falha, a conta continua em remoção com tudo (nada se perde) e a execução seguinte retoma", async () => {
    const errors = silenceErrors();
    const bob = await insertUser("bob@example.com", { status: "deleting" });
    await seedFiles(bob, [{ id: "f1", size: 1 }]);
    const brokenR2 = { list: async () => Promise.reject(new Error("R2 em baixo")) } as unknown as R2Bucket;

    const report = await runMaintenance({ ...env, FILES: brokenR2 } as Env, NOW);

    expect(report.errors).toEqual(["contas em remoção: R2 em baixo"]);
    expect(errors).toHaveBeenCalled();
    expect(await exists("users", "id", bob)).toBe(true);
    expect(await exists("files", "id", "f1")).toBe(true);
    expect(await objectsOf(bob)).toBe(1);

    expect((await runMaintenance(env, NOW)).accountsRemoved).toBe(1);
  });

  it("trata no máximo ACCOUNTS_PER_RUN contas por execução, as mais antigas primeiro", async () => {
    const ids = [];
    for (let index = 0; index < ACCOUNTS_PER_RUN + 1; index++) {
      ids.push(await insertUser(`u${index}@example.com`, { status: "deleting", createdAt: 10 + index }));
    }

    expect((await runMaintenance(env, NOW)).accountsRemoved).toBe(ACCOUNTS_PER_RUN);
    expect(await exists("users", "id", ids[ACCOUNTS_PER_RUN])).toBe(true); // a mais recente espera pela hora seguinte
    expect((await runMaintenance(env, NOW)).accountsRemoved).toBe(1);
  });

  it("removeAccountRows só alcança contas em remoção (a guarda protege uma conta ativa)", async () => {
    const ana = await insertUser("ana@example.com");
    await populate(ana, "ana");

    expect(await removeAccountRows(env.DB, ana)).toBe(false);

    expect(await exists("users", "id", ana)).toBe(true);
    expect(await exists("files", "id", "ana-f1")).toBe(true);
    expect(await exists("folders", "id", "ana-pai")).toBe(true);
    expect(await exists("shares", "id", "ana-share")).toBe(true);
    expect(await exists("sessions", "token_hash", "ana-sessao")).toBe(true);
  });

  it("a consulta das contas em remoção usa o índice parcial", async () => {
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${DELETING_ACCOUNTS_SQL}`).bind(2).all<{ detail: string }>();
    expect(results.map((row) => row.detail).join(" | ")).toMatch(/USING (COVERING )?INDEX users_deleting/);
  });

  it("no pior caso (contas grandes, a acabar) a execução inteira gasta 32 subpedidos, abaixo dos 50 do plano gratuito", async () => {
    for (let index = 0; index < ACCOUNTS_PER_RUN + 1; index++) {
      await insertUser(`u${index}@example.com`, { status: "deleting", createdAt: 10 + index });
    }
    await seedFiles(await insertUser("t@example.com"), Array.from({ length: 330 }, (_unused, i) => ({ id: `t${i}`, size: 1, deletedAt: 5 })));
    await seedFiles(await insertUser("p@example.com"), Array.from({ length: 170 }, (_unused, i) => ({ id: `p${i}`, size: 1, status: "pending" as const })));
    // R2 de mentira: cada conta tem 1000 chaves na 1.ª página (com mais a seguir) e outras 1000 na 2.ª (a última); conta-se à parte.
    const calls = { r2: 0 };
    const pagesOf = new Map<string, number>();
    const fakeR2 = {
      list: async ({ prefix }: { prefix: string }) => {
        calls.r2++;
        const page = (pagesOf.get(prefix) ?? 0) + 1;
        pagesOf.set(prefix, page);
        return { objects: Array.from({ length: R2_PAGE }, (_unused, i) => ({ key: `${prefix}${i}` })), truncated: page < SWEEP_PAGES };
      },
      delete: async () => {
        calls.r2++;
      },
    } as unknown as R2Bucket;
    const { env: counted, count } = envCountingSubrequests();

    const report = await runMaintenance({ ...counted, FILES: fakeR2 } as Env, NOW);

    expect(report).toMatchObject({ trashPurged: 300, pendingPurged: 150, accountsRemoved: ACCOUNTS_PER_RUN, errors: [] });
    // lixeira 1 + 6 × 2; pendentes 1 + 3 × 2; contas 1 + 2 × (2 páginas × 2 + a batch das linhas); limpeza 1
    const total = count() + calls.r2;
    expect(total).toBe(13 + 7 + (1 + ACCOUNTS_PER_RUN * (SWEEP_PAGES * 2 + 1)) + 1);
    expect(total).toBeLessThanOrEqual(50);
  });
});
```

Run: `npx vitest run test/account-removal.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

- [ ] **Step 2: Implementar a remoção e o passo do cron**

Criar `src/worker/lib/account-removal.ts`:

```ts
/** Contas em remoção tratadas por execução. */
export const ACCOUNTS_PER_RUN = 2;
/** Chaves por página do R2 (o máximo que um `delete` aceita). */
export const R2_PAGE = 1000;
/** Páginas do R2 varridas por conta e por execução: cada uma são 2 subpedidos (um `list` e um `delete`). */
export const SWEEP_PAGES = 2;

/** Usa o índice parcial `users_deleting` (migração 0003). */
export const DELETING_ACCOUNTS_SQL = "SELECT id FROM users WHERE status = 'deleting' ORDER BY created_at LIMIT ?1";

/**
 * Apaga os objetos de `u/<userId>/` do R2, até `SWEEP_PAGES` páginas. Varre-se o prefixo e não as linhas de `files`: assim também saem os
 * objetos órfãos (de uma libertação de reserva que falhou) e o que as linhas já não dizem. Devolve quantos apagou e se o prefixo ficou vazio.
 */
async function sweepObjects(env: Pick<Env, "FILES">, userId: string): Promise<{ deleted: number; empty: boolean }> {
  let deleted = 0;
  for (let page = 0; page < SWEEP_PAGES; page++) {
    const listing = await env.FILES.list({ prefix: `u/${userId}/`, limit: R2_PAGE });
    if (listing.objects.length > 0) {
      await env.FILES.delete(listing.objects.map((object) => object.key));
      deleted += listing.objects.length;
    }
    if (!listing.truncated) return { deleted, empty: true };
  }
  return { deleted, empty: false };
}

/** Só alcança contas em remoção: se um id de uma conta ativa chegasse aqui por engano, nada se apagava. */
const OWNED_BY_DELETING = "user_id IN (SELECT id FROM users WHERE id = ?1 AND status = 'deleting')";

/**
 * Apaga as linhas de uma conta em remoção numa só `batch`, filhos primeiro por causa das chaves estrangeiras: partilhas, ficheiros, pastas
 * (num só `DELETE`, que a D1 verifica no fim da instrução, por isso uma pasta e as suas subpastas saem juntas), sessões e, por fim, o utilizador.
 * Devolve se o utilizador foi apagado.
 */
export async function removeAccountRows(db: D1Database, userId: string): Promise<boolean> {
  const results = await db.batch([
    db.prepare(`DELETE FROM shares WHERE ${OWNED_BY_DELETING}`).bind(userId),
    db.prepare(`DELETE FROM files WHERE ${OWNED_BY_DELETING}`).bind(userId),
    db.prepare(`DELETE FROM folders WHERE ${OWNED_BY_DELETING}`).bind(userId),
    db.prepare(`DELETE FROM sessions WHERE ${OWNED_BY_DELETING}`).bind(userId),
    db.prepare("DELETE FROM users WHERE id = ?1 AND status = 'deleting'").bind(userId),
  ]);
  return results[4].meta.changes === 1;
}

export interface AccountRemovalReport {
  accountsRemoved: number;
  objectsDeleted: number;
}

/**
 * Remove as contas em `deleting` (o admin apagou-as pela API; a remoção real é daqui). Por conta: primeiro os objetos do R2 e só depois as
 * linhas da D1: se as linhas saíssem primeiro e o R2 falhasse, os objetos ficavam sem dono para sempre. Uma conta grande leva várias
 * execuções (`SWEEP_PAGES` páginas por execução); só quando o prefixo fica vazio saem as linhas e o utilizador, e o email fica livre.
 * Custo no pior caso: 1 consulta + `ACCOUNTS_PER_RUN` × (`SWEEP_PAGES` × 2 + 1) = 11 subpedidos.
 */
export async function removeDeletingAccounts(env: Pick<Env, "DB" | "FILES">): Promise<AccountRemovalReport> {
  const report: AccountRemovalReport = { accountsRemoved: 0, objectsDeleted: 0 };
  const { results } = await env.DB.prepare(DELETING_ACCOUNTS_SQL).bind(ACCOUNTS_PER_RUN).all<{ id: string }>();
  for (const { id } of results) {
    const swept = await sweepObjects(env, id);
    report.objectsDeleted += swept.deleted;
    if (swept.empty && (await removeAccountRows(env.DB, id))) report.accountsRemoved++;
  }
  return report;
}
```

Em `src/worker/cron.ts`, nos `import`, trocar:

```ts
import { getConfig } from "./config";
import { PURGE_BATCH,
```

por:

```ts
import { getConfig } from "./config";
import { removeDeletingAccounts } from "./lib/account-removal";
import { PURGE_BATCH,
```

No comentário do orçamento, trocar:

```ts
 *   - pendentes: 1 consulta + `PENDING_BLOCKS` × 2 = 7;
 *   - limpeza:   1 `batch` com as 4 instruções = 1.
 * O que não couber fica para a hora seguinte (cada passo é idempotente e retoma onde ficou).
```

por:

```ts
 *   - pendentes: 1 consulta + `PENDING_BLOCKS` × 2 = 7;
 *   - contas em remoção: 1 consulta + `ACCOUNTS_PER_RUN` × (`SWEEP_PAGES` × 2 + 1) = 11 (ver `removeDeletingAccounts`);
 *   - limpeza:   1 `batch` com as 4 instruções = 1.
 * Somam 32 no pior caso (22 quando não há contas em remoção). O que não couber fica para a hora seguinte (cada passo é idempotente e
 * retoma onde ficou).
```

Na interface `MaintenanceReport`, trocar:

```ts
  pendingPurged: number;
  sessionsDeleted: number;
```

por:

```ts
  pendingPurged: number;
  accountsRemoved: number;
  accountObjectsDeleted: number;
  sessionsDeleted: number;
```

No relatório inicial de `runMaintenance`, trocar:

```ts
    pendingPurged: 0,
    sessionsDeleted: 0,
```

por:

```ts
    pendingPurged: 0,
    accountsRemoved: 0,
    accountObjectsDeleted: 0,
    sessionsDeleted: 0,
```

Entre os passos dos envios pendentes e da limpeza, trocar:

```ts
  await step("limpeza", async () => {
```

por:

```ts
  await step("contas em remoção", async () => {
    const removal = await removeDeletingAccounts(env);
    report.accountsRemoved = removal.accountsRemoved;
    report.accountObjectsDeleted = removal.objectsDeleted;
  });

  await step("limpeza", async () => {
```

Run: `npx vitest run test/account-removal.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  8 passed (8)`.

- [ ] **Step 3: O teste do custo da Task 3 passa a contar a consulta das contas**

Sem contas em remoção o passo novo gasta só a consulta que as procura: 1 subpedido a mais, 22 no total. Esta mudança no teste da Task 3 vem **depois** de o ver falhar com o passo novo (os 21 de antes).

Run: `npx vitest run test/cron.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  1 failed | 8 passed (9)).

Em `test/cron.test.ts`, trocar:

```ts
  it("no pior caso gasta 21 subpedidos, bem abaixo dos 50 do plano gratuito", async () => {
```

por:

```ts
  it("sem contas em remoção gasta 22 subpedidos no pior caso das outras etapas, bem abaixo dos 50 do plano gratuito", async () => {
```

No mesmo teste, trocar:

```ts
    // lixeira: 1 + 6 × 2; pendentes: 1 + 3 × 2; limpeza: 1
    expect(subrequests()).toBe(1 + TRASH_BLOCKS * 2 + (1 + PENDING_BLOCKS * 2) + 1);
```

por:

```ts
    // lixeira: 1 + 6 × 2; pendentes: 1 + 3 × 2; contas em remoção: 1 (só a consulta); limpeza: 1
    expect(subrequests()).toBe(1 + TRASH_BLOCKS * 2 + (1 + PENDING_BLOCKS * 2) + 1 + 1);
```

Run: `npx vitest run test/cron.test.ts test/account-removal.test.ts`
Expected: `Test Files  2 passed (2)`, `Tests  17 passed (17)`.

- [ ] **Step 4: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  35 passed (35)`, `Tests  300 passed (300)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src test
git commit -m "Remove as contas em remoção no cron: o R2 por prefixo e depois as linhas" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: A API do administrador: listar contas, mudar quota e estado, apagar contas

**Files:**
- Create: `src/worker/middleware/admin.ts`, `src/worker/routes/admin.ts`, `test/admin.test.ts`
- Modify: `src/shared/types.ts`, `src/shared/validation.ts`, `src/worker/app.ts`, `test/auth-helpers.ts`, `test/validation.test.ts`

**Interfaces:**
- Consumes: `createAuthedRouter` (Plano 2A), `deleteUserSessionsStatement` (Task 1), `readJsonObject`, `ApiError`, `runMaintenance` (Tasks 3 e 4), `insertUser` (Task 3), `dbWithBatchHook`, `fetchWithEnv`.
- Produces: `GET /api/admin/users` → `{ users: AdminUser[] }`; `PATCH /api/admin/users/:id` (`{ quotaBytes?, status? }` com `status` entre `active` e `suspended`) → `{ user }`; `DELETE /api/admin/users/:id` → 204;
  o tipo `AdminUser` (`src/shared/types.ts`); `MAX_QUOTA_BYTES` (1 PiB) e `isValidQuota` (`src/shared/validation.ts`, que a interface da Task 7 também usa); `requireAdmin`; `registerAdmin(email?, password?)` (`test/auth-helpers.ts`).
  Erros: `403 forbidden`, `404 user_not_found`, `403 admin_protected`, `409 account_deleting`, `400 invalid_quota | invalid_status | invalid_body`.

- [ ] **Step 1: Os limites da quota (teste primeiro)**

A especificação chama `quota_bytes` ao campo; o resto da API fala em `quotaBytes` (é o nome em `PublicUser` e em `/api/config`), por isso a rota usa `quotaBytes`. A quota é um inteiro de bytes entre 0 e 1 PiB (`2 ** 50`: muito mais do que qualquer conta precisa e ainda dentro dos inteiros exatos do JavaScript); uma quota abaixo do uso atual é permitida e só impede novos uploads (spec, secção 5).

Em `test/validation.test.ts`, nos `import`, trocar:

```ts
import { isValidEmail, isValidPassword, normalizeEmail } from "../src/shared/validation";
```

por:

```ts
import { isValidEmail, isValidPassword, isValidQuota, MAX_QUOTA_BYTES, normalizeEmail } from "../src/shared/validation";
```

Acrescentar ao fim de `test/validation.test.ts`:

```ts
describe("isValidQuota", () => {
  it("aceita inteiros de 0 a MAX_QUOTA_BYTES", () => {
    for (const quota of [0, 1, 1_073_741_824, MAX_QUOTA_BYTES]) expect(isValidQuota(quota), String(quota)).toBe(true);
  });

  it("recusa o que não é um inteiro seguro nesse intervalo", () => {
    for (const quota of [-1, 1.5, MAX_QUOTA_BYTES + 1, Number.NaN, Number.POSITIVE_INFINITY, "10", null, undefined, {}]) {
      expect(isValidQuota(quota), String(quota)).toBe(false);
    }
  });
});
```

Run: `npx vitest run test/validation.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  2 failed | 5 passed (7)).

Acrescentar ao fim de `src/shared/validation.ts`:

```ts
/** A quota máxima que o administrador pode dar: 1 PiB (muito mais do que qualquer conta precisa, e dentro dos inteiros exatos do JavaScript). */
export const MAX_QUOTA_BYTES = 2 ** 50;

/** Uma quota em bytes: um inteiro seguro entre 0 e `MAX_QUOTA_BYTES`. */
export function isValidQuota(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_QUOTA_BYTES;
}
```

Run: `npx vitest run test/validation.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  7 passed (7)`.

- [ ] **Step 2: As rotas do administrador (testes primeiro)**

Regras (spec, secções 4 e 6): só `role = admin` entra em `/api/admin/*` (`403 forbidden` aos outros, `401` sem sessão); **não há nenhuma rota para ver ou descarregar ficheiros alheios**, e um teste fixa a lista das três rotas; uma conta de administrador não se suspende nem se apaga (`403 admin_protected`, mas a quota muda-se); apagar uma conta põe-na em `deleting` e termina as sessões, e quem a remove é o cron da Task 4. **Suspender termina as sessões** (pendente do Plano 1): o filtro `status = 'active'` da autenticação não chega, porque ao reativar a conta as sessões antigas voltariam a valer; por isso o `UPDATE` do estado e o `DELETE` das sessões vão na mesma `batch` e um teste reativa a conta e confirma que as sessões de antes continuam mortas. O teste da forma da resposta fixa os campos de cada conta (sem `password_hash`): pendente do Plano 1. O email de uma conta em remoção continua ocupado até o cron acabar (o registo dá `409 email_taken`), o que um teste de ponta a ponta mostra.

Acrescentar ao fim de `test/auth-helpers.ts`:

```ts
/** Regista um utilizador e promove-o a administrador (o registo só cria utilizadores normais). O cookie devolvido continua válido. */
export async function registerAdmin(
  email = "admin@example.com",
  password = "senha-admin-123",
): Promise<{ cookie: string; user: PublicUser; password: string }> {
  const result = await registerUser(email, password);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?1").bind(result.user.id).run();
  return result;
}
```

Criar `test/admin.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { AdminUser } from "../src/shared/types";
import { MAX_QUOTA_BYTES } from "../src/shared/validation";
import { app } from "../src/worker/app";
import { runMaintenance } from "../src/worker/cron";
import { insertUser, login, registerAdmin, registerUser } from "./auth-helpers";
import { dbWithBatchHook, fetchWithEnv } from "./db-helpers";
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
      expect(Object.keys(user).sort()).toEqual(["createdAt", "email", "id", "quotaBytes", "role", "status", "usedBytes"]);
    }
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
```

Run: `npx vitest run test/admin.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  14 failed (14)).

Acrescentar ao fim de `src/shared/types.ts`:

```ts
/** Uma conta tal como o painel de administração a vê (nunca inclui a senha). */
export interface AdminUser {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  quotaBytes: number;
  usedBytes: number;
  createdAt: number;
}
```

Criar `src/worker/middleware/admin.ts`:

```ts
import type { MiddlewareHandler } from "hono";
import { ApiError } from "../errors";
import type { AppEnv } from "../types";

/** Só o administrador passa. Vem depois de `requireAuth` (o `user` já está no contexto). */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("user").role !== "admin") {
    throw new ApiError(403, "forbidden", "Só o administrador pode fazer isto.");
  }
  await next();
};
```

Criar `src/worker/routes/admin.ts`:

```ts
import type { AdminUser, Role, UserStatus } from "../../shared/types";
import { isValidQuota, MAX_QUOTA_BYTES } from "../../shared/validation";
import { ApiError } from "../errors";
import { readJsonObject } from "../lib/http";
import { deleteUserSessionsStatement } from "../lib/sessions";
import { requireAdmin } from "../middleware/admin";
import { createAuthedRouter } from "./authed";

/**
 * As rotas do administrador: gerem contas e quotas e **nada mais**. Não há nenhuma rota para ver ou descarregar ficheiros de outros
 * utilizadores (um teste fixa a lista de rotas). Passam por `requireAuth` e depois por `requireAdmin`.
 */
export const admin = createAuthedRouter();
admin.use("*", requireAdmin);

interface UserRow {
  id: string;
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
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    quotaBytes: row.quota_bytes,
    usedBytes: row.used_bytes,
    createdAt: row.created_at,
  };
}

async function findUser(db: D1Database, id: string): Promise<UserRow> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?1`).bind(id).first<UserRow>();
  if (!row) throw new ApiError(404, "user_not_found", "Utilizador não encontrado.");
  return row;
}

const adminProtected = () =>
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
 */
admin.patch("/users/:id", async (c) => {
  const db = c.env.DB;
  const target = await findUser(db, c.req.param("id"));
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

  const quota = hasQuota ? (body.quotaBytes as number) : null;
  const status = hasStatus ? (body.status as string) : null;
  const statements = [
    db
      .prepare(
        "UPDATE users SET quota_bytes = COALESCE(?1, quota_bytes), status = COALESCE(?2, status) WHERE id = ?3 AND status != 'deleting'",
      )
      .bind(quota, status, target.id),
  ];
  if (status === "suspended") statements.push(deleteUserSessionsStatement(db, target.id));
  const [updated] = await db.batch(statements);
  if (updated.meta.changes !== 1) throw accountDeleting(); // passou a estar em remoção entre a leitura e a escrita
  return c.json({ user: toAdminUser(await findUser(db, target.id)) });
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
});
```

Em `src/worker/app.ts`, nos `import`, trocar:

```ts
import { ApiError } from "./errors";
import { jsonBodyLimit } from "./middleware/body-limit";
import { originCheck, securityHeaders } from "./middleware/security";
import { auth } from "./routes/auth";
```

por:

```ts
import { ApiError } from "./errors";
import { jsonBodyLimit } from "./middleware/body-limit";
import { originCheck, securityHeaders } from "./middleware/security";
import { admin } from "./routes/admin";
import { auth } from "./routes/auth";
```

Nas rotas, trocar:

```ts
app.route("/api/auth", auth);
```

por:

```ts
app.route("/api/admin", admin);
app.route("/api/auth", auth);
```

Run: `npx vitest run test/admin.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  14 passed (14)`.

- [ ] **Step 3: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  36 passed (36)`, `Tests  316 passed (316)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src test
git commit -m "Acrescenta a API do administrador: listar contas, mudar quota e estado e apagar contas" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Painel do administrador: a lista de contas e a ligação «Admin»

**Files:**
- Create: `src/web/admin.ts`, `src/web/admin.test.tsx`, `src/web/pages/AdminPage.tsx`, `src/web/pages/AdminPage.test.tsx`
- Modify: `src/web/components/UsageBar.tsx`, `src/web/components/AppLayout.tsx`, `src/web/App.tsx`

**Interfaces:**
- Consumes: `AdminUser` (Task 5), `apiFetch`, `ME_KEY`, `useMe`, `UsageBar`, `Message`, `Button`, `formatBytes`, `formatDate`, `mockApi`/`SESSION`/`ME`/`renderApp`.
- Produces: `useAdminUsers({ enabled? })`, `useUpdateUser()` (variável `{ id, quotaBytes?, status? }`), `useDeleteUser()` (variável: o id) e `ADMIN_USERS_KEY` (`src/web/admin.ts`); a rota `/admin` (`AdminPage`) e a ligação «Admin» da barra lateral (só para administradores);
  `UsageBar` com a propriedade opcional `label`; `UserRow({ user, isSelf, actions? })` dentro de `AdminPage.tsx` (a Task 7 preenche a ranhura `actions`).

- [ ] **Step 1: Os hooks do painel (testes primeiro)**

Segue o padrão de `space.ts`: uma consulta com chave própria e mutações que, quando terminam (com êxito ou não: a lista pode estar velha), refazem a lista; também refazem a sessão, porque o administrador pode mudar a sua própria quota, que a barra lateral mostra. `enabled` serve para a página não pedir a lista a quem não é administrador (levaria um 403).

Criar `src/web/admin.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AdminUser } from "../shared/types";
import { useAdminUsers, useDeleteUser, useUpdateUser } from "./admin";
import { useMe } from "./auth";
import { apiError, json, ME, mockApi, noContent } from "./test/mock-api";
import { queryWrapper, testQueryClient } from "./test/render";

const ANA: AdminUser = { id: "u 1", email: "ana@example.com", role: "user", status: "active", quotaBytes: 100, usedBytes: 10, createdAt: 1 };

describe("useAdminUsers", () => {
  it("devolve as contas", async () => {
    mockApi({ "GET /api/admin/users": () => json({ users: [ANA] }) });
    const { result } = renderHook(() => useAdminUsers(), { wrapper: queryWrapper(testQueryClient()) });
    await waitFor(() => expect(result.current.data).toEqual([ANA]));
  });

  it("não pede nada com `enabled: false` (quem não é administrador levaria um 403)", async () => {
    const server = mockApi({ "GET /api/admin/users": () => apiError(403, "forbidden", "Só o administrador pode fazer isto.") });
    const { result } = renderHook(() => useAdminUsers({ enabled: false }), { wrapper: queryWrapper(testQueryClient()) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.fetchStatus).toBe("idle");
    expect(server.calls).toHaveLength(0);
  });
});

describe("mutações do painel", () => {
  it("atualizar uma conta envia só o que mudou, com o id codificado, e refaz a lista e a sessão", async () => {
    const server = mockApi({
      "GET /api/admin/users": () => json({ users: [ANA] }),
      "GET /api/auth/me": () => json({ user: ME }),
      "PATCH /api/admin/users/:id": () => json({ user: { ...ANA, quotaBytes: 200 } }),
    });
    const wrapper = queryWrapper(testQueryClient());
    const hook = renderHook(() => ({ users: useAdminUsers(), me: useMe(), update: useUpdateUser() }), { wrapper });
    await waitFor(() => expect(hook.result.current.users.isSuccess && hook.result.current.me.isSuccess).toBe(true));

    await act(async () => {
      await hook.result.current.update.mutateAsync({ id: "u 1", quotaBytes: 200 });
      await hook.result.current.update.mutateAsync({ id: "u 1", status: "suspended" });
    });

    const [quota, status] = server.callsTo("PATCH /api/admin/users/:id");
    expect(quota).toMatchObject({ path: "/api/admin/users/u%201", body: { quotaBytes: 200 } });
    expect(status.body).toEqual({ status: "suspended" });
    await waitFor(() => {
      expect(server.callsTo("GET /api/admin/users").length).toBeGreaterThanOrEqual(2);
      expect(server.callsTo("GET /api/auth/me").length).toBeGreaterThanOrEqual(2);
    });
  });

  it("apagar usa DELETE com o id codificado e refaz a lista; um erro também a refaz", async () => {
    let fail = false;
    const server = mockApi({
      "GET /api/admin/users": () => json({ users: [ANA] }),
      "DELETE /api/admin/users/:id": () => (fail ? apiError(403, "admin_protected", "Uma conta de administrador não se pode suspender nem apagar.") : noContent()),
    });
    const wrapper = queryWrapper(testQueryClient());
    const hook = renderHook(() => ({ users: useAdminUsers(), remove: useDeleteUser() }), { wrapper });
    await waitFor(() => expect(hook.result.current.users.isSuccess).toBe(true));

    await act(() => hook.result.current.remove.mutateAsync("u 1"));
    expect(server.callsTo("DELETE /api/admin/users/:id")[0]).toMatchObject({ method: "DELETE", path: "/api/admin/users/u%201" });
    await waitFor(() => expect(server.callsTo("GET /api/admin/users")).toHaveLength(2));

    fail = true;
    await act(() => hook.result.current.remove.mutateAsync("u 1").catch(() => undefined));
    await waitFor(() => expect(hook.result.current.remove.error?.message).toBe("Uma conta de administrador não se pode suspender nem apagar."));
    await waitFor(() => expect(server.callsTo("GET /api/admin/users")).toHaveLength(3));
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/admin.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/admin.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminUser } from "../shared/types";
import { apiFetch } from "./api";
import { ME_KEY } from "./auth";

export const ADMIN_USERS_KEY = ["admin-users"] as const;

/** Todas as contas (só o administrador a pode pedir). `enabled` evita pedi-la a quem não é administrador. */
export function useAdminUsers({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ADMIN_USERS_KEY,
    queryFn: async () => (await apiFetch<{ users: AdminUser[] }>("/api/admin/users")).users,
    enabled,
  });
}

/**
 * Mutação do painel: no fim, com êxito ou não (a lista pode estar velha), refaz a lista de contas e a sessão (o administrador também
 * pode mudar a sua própria quota, que a barra lateral mostra).
 */
function useAdminMutation<Variables, Data = void>(mutationFn: (variables: Variables) => Promise<Data>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ADMIN_USERS_KEY }),
        queryClient.invalidateQueries({ queryKey: ME_KEY }),
      ]),
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

Run: `npx vitest run -c vitest.web.config.ts src/web/admin.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  4 passed (4)`.

- [ ] **Step 2: A página, a rota e a ligação na barra lateral (testes primeiro)**

A tabela mostra o email (com «Admin» e «(você)» onde for o caso), o espaço usado com a barra de uso, o estado (Ativa, Suspensa, A remover), a data de criação e uma coluna de ações que a Task 7 preenche. Quem não é administrador, se for a `/admin`, volta a «Meu espaço» sem chegar a pedir a lista, e a ligação «Admin» só aparece para administradores (spec, secção 8). A API recusaria na mesma (403): isto é só para a interface não mostrar o que não funciona. A tabela tem uma legenda só para leitores de ecrã, cabeçalhos de coluna (`scope`) e rola na horizontal em ecrãs estreitos.

Criar `src/web/pages/AdminPage.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AdminUser } from "../../shared/types";
import { apiError, json, ME, mockApi, SESSION } from "../test/mock-api";
import { renderApp } from "../test/render";

const CREATED = new Date(2026, 9, 3, 12).getTime();
const ADMIN_ME = { ...ME, id: "adm", email: "admin@example.com", role: "admin" as const, quotaBytes: 10_737_418_240 };

const ADMIN: AdminUser = { id: "adm", email: "admin@example.com", role: "admin", status: "active", quotaBytes: 10_737_418_240, usedBytes: 0, createdAt: CREATED };
const ANA: AdminUser = { id: "u1", email: "ana@example.com", role: "user", status: "active", quotaBytes: 1_073_741_824, usedBytes: 536_870_912, createdAt: CREATED + 1000 };
const BOB: AdminUser = { id: "u2", email: "bob@example.com", role: "user", status: "suspended", quotaBytes: 1_073_741_824, usedBytes: 1536, createdAt: CREATED + 2000 };
const EVA: AdminUser = { id: "u3", email: "eva@example.com", role: "user", status: "deleting", quotaBytes: 1_073_741_824, usedBytes: 0, createdAt: CREATED + 3000 };

function serve(users: AdminUser[], extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    ...SESSION,
    "GET /api/auth/me": () => json({ user: ADMIN_ME }),
    "GET /api/folders/:id/contents": () => json({ folder: null, breadcrumb: [], folders: [], files: [] }),
    "GET /api/admin/users": () => json({ users }),
    ...extra,
  });
}

describe("AdminPage", () => {
  it("lista as contas com o espaço usado, o estado e a data, e marca o administrador e a própria conta", async () => {
    serve([ADMIN, ANA, BOB, EVA]);
    renderApp("/admin");

    expect(await screen.findByRole("heading", { name: "Utilizadores" })).toBeInTheDocument();
    expect(screen.getByText("4 contas.", { exact: false })).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1); // sem o cabeçalho
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual([
      "admin@example.com Admin (você)",
      "ana@example.com",
      "bob@example.com",
      "eva@example.com",
    ]);
    const ana = rows[1];
    expect(within(ana).getByText("512 MB de 1 GB")).toBeInTheDocument();
    expect(within(ana).getByRole("progressbar", { name: "Espaço usado por ana@example.com" })).toHaveAttribute("aria-valuenow", "50");
    expect(within(ana).getByText("Ativa")).toBeInTheDocument();
    expect(within(ana).getByText("03/10/2026")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Suspensa")).toBeInTheDocument();
    expect(within(rows[3]).getByText("A remover")).toBeInTheDocument();
  });

  it("«Admin» está na barra lateral só para o administrador, e fica ativo no painel", async () => {
    serve([ADMIN]);
    renderApp("/admin");
    const link = await screen.findByRole("link", { name: "Admin" });
    expect(link).toHaveAttribute("href", "/admin");
    expect(link.className).toContain("bg-indigo-50");
  });

  it("um utilizador normal não vê «Admin» e, se for a /admin, volta a «Meu espaço» sem pedir a lista", async () => {
    const server = mockApi({
      ...SESSION,
      "GET /api/folders/:id/contents": () => json({ folder: null, breadcrumb: [], folders: [], files: [] }),
      "GET /api/admin/users": () => apiError(403, "forbidden", "Só o administrador pode fazer isto."),
    });
    renderApp("/admin");

    expect(await screen.findByRole("heading", { name: "Meu espaço" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    expect(server.callsTo("GET /api/admin/users")).toHaveLength(0);
  });

  it("um erro do servidor mostra a mensagem e deixa tentar de novo", async () => {
    let calls = 0;
    serve([], {
      "GET /api/admin/users": () => (++calls === 1 ? apiError(500, "internal_error", "Erro interno do servidor.") : json({ users: [ADMIN] })),
    });
    renderApp("/admin");
    expect(await screen.findByText("Erro interno do servidor.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByRole("cell", { name: /admin@example\.com/ })).toBeInTheDocument();
  });

  it("«Atualizar» volta a pedir as contas", async () => {
    const server = serve([ADMIN]);
    renderApp("/admin");
    await screen.findByRole("heading", { name: "Utilizadores" });
    await userEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await screen.findByRole("button", { name: "Atualizar" });
    expect(server.callsTo("GET /api/admin/users").length).toBeGreaterThanOrEqual(2);
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/pages/AdminPage.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  4 failed | 1 passed (5)).

Em `src/web/components/UsageBar.tsx`, trocar:

```tsx
interface UsageBarProps {
  usedBytes: number;
  quotaBytes: number;
}

export function UsageBar({ usedBytes, quotaBytes }: UsageBarProps) {
```

por:

```tsx
interface UsageBarProps {
  usedBytes: number;
  quotaBytes: number;
  /** O nome acessível da barra (por defeito o da barra lateral; o painel do administrador tem uma por conta). */
  label?: string;
}

export function UsageBar({ usedBytes, quotaBytes, label = "Espaço utilizado" }: UsageBarProps) {
```

No mesmo ficheiro, trocar:

```tsx
        aria-label="Espaço utilizado"
```

por:

```tsx
        aria-label={label}
```

Criar `src/web/pages/AdminPage.tsx`:

```tsx
import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { formatDate } from "../../shared/format";
import type { AdminUser, UserStatus } from "../../shared/types";
import { errorMessage } from "../api";
import { useAdminUsers } from "../admin";
import { useMe } from "../auth";
import { Button } from "../components/Button";
import { Message } from "../components/Message";
import { UsageBar } from "../components/UsageBar";

const STATUS_LABEL: Record<UserStatus, string> = { active: "Ativa", suspended: "Suspensa", deleting: "A remover" };
const STATUS_STYLE: Record<UserStatus, string> = {
  active: "bg-emerald-50 text-emerald-700",
  suspended: "bg-amber-50 text-amber-800",
  deleting: "bg-slate-100 text-slate-600",
};

function UserRow({ user, isSelf, actions }: { user: AdminUser; isSelf: boolean; actions?: ReactNode }) {
  return (
    <tr className="align-middle hover:bg-slate-50">
      <td className="max-w-xs px-4 py-3">
        <span className="font-medium break-all text-slate-900">{user.email}</span>
        {user.role === "admin" && (
          <>
            {" "}
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">Admin</span>
          </>
        )}
        {isSelf && (
          <>
            {" "}
            <span className="text-xs text-slate-500">(você)</span>
          </>
        )}
      </td>
      <td className="w-56 px-4 py-3">
        <UsageBar usedBytes={user.usedBytes} quotaBytes={user.quotaBytes} label={`Espaço usado por ${user.email}`} />
      </td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[user.status]}`}>{STATUS_LABEL[user.status]}</span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDate(user.createdAt)}</td>
      <td className="w-12 px-4 py-3">{actions}</td>
    </tr>
  );
}

/** O painel do administrador: as contas, o espaço que usam e o estado de cada uma. Quem não é administrador volta a «Meu espaço». */
export default function AdminPage() {
  const me = useMe();
  const isAdmin = me.data?.role === "admin";
  const users = useAdminUsers({ enabled: isAdmin });

  if (me.data && !isAdmin) return <Navigate to="/" replace />;
  if (users.isPending) return <p className="text-slate-500">A carregar…</p>;
  if (users.isError && users.data === undefined) {
    return (
      <div className="max-w-md space-y-4">
        <Message kind="error">{errorMessage(users.error)}</Message>
        <Button variant="secondary" onClick={() => void users.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Utilizadores</h1>
        <Button variant="secondary" disabled={users.isFetching} onClick={() => void users.refetch()}>
          Atualizar
        </Button>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {users.data.length} {users.data.length === 1 ? "conta" : "contas"}. Uma conta apagada passa a «A remover» e a manutenção por hora elimina-a, com os ficheiros.
      </p>
      {users.isError && (
        <div className="mt-4">
          <Message kind="error">{errorMessage(users.error)}</Message>
        </div>
      )}
      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <caption className="sr-only">Contas de utilizadores</caption>
          <thead className="border-b border-slate-200 text-xs text-slate-500 uppercase">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Email
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Espaço
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Estado
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Criada a
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.data.map((user) => (
              <UserRow key={user.id} user={user} isSelf={user.id === me.data?.id} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

Em `src/web/App.tsx`, nos `import`, trocar:

```tsx
import AccountPage from "./pages/AccountPage";
```

por:

```tsx
import AccountPage from "./pages/AccountPage";
import AdminPage from "./pages/AdminPage";
```

Nas rotas, trocar:

```tsx
        <Route path="conta" element={<AccountPage />} />
```

por:

```tsx
        <Route path="conta" element={<AccountPage />} />
        <Route path="admin" element={<AdminPage />} />
```

Em `src/web/components/AppLayout.tsx`, na navegação da barra lateral, trocar:

```tsx
            <NavLink to="/conta" className={navClass}>
              Conta
            </NavLink>
```

por:

```tsx
            <NavLink to="/conta" className={navClass}>
              Conta
            </NavLink>
            {user.role === "admin" && (
              <NavLink to="/admin" className={navClass}>
                Admin
              </NavLink>
            )}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/pages/AdminPage.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  5 passed (5)`.

- [ ] **Step 3: Verificação e commit**

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  33 passed (33)`, `Tests  246 passed (246)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npm run build`
Expected: `✓ built in ...` duas vezes (Worker e cliente).

Commit:

```bash
git add src
git commit -m "Acrescenta o painel do administrador com a lista de contas e a ligação Admin" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Painel do administrador: alterar a quota, suspender, reativar e apagar contas

**Files:**
- Create: `src/web/components/QuotaDialog.tsx`, `src/web/components/UserActions.tsx`, `src/web/components/UserActions.test.tsx`
- Modify: `src/web/admin.ts`, `src/web/admin.test.tsx`, `src/web/pages/AdminPage.tsx`, `src/web/pages/AdminPage.test.tsx`

**Interfaces:**
- Consumes: `useUpdateUser`, `useDeleteUser` (Task 6), `isValidQuota`, `MAX_QUOTA_BYTES` (Task 5), `ConfirmDialog` (não se fecha enquanto `pending`), `Modal`, `RowMenu`, `useDialog`, `TextField`, `UserRow` e a ranhura `actions` (Task 6).
- Produces: `parseQuotaGb(text)`, `quotaToGbText(bytes)` e `QUOTA_HINT` em `src/web/admin.ts`; `QuotaDialog({ user, pending, error, onSubmit, onClose })`; `UserActions({ user })` (o menu «⋮» de cada conta e os seus diálogos).

- [ ] **Step 1: A quota em GB (testes primeiro)**

O administrador pensa em GB, a API fala em bytes. O campo aceita vírgula ou ponto (a interface é em português) e `parseQuotaGb` devolve os bytes, ou `null` se o texto não é um número entre 0 e 1 PiB (1 048 576 GB). `quotaToGbText` faz o caminho inverso para preencher o campo, com vírgula e no máximo duas casas decimais.

Em `src/web/admin.test.tsx`, nos `import`, trocar:

```tsx
import { useAdminUsers, useDeleteUser, useUpdateUser } from "./admin";
```

por:

```tsx
import { MAX_QUOTA_BYTES } from "../shared/validation";
import { parseQuotaGb, quotaToGbText, useAdminUsers, useDeleteUser, useUpdateUser } from "./admin";
```

Acrescentar ao fim de `src/web/admin.test.tsx`:

```tsx
describe("quota em GB", () => {
  it("lê o campo com vírgula ou ponto e devolve bytes", () => {
    expect(parseQuotaGb("1")).toBe(1_073_741_824);
    expect(parseQuotaGb(" 2,5 ")).toBe(2_684_354_560);
    expect(parseQuotaGb("0.25")).toBe(268_435_456);
    expect(parseQuotaGb("0")).toBe(0);
    expect(parseQuotaGb("1048576")).toBe(MAX_QUOTA_BYTES); // 1 PiB
  });

  it("recusa o que não é um número, é negativo ou passa o máximo", () => {
    for (const text of ["", " ", "abc", "-1", "1,2,3", "1e3", "1048577", "1 GB", "Infinity", "0x10"]) {
      expect(parseQuotaGb(text), JSON.stringify(text)).toBeNull();
    }
  });

  it("mostra a quota atual com vírgula e até duas casas", () => {
    expect(quotaToGbText(1_073_741_824)).toBe("1");
    expect(quotaToGbText(1_610_612_736)).toBe("1,5");
    expect(quotaToGbText(10_737_418_240)).toBe("10");
    expect(quotaToGbText(0)).toBe("0");
    expect(quotaToGbText(1_000_000_000)).toBe("0,93");
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/admin.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  3 failed | 4 passed (7)).

Em `src/web/admin.ts`, nos `import`, trocar:

```ts
import type { AdminUser } from "../shared/types";
import { apiFetch } from "./api";
```

por:

```ts
import type { AdminUser } from "../shared/types";
import { isValidQuota, MAX_QUOTA_BYTES } from "../shared/validation";
import { apiFetch } from "./api";
```

Acrescentar ao fim de `src/web/admin.ts`:

```ts
const GB = 1024 ** 3;
/** A quota máxima em GB (1 PiB), para a mensagem de erro. */
const MAX_QUOTA_GB = MAX_QUOTA_BYTES / GB;

/** A quota que o administrador escreveu, em GB (com vírgula ou ponto), em bytes; `null` se não for um número entre 0 e o máximo. */
export function parseQuotaGb(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const bytes = Math.round(Number(normalized) * GB);
  return isValidQuota(bytes) ? bytes : null;
}

/** A quota em GB para o campo de texto, com vírgula e no máximo duas casas decimais (1073741824 -> "1", 1610612736 -> "1,5"). */
export function quotaToGbText(bytes: number): string {
  return String(Math.round((bytes / GB) * 100) / 100).replace(".", ",");
}

export const QUOTA_HINT = `Indique a quota em GB, um número de 0 a ${MAX_QUOTA_GB} (por exemplo 1,5).`;
```

Run: `npx vitest run -c vitest.web.config.ts src/web/admin.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  7 passed (7)`.

- [ ] **Step 2: O menu das contas e os diálogos (testes primeiro)**

Cada conta ganha um menu «⋮» (`RowMenu`) com «Alterar quota…», «Suspender…» (ou «Reativar») e «Apagar conta…». Uma conta de administrador só tem a quota, como a API (403 `admin_protected` no resto); uma conta em remoção não tem menu. **Suspender** e **Apagar** pedem confirmação com o `ConfirmDialog` (que já não se fecha enquanto o pedido decorre); apagar avisa que não se pode desfazer, que a remoção acontece na manutenção de hora a hora e que o email fica ocupado até lá. **Reativar** não pede confirmação (não se perde nada); se falhar, o erro aparece por baixo do menu. O `QuotaDialog` aceita GB e mostra o espaço usado; segue a mesma regra de não se fechar a meio do pedido. O estado de cada diálogo é o do hook `useDialog` (Plano 3B). Depois de cada ação a lista refaz-se (Task 6), por isso a tabela mostra o estado novo.

Criar `src/web/components/UserActions.test.tsx`:

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AdminUser } from "../../shared/types";
import { apiError, json, mockApi } from "../test/mock-api";
import { queryWrapper, testQueryClient } from "../test/render";
import { UserActions } from "./UserActions";

const ANA: AdminUser = { id: "u1", email: "ana@example.com", role: "user", status: "active", quotaBytes: 1_073_741_824, usedBytes: 536_870_912, createdAt: 1 };
const MENU = "Ações para a conta ana@example.com";

function setup(user: AdminUser = ANA) {
  const user$ = userEvent.setup();
  const Wrapper = queryWrapper(testQueryClient());
  render(
    <Wrapper>
      <UserActions user={user} />
    </Wrapper>,
  );
  return user$;
}

async function choose(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(screen.getByRole("button", { name: MENU }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

const labels = () => screen.getAllByRole("menuitem").map((item) => item.textContent);

describe("UserActions: o menu", () => {
  it("uma conta ativa pode mudar de quota, ser suspensa e ser apagada", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: MENU }));
    expect(labels()).toEqual(["Alterar quota…", "Suspender…", "Apagar conta…"]);
  });

  it("uma conta suspensa pode ser reativada em vez de suspensa", async () => {
    const user = setup({ ...ANA, status: "suspended" });
    await user.click(screen.getByRole("button", { name: MENU }));
    expect(labels()).toEqual(["Alterar quota…", "Reativar", "Apagar conta…"]);
  });

  it("uma conta de administrador só muda de quota", async () => {
    const user = setup({ ...ANA, role: "admin" });
    await user.click(screen.getByRole("button", { name: MENU }));
    expect(labels()).toEqual(["Alterar quota…"]);
  });
});

describe("UserActions: quota", () => {
  it("mostra a quota atual em GB e o espaço usado, e envia a quota nova em bytes (vírgula ou ponto)", async () => {
    const server = mockApi({ "PATCH /api/admin/users/:id": () => json({ user: { ...ANA, quotaBytes: 2_684_354_560 } }) });
    const user = setup();
    await choose(user, "Alterar quota…");
    const dialog = screen.getByRole("dialog", { name: "Quota de ana@example.com" });
    expect(within(dialog).getByLabelText("Quota (GB)")).toHaveValue("1");
    expect(dialog).toHaveTextContent("Espaço usado: 512 MB.");

    await user.clear(within(dialog).getByLabelText("Quota (GB)"));
    await user.type(within(dialog).getByLabelText("Quota (GB)"), "2,5");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.callsTo("PATCH /api/admin/users/:id")[0]).toMatchObject({ params: { id: "u1" }, body: { quotaBytes: 2_684_354_560 } });
  });

  it("uma quota inválida nem chega ao servidor", async () => {
    const server = mockApi({ "PATCH /api/admin/users/:id": () => json({ user: ANA }) });
    const user = setup();
    await choose(user, "Alterar quota…");
    const field = screen.getByLabelText("Quota (GB)");
    for (const text of ["abc", "-1", "2000000"]) {
      await user.clear(field);
      await user.type(field, text);
      await user.click(screen.getByRole("button", { name: "Guardar" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Indique a quota em GB, um número de 0 a 1048576 (por exemplo 1,5).");
    }
    expect(server.callsTo("PATCH /api/admin/users/:id")).toHaveLength(0);
  });

  it("um erro do servidor fica no diálogo, que continua aberto", async () => {
    mockApi({ "PATCH /api/admin/users/:id": () => apiError(409, "account_deleting", "Esta conta está a ser removida.") });
    const user = setup();
    await choose(user, "Alterar quota…");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Esta conta está a ser removida.");
    expect(screen.getByRole("dialog", { name: "Quota de ana@example.com" })).toBeInTheDocument();
  });

  it("enquanto guarda, o diálogo não se fecha (Esc e fundo ignorados, «Cancelar» desativado)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mockApi({
      "PATCH /api/admin/users/:id": async () => {
        await gate;
        return json({ user: ANA });
      },
    });
    const user = setup();
    await choose(user, "Alterar quota…");
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));
    await within(dialog).findByRole("button", { name: "A guardar…" });

    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("modal-backdrop"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("UserActions: suspender e reativar", () => {
  it("suspender pede confirmação e envia o estado; «Cancelar» não envia nada", async () => {
    const server = mockApi({ "PATCH /api/admin/users/:id": () => json({ user: { ...ANA, status: "suspended" } }) });
    const user = setup();
    await choose(user, "Suspender…");
    const dialog = screen.getByRole("dialog", { name: "Suspender conta" });
    expect(dialog).toHaveTextContent("Suspender a conta de «ana@example.com»?");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(server.callsTo("PATCH /api/admin/users/:id")).toHaveLength(0);

    await choose(user, "Suspender…");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Suspender" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.callsTo("PATCH /api/admin/users/:id")[0].body).toEqual({ status: "suspended" });
  });

  it("reativar envia o estado logo, sem diálogo", async () => {
    const server = mockApi({ "PATCH /api/admin/users/:id": () => json({ user: ANA }) });
    const user = setup({ ...ANA, status: "suspended" });
    await choose(user, "Reativar");
    await waitFor(() => expect(server.callsTo("PATCH /api/admin/users/:id")).toHaveLength(1));
    expect(server.callsTo("PATCH /api/admin/users/:id")[0].body).toEqual({ status: "active" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("se reativar falha, o erro aparece por baixo do menu (e desaparece ao abrir outro diálogo)", async () => {
    mockApi({ "PATCH /api/admin/users/:id": () => apiError(409, "account_deleting", "Esta conta está a ser removida.") });
    const user = setup({ ...ANA, status: "suspended" });
    await choose(user, "Reativar");
    expect(await screen.findByRole("alert")).toHaveTextContent("Esta conta está a ser removida.");

    await choose(user, "Alterar quota…");

    expect(within(screen.getByRole("dialog")).queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("UserActions: apagar", () => {
  it("avisa que não se pode desfazer, apaga e fecha", async () => {
    const server = mockApi({ "DELETE /api/admin/users/:id": () => new Response(null, { status: 204 }) });
    const user = setup();
    await choose(user, "Apagar conta…");
    const dialog = screen.getByRole("dialog", { name: "Apagar conta" });
    expect(dialog).toHaveTextContent("Apagar a conta de «ana@example.com»?");
    expect(dialog).toHaveTextContent("não se pode desfazer");
    expect(dialog).toHaveTextContent("o email não pode ser registado outra vez");
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "Apagar conta" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.callsTo("DELETE /api/admin/users/:id")[0].params.id).toBe("u1");
  });

  it("um erro do servidor fica no diálogo", async () => {
    mockApi({ "DELETE /api/admin/users/:id": () => apiError(403, "admin_protected", "Uma conta de administrador não se pode suspender nem apagar.") });
    const user = setup();
    await choose(user, "Apagar conta…");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Apagar conta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Uma conta de administrador não se pode suspender nem apagar.");
    expect(screen.getByRole("dialog", { name: "Apagar conta" })).toBeInTheDocument();
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/UserActions.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/components/QuotaDialog.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import { formatBytes } from "../../shared/format";
import type { AdminUser } from "../../shared/types";
import { parseQuotaGb, QUOTA_HINT, quotaToGbText } from "../admin";
import { Button } from "./Button";
import { Message } from "./Message";
import { Modal } from "./Modal";
import { TextField } from "./TextField";

interface QuotaDialogProps {
  user: AdminUser;
  pending: boolean;
  /** Erro do servidor. */
  error: string | null;
  /** Recebe a quota nova, em bytes. */
  onSubmit: (quotaBytes: number) => void;
  onClose: () => void;
}

/** Muda a quota de uma conta, em GB. Uma quota abaixo do uso atual é permitida: só impede novos envios. */
export function QuotaDialog({ user, pending, error, onSubmit, onClose }: QuotaDialogProps) {
  const [text, setText] = useState(quotaToGbText(user.quotaBytes));
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const bytes = parseQuotaGb(text);
    setLocalError(bytes === null ? QUOTA_HINT : null);
    if (bytes !== null) onSubmit(bytes);
  }

  const shownError = localError ?? error;

  return (
    // Enquanto o pedido decorre o diálogo não se fecha (Esc e fundo ignorados), como o `ConfirmDialog`.
    <Modal title={`Quota de ${user.email}`} onClose={() => !pending && onClose()}>
      <form onSubmit={submit} className="space-y-4">
        <TextField
          label="Quota (GB)"
          name="quota"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          value={text}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setText(event.target.value)}
        />
        <p className="text-sm text-slate-600">
          Espaço usado: {formatBytes(user.usedBytes)}. Uma quota abaixo disto só impede novos envios: o que já lá está fica.
        </p>
        {shownError && <Message kind="error">{shownError}</Message>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "A guardar…" : "Guardar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
```

Criar `src/web/components/UserActions.tsx`:

```tsx
import type { AdminUser } from "../../shared/types";
import { useDeleteUser, useUpdateUser } from "../admin";
import { errorMessage } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";
import { QuotaDialog } from "./QuotaDialog";
import { RowMenu, type MenuAction } from "./RowMenu";
import { useDialog } from "./useDialog";

type Dialog = "quota" | "suspend" | "delete";

/**
 * O menu «⋮» de uma conta e os diálogos das suas ações: alterar a quota, suspender (ou reativar) e apagar. Uma conta de administrador só
 * muda de quota (a API recusa o resto). Reativar não pede confirmação (não perde nada); se falhar, o erro aparece por baixo do menu.
 */
export function UserActions({ user }: { user: AdminUser }) {
  const update = useUpdateUser();
  const remove = useDeleteUser();
  const { dialog, open, close } = useDialog<Dialog>(update, remove);

  function openDialog(name: Dialog) {
    update.reset(); // um erro de uma tentativa antiga (por exemplo, de «Reativar») não pode aparecer num diálogo que ainda ninguém confirmou
    remove.reset();
    open(name);
  }

  const actions: MenuAction[] = [{ label: "Alterar quota…", onSelect: () => openDialog("quota") }];
  if (user.role !== "admin") {
    actions.push(
      user.status === "suspended"
        ? { label: "Reativar", onSelect: () => update.mutate({ id: user.id, status: "active" }) }
        : { label: "Suspender…", onSelect: () => openDialog("suspend") },
      { label: "Apagar conta…", danger: true, onSelect: () => openDialog("delete") },
    );
  }
  const updateError = update.error ? errorMessage(update.error) : null;

  return (
    <>
      <RowMenu label={`Ações para a conta ${user.email}`} actions={actions} />
      {dialog === null && updateError && (
        <p role="alert" className="mt-1 max-w-48 text-xs text-red-700">
          {updateError}
        </p>
      )}
      {dialog === "quota" && (
        <QuotaDialog
          user={user}
          pending={update.isPending}
          error={updateError}
          onSubmit={(quotaBytes) => update.mutate({ id: user.id, quotaBytes }, { onSuccess: close })}
          onClose={close}
        />
      )}
      {dialog === "suspend" && (
        <ConfirmDialog
          title="Suspender conta"
          message={`Suspender a conta de «${user.email}»? As sessões dela terminam e não consegue entrar até a reativar. Os ficheiros ficam como estão.`}
          confirmLabel="Suspender"
          pendingLabel="A suspender…"
          pending={update.isPending}
          error={updateError}
          onConfirm={() => update.mutate({ id: user.id, status: "suspended" }, { onSuccess: close })}
          onClose={close}
        />
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title="Apagar conta"
          message={`Apagar a conta de «${user.email}»? Os ficheiros, as pastas e os links dela são eliminados de vez, e isto não se pode desfazer. A remoção acontece na próxima manutenção (de hora a hora) e, até lá, o email não pode ser registado outra vez.`}
          confirmLabel="Apagar conta"
          pendingLabel="A apagar…"
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

Run: `npx vitest run -c vitest.web.config.ts src/web/components/UserActions.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  12 passed (12)`.

- [ ] **Step 3: As ações na tabela (testes primeiro)**

Em `src/web/pages/AdminPage.test.tsx`, nos `import`, trocar:

```tsx
import { screen, within } from "@testing-library/react";
```

por:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
```

Acrescentar ao fim de `src/web/pages/AdminPage.test.tsx`:

```tsx
describe("AdminPage: ações", () => {
  it("suspender uma conta atualiza o estado na tabela e o menu passa a oferecer «Reativar»", async () => {
    let suspended = false;
    const server = serve([ADMIN, ANA], {
      "GET /api/admin/users": () => json({ users: [ADMIN, suspended ? { ...ANA, status: "suspended" } : ANA] }),
      "PATCH /api/admin/users/:id": () => {
        suspended = true;
        return json({ user: { ...ANA, status: "suspended" } });
      },
    });
    const user = userEvent.setup();
    renderApp("/admin");
    await user.click(await screen.findByRole("button", { name: "Ações para a conta ana@example.com" }));
    await user.click(screen.getByRole("menuitem", { name: "Suspender…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Suspender" }));

    const row = (await screen.findByText("Suspensa")).closest("tr")!;
    expect(within(row).getByText("ana@example.com")).toBeInTheDocument();
    expect(server.callsTo("PATCH /api/admin/users/:id")[0].body).toEqual({ status: "suspended" });
    await user.click(within(row).getByRole("button", { name: "Ações para a conta ana@example.com" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toContain("Reativar");
  });

  it("apagar uma conta passa-a a «A remover», sem menu de ações", async () => {
    let deleting = false;
    serve([ADMIN, ANA], {
      "GET /api/admin/users": () => json({ users: [ADMIN, deleting ? { ...ANA, status: "deleting" } : ANA] }),
      "DELETE /api/admin/users/:id": () => {
        deleting = true;
        return new Response(null, { status: 204 });
      },
    });
    const user = userEvent.setup();
    renderApp("/admin");
    await user.click(await screen.findByRole("button", { name: "Ações para a conta ana@example.com" }));
    await user.click(screen.getByRole("menuitem", { name: "Apagar conta…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Apagar conta" }));

    const row = (await screen.findByText("A remover")).closest("tr")!;
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a conta de administrador só tem «Alterar quota…», e mudar a própria quota atualiza a barra lateral", async () => {
    let quota = 10_737_418_240;
    const server = serve([], {
      "GET /api/auth/me": () => json({ user: { ...ADMIN_ME, quotaBytes: quota } }),
      "GET /api/admin/users": () => json({ users: [{ ...ADMIN, quotaBytes: quota }] }),
      "PATCH /api/admin/users/:id": ({ body }) => {
        quota = (body as { quotaBytes: number }).quotaBytes;
        return json({ user: { ...ADMIN, quotaBytes: quota } });
      },
    });
    const user = userEvent.setup();
    renderApp("/admin");
    await user.click(await screen.findByRole("button", { name: "Ações para a conta admin@example.com" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Alterar quota…"]);
    await user.click(screen.getByRole("menuitem", { name: "Alterar quota…" }));
    await user.clear(screen.getByLabelText("Quota (GB)"));
    await user.type(screen.getByLabelText("Quota (GB)"), "20");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.callsTo("PATCH /api/admin/users/:id")[0].body).toEqual({ quotaBytes: 21_474_836_480 });
    // a barra lateral (a sessão foi refeita) e a tabela mostram a quota nova
    await waitFor(() => expect(screen.getAllByText("0 B de 20 GB")).toHaveLength(2));
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/pages/AdminPage.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  3 failed | 5 passed (8)).

Em `src/web/pages/AdminPage.tsx`, nos `import`, trocar:

```tsx
import { UsageBar } from "../components/UsageBar";
```

por:

```tsx
import { UsageBar } from "../components/UsageBar";
import { UserActions } from "../components/UserActions";
```

Na tabela, trocar:

```tsx
              <UserRow key={user.id} user={user} isSelf={user.id === me.data?.id} />
```

por:

```tsx
              <UserRow
                key={user.id}
                user={user}
                isSelf={user.id === me.data?.id}
                actions={user.status === "deleting" ? undefined : <UserActions user={user} />}
              />
```

Run: `npx vitest run -c vitest.web.config.ts src/web/pages/AdminPage.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  8 passed (8)`.

- [ ] **Step 4: Verificação e commit**

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  34 passed (34)`, `Tests  264 passed (264)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npm run build`
Expected: `✓ built in ...` duas vezes (Worker e cliente).

Commit:

```bash
git add src
git commit -m "Acrescenta ao painel do administrador as ações: quota, suspender, reativar e apagar contas" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Documentação, verificação final e índice dos planos

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-10-03-spacework-design.md`, `docs/superpowers/plans/README.md`

**Interfaces:**
- Consumes: tudo o que as Tasks 1 a 7 entregam.
- Produces: o `README.md` com a API do administrador, o painel `/admin` e a secção «Manutenção»; a especificação com o que o desenho do cron e das contas decidiu; o índice dos planos com o 4 «Concluído» e os pendentes que ficam.

- [ ] **Step 1: README**

Em `README.md`, na tabela da secção «API», depois da última linha, acrescentar as rotas do administrador. Trocar:

```markdown
| `GET /api/public/shares/:token/download` | Público: descarrega o ficheiro partilhado (sempre como anexo) |
```

por:

```markdown
| `GET /api/public/shares/:token/download` | Público: descarrega o ficheiro partilhado (sempre como anexo) |
| `GET /api/admin/users` | Só admin: as contas (`id`, `email`, `role`, `status`, `quotaBytes`, `usedBytes`, `createdAt`), da mais antiga para a mais recente, incluindo as que estão a ser removidas |
| `PATCH /api/admin/users/:id` | Só admin: `{ quotaBytes?, status? }`. `quotaBytes` é um inteiro de bytes entre 0 e 2^50; `status` é `active` ou `suspended` (suspender termina as sessões da conta). Numa conta de admin só a quota muda (403 `admin_protected`); uma conta em remoção não se altera (409 `account_deleting`) |
| `DELETE /api/admin/users/:id` | Só admin: marca a conta para remoção (`deleting`) e termina as sessões; a remoção é do cron. Responde 204, também se a conta já estava em remoção; uma conta de admin não se apaga (403 `admin_protected`) |
```

Logo a seguir à tabela, trocar:

```markdown
Um link só funciona se não foi revogado nem expirou, o ficheiro está fora da lixeira e a conta do dono está ativa; nos outros casos a resposta é sempre `404 share_not_found`, sem dizer porquê.
```

por:

```markdown
Um link só funciona se não foi revogado nem expirou, o ficheiro está fora da lixeira e a conta do dono está ativa; nos outros casos a resposta é sempre `404 share_not_found`, sem dizer porquê.

As rotas `/api/admin/*` exigem também `role = admin` (senão 403 `forbidden`) e só gerem contas e quotas: **não há nenhuma rota para ver ou descarregar os ficheiros de outros utilizadores**, e o admin não consegue repor a senha de ninguém.
```

Na linha de `GET /api/trash`, trocar:

```markdown
(`purgeAt`; o cron que a aplica chega no Plano 4)
```

por:

```markdown
(`purgeAt`; é o cron de manutenção que a aplica)
```

Na secção «Interface», no parágrafo da lixeira, trocar:

```markdown
eliminação automática (o cron que a aplica chega no Plano 4)
```

por:

```markdown
eliminação automática (30 dias depois, por defeito, `TRASH_RETENTION_DAYS`; é o cron de manutenção que a aplica)
```

Ainda na secção «Interface», no fim do parágrafo de «Sair», acrescentar a administração e a secção «Manutenção». Trocar:

```markdown
Quando vários envios terminam, as listagens e a quota atualizam-se uma vez por meio segundo, e não uma vez por ficheiro.
```

por:

````markdown
Quando vários envios terminam, as listagens e a quota atualizam-se uma vez por meio segundo, e não uma vez por ficheiro.

**Administração** (`/admin`, só para o master; a quem não é admin o endereço leva a «Meu espaço» e a ligação «Admin» nem aparece na barra lateral): a tabela das contas, com o email, o espaço usado e a quota, o estado (Ativa, Suspensa ou A remover) e a data de criação. O menu «⋮» de cada conta tem:

- «Alterar quota…», em GB (aceita vírgula ou ponto; de 0 a 1 048 576 GB). Baixar a quota abaixo do que a conta já usa não apaga nada: só impede novos envios.
- «Suspender…» (pede confirmação): termina as sessões da conta e impede-a de entrar até ser reativada; os ficheiros ficam como estão e os links de partilha deixam de funcionar enquanto a conta estiver suspensa. «Reativar» não pede confirmação; a conta tem de entrar de novo.
- «Apagar conta…» (pede confirmação, não se pode desfazer): a conta passa a «A remover» e o cron elimina os ficheiros, as pastas e os links na manutenção seguinte.

As contas de administrador só têm a quota, e uma conta «A remover» não tem menu.

## Manutenção

Um cron (`0 * * * *`, de hora a hora, em `wrangler.jsonc`) corre `src/worker/cron.ts`. Cada execução trabalha em lotes limitados, para caber nos 50 subpedidos por invocação do plano gratuito do Workers (no pior caso gasta 32), e cada passo falha sozinho: se um falha, os outros correm na mesma e a execução termina com erro (fica visível no painel da Cloudflare).

1. **Lixeira:** elimina de vez os ficheiros excluídos há mais de `TRASH_RETENTION_DAYS` dias (até 300 por execução): apaga os objetos do R2 e as linhas da D1 e devolve o espaço.
2. **Envios pendentes:** limpa os envios que ficaram a meio há mais de 1 hora (até 150 por execução) e devolve a quota que tinham reservado.
3. **Contas em remoção:** até 2 contas por execução. Apaga os objetos do R2 pelo prefixo `u/<id>/` (até 2000 por conta e por execução: uma conta maior leva mais horas) e, só quando não resta nenhum, as linhas da D1 (partilhas, ficheiros, pastas, sessões e a conta). **Até isso acontecer o email continua ocupado:** registar-se com ele dá 409.
4. **Limpeza:** as sessões expiradas, as falhas de login com mais de 1 dia e os links revogados ou expirados há mais de 30 dias.

Para correr a manutenção à mão com `npm run dev` (D1 e R2 locais):

```bash
curl -X POST "http://localhost:5173/cdn-cgi/local/explorer/api/local/scheduled?worker=spacework" -H "Content-Type: application/json" -d '{"cron":"0 * * * *"}'
```

Em produção os erros de cada execução ficam nos registos do Worker (`wrangler tail` ou o painel da Cloudflare).
````

- [ ] **Step 2: Especificação**

A especificação chama `quota_bytes` à coluna e o Plano 4 chamou `quotaBytes` ao campo da API (como o resto da API, em *camelCase*). Também regista o que o desenho decidiu sobre o email de uma conta em remoção, os passos do cron e o orçamento de subpedidos.

Em `docs/superpowers/specs/2026-10-03-spacework-design.md`, na tabela da secção 6, linha «Admin», trocar:

```markdown
(`quota_bytes` e/ou `status` entre `active` e `suspended`)
```

por:

```markdown
(`quotaBytes`, inteiro de bytes entre 0 e 2^50, e/ou `status` entre `active` e `suspended`; na API os campos são em *camelCase*, e `quota_bytes` é a coluna da D1)
```

No parágrafo «Regras do admin», trocar:

```markdown
Apagar um utilizador define `status = deleting` e termina as sessões dele. A remoção dos ficheiros e das linhas é feita pelo cron.
```

por:

```markdown
Suspender também termina as sessões (ao reativar, as antigas não voltam a valer). Numa conta de admin só a quota se pode mudar (403 `admin_protected` para o resto), e uma conta em remoção já não se altera (409 `account_deleting`). Baixar a quota abaixo do que a conta já usa só impede novos uploads. Apagar um utilizador define `status = deleting` e termina as sessões dele, e é idempotente. A remoção dos ficheiros e das linhas é feita pelo cron (secção 7); **até lá o email continua ocupado**: registar-se com ele dá 409.
```

Na secção 7 («Cron de manutenção»), o passo 3 passa a descrever o que se faz de verdade e, a seguir à lista, entra o orçamento de subpedidos. Trocar:

```markdown
3. Utilizadores `deleting`: apagar os ficheiros do R2 (até 1000 chaves por chamada), depois as linhas de ficheiros, pastas, sessões e partilhas, e por fim o utilizador.
4. Limpar sessões expiradas, `login_failures` com mais de 1 dia e partilhas expiradas ou revogadas há mais de 30 dias.
```

por:

```markdown
3. Utilizadores `deleting` (no máximo 2 por execução): apagar os objetos do R2 pelo prefixo `u/{userId}/` (páginas de 1000 chaves, no máximo 2 páginas por conta e por execução; apanha também os órfãos), e só quando o prefixo fica vazio apagar, numa só *batch*, as linhas de partilhas, ficheiros, pastas, sessões e, por fim, o utilizador. Uma conta grande leva várias execuções.
4. Limpar sessões expiradas, `login_failures` com mais de 1 dia e partilhas expiradas ou revogadas há mais de 30 dias.

Orçamento de subpedidos por execução, no pior caso: lixeira 13 (até 300 ficheiros), `pending` 7 (até 150), contas em remoção 11 e limpeza 1, ou seja, 32 dos 50 do plano gratuito. Cada passo falha sozinho (os outros correm na mesma) e a execução acaba com erro se algum falhou.
```

Em «Por confirmar em produção», trocar:

```markdown
3. Tamanho dos lotes do cron no plano gratuito (máximo de 50 subpedidos por invocação).
```

por:

```markdown
3. Tamanho dos lotes do cron no plano gratuito (máximo de 50 subpedidos por invocação; o desenho do Plano 4 gasta 32 no pior caso: confirmar em produção que a contagem é a esperada e que o gatilho de hora a hora corre).
```

- [ ] **Step 3: Índice dos planos**

O índice já tem a linha do 4 como «Escrito, por executar» (veio com o commit deste plano). Passa a «Concluído»; os pendentes que o 4 resolveu ficam registados como resolvidos e os que ficam sem plano ganham o seu sítio; o Plano 5 recebe o que só um browser real e a Cloudflare podem confirmar.

Em `docs/superpowers/plans/README.md`, na tabela do topo, trocar:

```markdown
| 4 | [Admin e manutenção](2026-10-05-04-admin-e-manutencao.md) | API e painel de utilizadores (quotas, suspender e reativar, apagar contas) e o cron de manutenção por hora (lixeira expirada, envios pendentes, contas em remoção, sessões, falhas de login e partilhas velhas) | Escrito, por executar |
```

por:

```markdown
| 4 | [Admin e manutenção](2026-10-05-04-admin-e-manutencao.md) | API e painel de utilizadores (quotas, suspender e reativar, apagar contas) e o cron de manutenção por hora (lixeira expirada, envios pendentes, contas em remoção, sessões, falhas de login e partilhas velhas) | Concluído |
```

O bloco «Plano 4 (admin e manutenção)» passa de lista de pendentes a registo do que se resolveu e do que fica. Trocar:

```markdown
**Plano 4 (admin e manutenção)**
- Suspender uma conta tem de **apagar as suas sessões** (o filtro por `status` não chega: ao reativar, as sessões antigas voltariam a valer).
- Troca de senha: `UPDATE` da senha e revogação das outras sessões numa só `db.batch`.
- O cron purga `login_failures` com mais de 1 dia; uma conta `deleting` continua a ocupar o email no registo até ser removida; apagar as pastas depois dos ficheiros (chaves estrangeiras); índices para as varreduras do cron (`pending` por `created_at`, lixeira por `deleted_at`).
- Teste que fixe a forma exata do `user` nas respostas (sem `password_hash`), sobretudo em `GET /api/admin/users`; correr `npm run cf-typegen` quando o cron entrar em `wrangler.jsonc`.
- Novo (revisão final do 2A): no cron dos `pending`, o corte de idade tem de ser maior do que a duração máxima de um upload, e o `UPDATE ... 'ready'` (em `routes/files.ts`) passa a `AND status = 'pending'` com `meta.changes` verificado.
- Novo: índice parcial `files (created_at) WHERE status = 'pending'`.
- Novo: apagar os objetos de uma conta pelo prefixo `u/<userId>/` (apanha também os órfãos de `releaseReservation`).
- Novo: as pastas de uma conta apagam-se com um só `DELETE ... WHERE user_id = ?`, depois dos ficheiros.
- Novo (3A): o cron da lixeira usa `purgeTrashed` (`lib/trash.ts`, no máximo 50 ficheiros por chamada), que já desconta a quota e tira os objetos do R2; se o R2 falhar o objeto fica órfão e só aparece no registo (a varredura pelo prefixo `u/<userId>/` só apanha os órfãos quando a conta é removida: os de contas ativas ficam). `purgeTrashed` trabalha para um só utilizador por chamada: o cron tem de agrupar os ficheiros expirados por utilizador, ou generalizar a função a vários donos num só `UPDATE users … WHERE id IN (…)`. O cron apaga ainda as partilhas revogadas ou expiradas há mais de 30 dias (as de ficheiros eliminados saem em cascata).
- Novo (revisão final do 3A): uma tabela de chaves por apagar (*outbox*) para as falhas do R2; índice parcial `shares (file_id) WHERE revoked_at IS NULL`; os links revogados ou expirados acumulam-se até o cron os limpar; `DELETE /api/trash/:id` com 404 ainda executa o `UPDATE users` (escrita sem efeito).
```

por:

```markdown
**Plano 4 (admin e manutenção): resolvido no Plano 4**
- Resolvido: suspender uma conta apaga as suas sessões na mesma `batch` do `UPDATE` (o filtro por `status` não chegava: ao reativar, as sessões antigas voltariam a valer); apagar uma conta (`deleting`) também as termina.
- Resolvido: a troca de senha é uma só `db.batch` (o `UPDATE` da senha e a revogação das outras sessões, com `deleteUserSessionsStatement`).
- Resolvido: o cron de manutenção (`src/worker/cron.ts`, de hora a hora, com um passo isolado por tarefa: o que um passo falha não pára os outros e a execução acaba com erro): elimina a lixeira expirada, os envios `pending` com mais de 1 hora, as contas em remoção, as sessões expiradas, as `login_failures` com mais de 1 dia e as partilhas revogadas ou expiradas há mais de 30 dias. No pior caso gasta 32 dos 50 subpedidos de uma invocação.
- Resolvido: o `UPDATE … 'ready'` do upload passou a `AND status = 'pending'` com `meta.changes` verificado (se o cron já limpou o envio, o objeto do R2 sai e a resposta é 409 `upload_expired`), e o corte do cron (1 hora) é maior do que qualquer upload.
- Resolvido: `purgeTrashed` foi generalizado em `lib/purge.ts` (`purgeFiles`: o `UPDATE users` desconta a quota de cada dono e o `DELETE … RETURNING r2_key` apaga as linhas, com a mesma condição, para vários donos de uma vez), por isso o cron não agrupa por utilizador; a escrita sem efeito de `DELETE /api/trash/:id` com 404 desapareceu.
- Resolvido: a remoção de uma conta apaga primeiro os objetos do R2 pelo prefixo `u/<userId>/` (apanha também os órfãos de `releaseReservation`) e só quando o prefixo está vazio apaga as linhas, filhos primeiro (partilhas, ficheiros, pastas num só `DELETE … WHERE user_id`, sessões, utilizador). Uma conta grande leva várias execuções.
- Resolvido: migração `0003_maintenance_indexes.sql` com os índices parciais das varreduras do cron (`files_pending_created`, `files_trash_expiry`, `login_failures_failed_at`, `shares_revoked_at`, `shares_expires_at`, `users_deleting`); um teste confirma com `EXPLAIN QUERY PLAN` que as consultas os usam.
- Resolvido: `GET /api/admin/users` tem um teste que fixa a forma exata de cada conta (sem `password_hash`) e a lista de rotas de `admin.ts` está fixada por outro (só gerem contas e quotas: nenhuma lê ficheiros alheios); `npm run cf-typegen` correu depois de o cron entrar em `wrangler.jsonc` e `worker-configuration.d.ts` não mudou.
- Decidido: uma conta `deleting` continua a ocupar o email (registar-se com ele dá 409) até o cron a remover, no máximo uma hora ou algumas mais se a conta for grande; fica dito na especificação, no README e no aviso do diálogo «Apagar conta…».
- Fica sem plano (4): uma tabela de chaves por apagar (*outbox*) para as falhas do R2 (se o R2 falha ao apagar o objeto de um ficheiro eliminado de uma conta ativa, o objeto fica órfão e só aparece no registo; a varredura por prefixo só o apanha quando a conta é removida); o índice parcial `shares (file_id) WHERE revoked_at IS NULL`; a remoção das linhas de uma conta enorme é uma só `batch` na D1 (uma conta com centenas de milhares de ficheiros pode não caber nos limites de uma instrução); um login que corre ao mesmo tempo que a suspensão pode criar uma sessão que a suspensão não apaga (o filtro por estado recusa-a enquanto a conta está suspensa, mas voltaria a valer ao reativar); a tabela de contas no telemóvel rola na horizontal (não há vista em cartões) e não tem paginação (a spec dispensa-a na v1).
```

Na secção «Plano 5 (deploy)», antes do ponto «Novo (revisão final do 3A)», trocar:

```markdown
- Novo (revisão final do 3A): teste de fumo
```

por:

```markdown
- Novo (4), browser real com o Playwright: o painel `/admin` (alterar a quota, suspender e reativar, apagar uma conta); a conta suspensa perde a sessão e o login dá erro; a quota 0 impede um envio; a conta apagada fica «A remover» e desaparece depois da manutenção. Em produção: confirmar que o gatilho `0 * * * *` corre, que a execução mais pesada cabe nos 50 subpedidos (se não couber, baixar `TRASH_BLOCKS`, `PENDING_BLOCKS` ou `ACCOUNTS_PER_RUN` em `cron.ts` e `account-removal.ts`) e decidir um alerta para quando a execução termina com erro.
- Novo (revisão final do 3A): teste de fumo
```

- [ ] **Step 4: Verificação manual no browser**

Os testes correm em jsdom e no runtime do Workers: não veem o aspeto, o foco nem o gatilho do cron de verdade. Percorrer este guião num browser real, com contas **fictícias** numa base local limpa (nunca com credenciais reais; apagar `.wrangler` no fim):

1. `npm run db:migrate:local && npm run dev`, abrir `http://localhost:5173` e registar `admin@example.test` com uma senha inventada na hora. Sair e registar também `ana@example.test` e `bruno@example.test`. Promover a primeira a administradora: `npx wrangler d1 execute DB --local --command "UPDATE users SET role = 'admin' WHERE email = 'admin@example.test'"` (o `npm run seed:master` serve para o master a sério; aqui não se usam as credenciais dele).
2. Como `ana`, carregar um ficheiro e criar um link de partilha (guardar o link). Sair.
3. Como `admin`, abrir «Admin» na barra lateral: a tabela mostra as três contas, a do admin com o selo «Admin» e «(você)» e **só** «Alterar quota…» no menu. Como `ana`, o endereço `/admin` leva a «Meu espaço» e a barra lateral não tem «Admin».
4. **Quota:** menu de `ana` → «Alterar quota…» → `abc` mostra a dica e o diálogo não fecha; `0` grava e a tabela mostra a quota a 0. Como `ana`, carregar outro ficheiro dá «Sem espaço suficiente na sua quota.». Repor `1,5`.
5. **Suspender:** menu de `ana` → «Suspender…» → confirmar: o estado passa a «Suspensa». A sessão de `ana` deixa de valer (o pedido seguinte volta ao login), entrar dá erro, e o link de partilha dela mostra «Este link não existe ou já não está disponível.». «Reativar» (sem confirmação) devolve «Ativa»: `ana` tem de entrar de novo e o link volta a funcionar.
6. **Apagar:** menu de `bruno` → «Apagar conta…» → o aviso fala de irreversível e do email ocupado; confirmar. A conta fica «A remover» e deixa de ter menu. Registar `bruno@example.test` outra vez dá «Este email já está registado.».
7. **Cron:** `curl -X POST "http://localhost:5173/cdn-cgi/local/explorer/api/local/scheduled?worker=spacework" -H "Content-Type: application/json" -d '{"cron":"0 * * * *"}'`; depois de recarregar «Admin», `bruno` já não está na tabela e o email volta a poder registar-se.
8. Parar o `npm run dev` e apagar a pasta `.wrangler`.

- [ ] **Step 5: Verificação final e commit**

Run: `npx vitest run`
Expected: `Test Files  36 passed (36)`, `Tests  316 passed (316)`.

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  34 passed (34)`, `Tests  264 passed (264)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npm run build`
Expected: `✓ built in ...` duas vezes (Worker e cliente).

Commit:

```bash
git add README.md docs
git commit -m "Documenta o painel do administrador e a manutenção por cron e fecha o Plano 4" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Auto-revisão do plano contra a especificação

| Requisito | Onde |
|---|---|
| Spec §6, `GET /api/admin/users`, `PATCH` (`quotaBytes` e/ou `status`) e `DELETE`; só `role = admin`; nenhuma rota para ver ficheiros alheios (lista de rotas fixada por um teste) | Task 5 |
| Spec §6, contas de admin não se suspendem nem se apagam; apagar põe `deleting` e termina as sessões; suspender termina as sessões | Tasks 1 e 5 |
| Spec §7.1, lixeira com mais de `TRASH_RETENTION_DAYS`: R2, D1 e quota | Tasks 2 e 3 |
| Spec §7.2, `pending` com mais de 1 hora: linha, objeto e quota; o envio que perdeu a reserva não responde 201 | Tasks 1, 2 e 3 |
| Spec §7.3, contas `deleting`: objetos do R2 (por prefixo) e depois as linhas e o utilizador | Task 4 |
| Spec §7.4, sessões expiradas, `login_failures` com mais de 1 dia, partilhas expiradas ou revogadas há mais de 30 dias | Task 3 |
| Spec §7, lotes limitados para os 50 subpedidos por invocação (testes contam os subpedidos no pior caso) | Tasks 3 e 4 |
| Spec §8, `/admin`: tabela (email, usado/quota, estado, data), alterar a quota, suspender, reativar, apagar | Tasks 6 e 7 |
| Pendente do Plano 1: a troca de senha numa só `batch` | Task 1 |
| Pendente do Plano 2A: o corte do cron dos `pending` e o `UPDATE … 'ready'` com `AND status = 'pending'` | Tasks 1 e 3 |
| Pendente do Plano 3A: `purgeTrashed` para vários donos (sem agrupar por utilizador), sem escrita inútil no 404 de `DELETE /api/trash/:id` | Task 2 |
| Pendente: índices das varreduras (inclui o parcial dos `pending`); a forma do utilizador sem `password_hash`; `cf-typegen` com o cron | Tasks 1, 3 e 5 |
| Pendente: o email de uma conta `deleting` fica ocupado até ser removida (documentado) | Tasks 4, 5, 7 e 8 |
| README, especificação e índice dos planos | Task 8 |

**Fora deste plano:** o deploy, o Playwright e as medições na Cloudflare (CPU do PBKDF2, a contagem real de subpedidos do cron, o limite de pedidos): Plano 5. Ficam sem plano (e registados no índice): a tabela de chaves por apagar para as falhas do R2 em contas ativas, o índice parcial `shares (file_id) WHERE revoked_at IS NULL`, a remoção das linhas de uma conta enorme numa só `batch`, a corrida entre um login e a suspensão, e a tabela de contas no telemóvel.

**Totais de testes (medidos na execução deste plano numa pasta limpa):** Worker: Test Files 36 passed (36); Tests 316 passed (316). Interface: Test Files 34 passed (34); Tests 264 passed (264).

## Notas da execução

- **Decisões de desenho que a especificação deixa em aberto:** a quota na API é `quotaBytes` (a coluna é `quota_bytes`), em bytes; na interface, em GB com vírgula ou ponto. Numa conta de admin só a quota muda. Uma conta em `deleting` ocupa o email até o cron a remover (o aviso do diálogo «Apagar conta…» di-lo): o email é único e a linha só sai no fim, depois de o R2 estar limpo. A remoção de uma conta grande reparte-se por execuções (2 páginas de 1000 objetos por conta e por execução) e as linhas só saem quando o prefixo no R2 está vazio. «Reativar» não pede confirmação (não se perde nada); «Suspender» e «Apagar» sim.
- **A conta do orçamento do cron:** lixeira 1 consulta + 6 blocos × 2 = 13; pendentes 1 + 3 × 2 = 7; contas em remoção 1 + 2 × (2 × 2 + 1) = 11; limpeza 1 `batch` = 1. Somam 32 no pior caso: um teste conta os subpedidos reais de uma execução com contas grandes a acabar (32) e outro os das restantes etapas sem contas em remoção (22).
- **Defeitos que a verificação encontrou, já corrigidos neste plano:** o erro de «Reativar» aparecia dentro do diálogo da quota aberto a seguir (a mutação partilhada guardava o erro antigo): `UserActions` repõe as mutações ao abrir cada diálogo. Ao escrever os testes da remoção de contas, o passo da lixeira apagava primeiro o ficheiro excluído da conta (já expirado) e o teste esperava contá-lo na remoção: o ficheiro do teste passou a estar na lixeira mas ainda não expirado. E o `npm run cf-typegen` não altera `worker-configuration.d.ts` quando o cron entra em `wrangler.jsonc`.
- **Verificação manual:** o guião da Task 8 foi percorrido contra o `npm run dev` durante a escrita deste plano, com contas fictícias numa base local limpa: a tabela de contas, a quota 0 a impedir um envio, suspender e reativar (a sessão cai e o login falha), apagar («A remover», sem menu, email ocupado) e, com o gatilho local do cron, a conta a sair e o email a ficar livre. O passo do guião sobre o link de partilha da conta suspensa (deixa de funcionar e volta ao reativar) segue o que o código e os testes da API pública garantem, mas não foi percorrido no browser: confirmá-lo ao executar.
