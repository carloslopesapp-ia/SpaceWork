# SpaceWork — Plano 3A: API da lixeira, pesquisa e partilha (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A API da lixeira (listar, restaurar com sufixo, eliminar de vez, esvaziar), da pesquisa por nome e da partilha por link (criar com validade opcional, listar, revogar, e as rotas públicas de nome, tamanho e descarregamento) — tudo isolado por utilizador e testado. A interface é o Plano 3B.

**Architecture:** Cinco grupos de rotas novos sobre o Worker dos Planos 1 a 2B: `/api/search`, `/api/trash`, as rotas de partilha (`/api/files/:id/shares` e `/api/shares/:id`) e as públicas (`/api/public`, as únicas sem sessão além do registo, do login e do `health`). A lixeira usa o `deleted_at` que o Plano 2A já grava: eliminar de vez é uma só `batch` (`UPDATE` da quota e `DELETE ... RETURNING`), por blocos de 50 ficheiros para respeitar o limite de chamadas por invocação do plano gratuito, e só apaga do R2 os objetos das linhas que saíram mesmo. Os caminhos de vários itens (pesquisa e lixeira) calculam-se com uma consulta recursiva por bloco de 50 pastas, nunca uma por item. O token de uma partilha tem 32 bytes aleatórios e a D1 guarda só o hash, como nas sessões.

**Tech Stack:** o dos planos anteriores (Hono, D1, R2, Vitest com `@cloudflare/vitest-plugin`); nenhuma dependência nova.

**Spec:** [docs/superpowers/specs/2026-10-03-spacework-design.md](../specs/2026-10-03-spacework-design.md) (secção 3, tabelas `files` e `shares`; secção 4, isolamento e servir ficheiros; secção 5, operações, pesquisa e partilha; secção 6, rotas; secção 7, o que o cron do Plano 4 vai reutilizar). Índice dos planos: [README.md](README.md). Este plano trata também dos pendentes do Plano 3 que são da API (secção "Pendentes herdados" do índice).

## Global Constraints

Valores da especificação e dos planos anteriores; todas as tarefas os cumprem implicitamente.

- Todas as consultas filtram pelo utilizador da sessão; o id de outro utilizador dá 404 (nunca 403). As rotas públicas só servem um ficheiro por um link ativo, e todos os casos em que não servem dão a mesma resposta `404 share_not_found`.
- Erros da API em JSON: `{ "error": "<código>", "message": "<texto em português>" }`. Pedidos `POST`/`PUT`/`PATCH`/`DELETE` exigem `Origin` igual à origem do pedido (já garantido pelo middleware do Plano 1). O corpo JSON tem no máximo 64 KiB em toda a API, menos no upload.
- Lixeira: excluir é pôr `deleted_at` (Plano 2A); `used_bytes` inclui os ficheiros na lixeira até à eliminação definitiva. Restaurar limpa `deleted_at`; se o nome já existe no destino, acrescenta " (restaurado)", " (restaurado 2)", …; se a pasta original já não existe, vai para a raiz. Eliminar de vez apaga o objeto do R2 e a linha, e desconta o tamanho em `used_bytes` (nunca abaixo de 0).
- Pesquisa: `name_norm LIKE %q%` com `%` e `_` escapados; mínimo 2 caracteres; no máximo 50 resultados; só itens `ready` e fora da lixeira; cada resultado com o caminho completo.
- Partilha: token de 32 bytes aleatórios; a D1 guarda só o hash; o link completo só aparece na resposta da criação; a validade é opcional; o link só vale se o ficheiro estiver `ready` e fora da lixeira e o link não estiver expirado nem revogado (e a conta do dono estiver ativa).
- O plano gratuito do Workers limita as chamadas a D1 e R2 a 50 por invocação: nunca uma consulta por item de uma lista; operações em lote por blocos de 50.
- Descarregar: `Content-Disposition: attachment`; todas as respostas levam `X-Content-Type-Options: nosniff` e `Cache-Control: no-store`.
- IDs `crypto.randomUUID()`; datas em milissegundos Unix. Vitest `^4.1`.
- O estado da D1 **e do R2** de teste não é isolado entre testes do mesmo ficheiro: usar `beforeEach(resetState)` (ou `resetDb`) em todos os testes que gravam.
- Mensagens ao utilizador em português europeu.
- **Nenhum `git push` sem confirmação explícita do utilizador.**

## Ambiente

- Node 24 e npm 11; todos os comandos correm na raiz do repositório (`~/Developer/SpaceWork`, fora do iCloud). Ramo de trabalho: `plano-3a-api-lixeira-partilha`.
- Commits: mensagem curta em português; cada commit termina com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (nos comandos abaixo, é o segundo `-m`). Escrever **exatamente** esse trailer, "Claude Sonnet 5.5", mesmo que o modelo que executa seja outro.
- Os testes deste plano são todos do Worker: `npx vitest run`. Os da interface (`npx vitest run -c vitest.web.config.ts`) não mudam. Mostram só o resumo do Vitest: se aparecer qualquer outra saída (avisos do `workerd`, `console.warn`), é um defeito do teste a corrigir.

## Estrutura de ficheiros deste plano

```
src/shared/types.ts                 + SearchResult, TrashItem, TrashContents, ShareItem, PublicShare
src/worker/lib/serve.ts             missingObject, attachmentResponse (extraídos de routes/files.ts)
src/worker/lib/paths.ts             pathsForFolders, trailOf
src/worker/lib/trash.ts             purgeTrashed (o cron do Plano 4 reutiliza-o)
src/worker/lib/restore-names.ts     restoreCandidates
src/worker/lib/shares.ts            activeShare, parseExpiry, rowToShare
src/worker/routes/search.ts         GET /api/search
src/worker/routes/trash.ts          /api/trash
src/worker/routes/file-shares.ts    POST e GET /api/files/:id/shares
src/worker/routes/shares.ts         DELETE /api/shares/:id
src/worker/routes/public.ts         /api/public (sem sessão)
test/                               testes de cada área; helper dbCountingPrepares
```

---


### Task 1: Arrumações no Worker: limite do corpo por construção, quota sem `changes()`, ajudantes de servir e dívida de testes

**Files:**
- Create: `src/worker/lib/serve.ts`
- Modify: `src/worker/app.ts`, `src/worker/routes/files.ts`, `src/worker/lib/files.ts`
- Modify: `test/hardening.test.ts`, `test/files-manage.test.ts`, `test/schema-constraints.test.ts`, `test/folders-depth.test.ts`, `test/folders-races.test.ts`

**Interfaces:**
- Consumes: `jsonBodyLimit` (Plano 2A), `contentDisposition`, `ApiError`, `registerUser`, `uploadFile`, `patchWithRace`, `insertChain`.
- Produces: o limite de 64 KiB montado em `/api/*` (menos `PUT /api/files`); `missingObject(fileId)` e `attachmentResponse(object, file)` em `src/worker/lib/serve.ts`
  (as Tasks 6 e 7 usam-nos para o descarregamento público); `fileNameTaken()` em `src/worker/lib/files.ts` (a Task 5 usa-o no restauro);
  `releaseReservation` sem depender de `changes()`.

- [ ] **Step 1: O limite de 64 KiB por construção (teste primeiro)**

Hoje o `jsonBodyLimit` está montado rota a rota (`/api/auth/*`, `/api/folders/*` e o `PATCH` dos ficheiros): uma rota nova que se esqueça dele fica sem limite. Passa a valer para toda a API, menos o upload (`PUT /api/files`), que vai em *stream* e tem o seu próprio limite.

Em `test/hardening.test.ts`, substituir o bloco de `import` no topo do ficheiro (todas as linhas de `import`, até à linha em branco) por:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { HTTPException } from "hono/http-exception";
import { app } from "../src/worker/app";
import { JSON_BODY_LIMIT_BYTES } from "../src/worker/middleware/body-limit";
import { registerUser } from "./auth-helpers";
import { uploadFile } from "./file-helpers";
import { api, resetState } from "./helpers";
```

Em `test/hardening.test.ts`, o novo teste grava no R2, por isso trocar:

```ts
beforeEach(resetDb);
```

por:

```ts
beforeEach(resetState);
```

Acrescentar ao fim de `test/hardening.test.ts`:

```ts
describe("o limite do corpo vale para toda a API, menos o upload", () => {
  it("recusa com 413 corpos acima de 64 KiB em qualquer método e rota, mesmo sem sessão", async () => {
    const big = "x".repeat(JSON_BODY_LIMIT_BYTES + 1);
    const attempts = [
      ["POST", "/api/files/x"],
      ["PATCH", "/api/files/x"],
      ["DELETE", "/api/files/x"],
      ["POST", "/api/folders"],
    ] as const;
    for (const [method, path] of attempts) {
      const res = await api(path, { method, body: big, headers: { "Content-Type": "application/json" } });
      expect(res.status, `${method} ${path}`).toBe(413);
    }
  });

  it("o upload (PUT /api/files) fica de fora: vai em stream e tem o seu próprio limite", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const res = await uploadFile(cookie, "grande.bin", new Uint8Array(JSON_BODY_LIMIT_BYTES + 1));
    expect(res.status).toBe(201);
  });
});
```

Run: `npx vitest run test/hardening.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  1 failed | 5 passed (6)).

Em `src/worker/app.ts`, trocar:

```ts
app.use("/api/auth/*", jsonBodyLimit);
app.use("/api/folders/*", jsonBodyLimit);
```

por:

```ts
// O limite de 64 KiB vale para toda a API, menos o upload (`PUT /api/files`), que vai em stream e tem o seu próprio limite.
// Montado aqui e não rota a rota: uma rota nova não se pode esquecer dele.
app.use("/api/*", (c, next) =>
  c.req.method === "PUT" && /^\/api\/files\/?$/.test(c.req.path) ? next() : jsonBodyLimit(c, next),
);
```

Em `src/worker/routes/files.ts`, o `PATCH` já não precisa do seu limite próprio. Nos `import`, trocar:

```ts
import { jsonBodyLimit } from "../middleware/body-limit";
import { createAuthedRouter } from "./authed";
```

por:

```ts
import { createAuthedRouter } from "./authed";
```

No mesmo ficheiro, trocar:

```ts
files.patch("/:id", jsonBodyLimit, async (c) => {
```

por:

```ts
files.patch("/:id", async (c) => {
```

Run: `npx vitest run test/hardening.test.ts test/files-manage.test.ts test/folders.test.ts`
Expected: `Test Files  3 passed (3)`, `Tests  39 passed (39)`.

- [ ] **Step 2: `releaseReservation` sem depender do `changes()` da instrução anterior**

Na `batch` que desfaz uma reserva, o desconto da quota dependia de `changes() = 1` da instrução anterior. Passa a depender da própria linha (`EXISTS`) e vem **antes** do `DELETE`. É um refactor: os testes existentes (falha do R2, libertação, `ready` intocado) têm de continuar a passar.

Em `src/worker/routes/files.ts`, no comentário de `releaseReservation`, trocar:

```ts
 * Desfaz a reserva de um upload que falhou: apaga a linha `pending` e devolve o espaço, numa só
 * `batch` (o `changes()` garante que o espaço só é devolvido se a linha foi mesmo apagada).
```

por:

```ts
 * Desfaz a reserva de um upload que falhou: devolve o espaço e apaga a linha `pending`, numa só
 * `batch` (o espaço só se devolve se a linha `pending` ainda existe).
```

No corpo da função, trocar:

```ts
    const [deleted] = await env.DB.batch([
      env.DB.prepare("DELETE FROM files WHERE id = ?1 AND status = 'pending'").bind(fileId),
      env.DB.prepare(
        "UPDATE users SET used_bytes = MAX(used_bytes - ?1, 0) WHERE id = ?2 AND changes() = 1",
      ).bind(size, userId),
    ]);
```

por:

```ts
    const [, deleted] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE users SET used_bytes = MAX(used_bytes - ?1, 0)
         WHERE id = ?2 AND EXISTS (SELECT 1 FROM files WHERE id = ?3 AND status = 'pending')`,
      ).bind(size, userId, fileId),
      env.DB.prepare("DELETE FROM files WHERE id = ?1 AND status = 'pending'").bind(fileId),
    ]);
```

Run: `npx vitest run test/files-upload.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  25 passed (25)`.

- [ ] **Step 3: Extrair os ajudantes de servir ficheiros para `lib/serve.ts`**

O descarregamento público (Task 7) serve o ficheiro do mesmo modo que o autenticado; os ajudantes passam a ser partilhados. Refactor: `test/files-download.test.ts` tem de continuar verde.

Criar `src/worker/lib/serve.ts`:

```ts
import { ApiError } from "../errors";
import { contentDisposition } from "./files";

/** O ficheiro existe na D1 mas o R2 não tem o objeto: fica registado e a resposta é 404 `file_missing`. */
export function missingObject(fileId: string): ApiError {
  console.error(`O ficheiro ${fileId} existe na D1 mas não tem objeto no R2.`);
  return new ApiError(404, "file_missing", "O conteúdo do ficheiro não está disponível.");
}

/** Resposta de descarga: o conteúdo em *stream*, sempre como anexo (nunca é interpretado pelo browser). */
export function attachmentResponse(object: R2ObjectBody, file: { name: string; mime: string }): Response {
  return new Response(object.body, {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(object.size),
      "Content-Disposition": contentDisposition("attachment", file.name),
      ETag: object.httpEtag,
    },
  });
}
```

Em `src/worker/routes/files.ts`, apagar a função local `missingObject` (passou para `lib/serve.ts`):

```ts
function missingObject(fileId: string): ApiError {
  console.error(`O ficheiro ${fileId} existe na D1 mas não tem objeto no R2.`);
  return new ApiError(404, "file_missing", "O conteúdo do ficheiro não está disponível.");
}
```

Nos `import`, trocar:

```ts
import { parseName } from "../lib/names";
import { createAuthedRouter } from "./authed";
```

por:

```ts
import { parseName } from "../lib/names";
import { attachmentResponse, missingObject } from "../lib/serve";
import { createAuthedRouter } from "./authed";
```

Na rota `GET /:id/download`, trocar:

```ts
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
```

por:

```ts
  if (!object) throw missingObject(file.id);
  return attachmentResponse(object, file);
});
```

Run: `npx vitest run test/files-download.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  21 passed (21)`.

- [ ] **Step 4: Uma só mensagem de nome de ficheiro repetido (teste primeiro)**

A mensagem do 409 de ficheiros estava escrita duas vezes (upload e `PATCH`) e só a do upload tinha teste. O teste do `PATCH` fixa a mensagem; passa já (o texto é o mesmo) e protege o refactor que se segue.

Em `test/files-manage.test.ts`, no teste do nome repetido, trocar:

```ts
    expect(await dup.json()).toMatchObject({ error: "name_taken" });
    expect((await patch(cookie, a.id, { name: "a.txt" })).status).toBe(200);
```

por:

```ts
    expect(await dup.json()).toMatchObject({ error: "name_taken", message: expect.stringContaining("em curso") });
    expect((await patch(cookie, a.id, { name: "a.txt" })).status).toBe(200);
```

Run: `npx vitest run test/files-manage.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  18 passed (18)`.

Acrescentar ao fim de `src/worker/lib/files.ts`:

```ts
/** 409 de um nome de ficheiro repetido; um envio ainda em curso também ocupa o nome, mas não aparece na lista. */
export function fileNameTaken(): ApiError {
  return new ApiError(409, "name_taken", "Já existe um ficheiro com esse nome neste local (pode ser um envio ainda em curso).");
}
```

Em `src/worker/routes/files.ts`, na lista de `import` de `../lib/files`, trocar:

```ts
  contentDisposition,
  parseRange,
```

por:

```ts
  contentDisposition,
  fileNameTaken,
  parseRange,
```

Nas duas escritas (upload e `PATCH`), trocar `unique: new ApiError(409, "name_taken", "Já existe um ficheiro com esse nome neste local (pode ser um envio ainda em curso)."),` por `unique: fileNameTaken(),`.

Run: `npx vitest run test/files-upload.test.ts test/files-manage.test.ts`
Expected: `Test Files  2 passed (2)`, `Tests  43 passed (43)`.

- [ ] **Step 5: Dívida de testes herdada do 2B: partilhas em cascata, altura das pastas e a guarda do `UPDATE`**

Testes que faltavam e que descrevem comportamento que já existe (por isso passam logo): o `ON DELETE CASCADE` das partilhas (a Task 6 conta com ele); a altura de uma pasta ao mover conta só as pastas do próprio utilizador e conta níveis, não pastas; e a guarda do `UPDATE_FOLDER_SQL` contra um ciclo gravado entre as verificações rápidas e a escrita (o teste do ciclo já gravado passou a ser respondido antes, por `assertFitsBelow`).

Acrescentar ao fim de `test/schema-constraints.test.ts`:

```ts
describe("partilhas", () => {
  it("apagar um ficheiro apaga as suas partilhas (ON DELETE CASCADE)", async () => {
    await insertUser();
    await insertFile("f1");
    await env.DB.prepare(
      "INSERT INTO shares (id, token_hash, file_id, user_id, created_at) VALUES ('s1', 'h1', 'f1', 'u1', 1)",
    ).run();
    await env.DB.prepare("DELETE FROM files WHERE id = 'f1'").run();
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM shares").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
```

Acrescentar ao fim de `test/folders-depth.test.ts`:

```ts
describe("altura da pasta ao mover", () => {
  it("só conta as pastas do próprio utilizador (uma cadeia de outro utilizador pendurada nela não conta)", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const chain = await insertChain(user.id, "n", 99); // a última está no nível 99
    const moved = await createFolder(cookie, "movida");
    // Por SQL: 99 pastas do Bob penduradas na pasta da Ana (pela API isto nunca acontece).
    await insertChain(bob.user.id, "b", 99, moved.id);
    expect((await patch(cookie, moved.id, { parentId: chain[98] })).status).toBe(200);
  });

  it("conta níveis e não pastas: uma pasta larga (várias subpastas ao mesmo nível) tem altura 2", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const chain = await insertChain(user.id, "n", 99);
    const moved = await createFolder(cookie, "movida");
    for (const name of ["a", "b", "c"]) await createFolder(cookie, name, moved.id);

    // altura 2: por baixo do nível 99 ficaria no 101 (não cabe); por baixo do 98 fica no 100 (cabe)
    expect((await patch(cookie, moved.id, { parentId: chain[98] })).status).toBe(400);
    expect((await patch(cookie, moved.id, { parentId: chain[97] })).status).toBe(200);
  });
});
```

Acrescentar ao fim de `test/folders-races.test.ts`:

```ts
describe("PATCH /api/folders/:id: a guarda do UPDATE contra ciclos", () => {
  it("um ciclo gravado depois das verificações rápidas: o UPDATE termina (limite de profundidade) e recusa com invalid_move", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B");
    const destination = await createFolder(cookie, "Destino");
    const moved = await createFolder(cookie, "Movida");

    // As verificações rápidas já passaram quando o ciclo A <-> B, com o destino pendurado nele, é gravado por SQL.
    const res = await patchWithRace(cookie, moved.id, { parentId: destination.id }, async () => {
      await setParent(a.id, b.id);
      await setParent(b.id, a.id);
      await setParent(destination.id, a.id);
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_move" });
    expect(await parentOf(moved.id)).toBeNull();
  });
});
```

Run: `npx vitest run test/schema-constraints.test.ts test/folders-depth.test.ts test/folders-races.test.ts`
Expected: `Test Files  3 passed (3)`, `Tests  19 passed (19)`.

- [ ] **Step 6: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  24 passed (24)`, `Tests  214 passed (214)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src test
git commit -m "Monta o limite do corpo para toda a API, tira o changes() da libertação da quota e partilha os ajudantes de servir ficheiros" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tipos partilhados e caminhos de várias pastas numa só consulta

**Files:**
- Create: `src/worker/lib/paths.ts`, `test/paths.test.ts`
- Modify: `src/shared/types.ts`, `test/db-helpers.ts`

**Interfaces:**
- Consumes: `MAX_FOLDER_DEPTH` (`src/worker/lib/folders.ts`), `BreadcrumbItem`, `FolderItem`, `FileItem`.
- Produces: em `src/shared/types.ts`: `SearchResult`, `TrashItem`, `TrashContents`, `ShareItem`, `PublicShare`.
  `pathsForFolders(db, userId, folderIds) → Map<folderId, BreadcrumbItem[]>` e `trailOf(paths, folderId | null)` em `src/worker/lib/paths.ts`
  (a pesquisa e a lixeira calculam os caminhos de até 200 itens sem uma consulta por item).
  `dbCountingPrepares() → { db, sql }` em `test/db-helpers.ts`.

- [ ] **Step 1: Tipos partilhados**

Os tipos das respostas das Tasks 3 a 7 ficam já em `src/shared/types.ts` (sem imports: servem o Worker e, no Plano 3B, a interface).

Acrescentar ao fim de `src/shared/types.ts`:

```ts
/** Resultado de uma pesquisa por nome; `path` é o caminho da pasta onde o item está (vazio = raiz). */
export type SearchResult = { path: BreadcrumbItem[] } & (
  | { kind: "folder"; folder: FolderItem }
  | { kind: "file"; file: FileItem }
);

/** Ficheiro na lixeira. */
export interface TrashItem {
  id: string;
  name: string;
  size: number;
  mime: string;
  /** Pasta onde estava (null = raiz) e o caminho até lá. */
  folderId: string | null;
  path: BreadcrumbItem[];
  deletedAt: number;
  /** Quando o cron o elimina de vez: `deletedAt` mais os dias de retenção. */
  purgeAt: number;
}

/** A lixeira (`GET /api/trash`): os mais recentes primeiro, no máximo 200; `total` conta todos. */
export interface TrashContents {
  items: TrashItem[];
  total: number;
  retentionDays: number;
}

/** Um link de partilha ativo (nunca inclui o token, que só se mostra na criação). */
export interface ShareItem {
  id: string;
  fileId: string;
  createdAt: number;
  /** null = sem validade. */
  expiresAt: number | null;
}

/** O que a página pública de um link mostra. */
export interface PublicShare {
  name: string;
  size: number;
}
```

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

- [ ] **Step 2: `pathsForFolders` (teste primeiro)**

A pesquisa mostra o caminho de até 50 resultados e a lixeira o de até 200 itens. O plano gratuito do Workers só permite 50 chamadas por invocação, por isso o caminho **não** se calcula com um `breadcrumbFor` por item: uma só consulta recursiva por bloco de 50 pastas.

Acrescentar ao fim de `test/db-helpers.ts`:

```ts
/** `DB` em Proxy que regista o SQL de cada `prepare`: para testar quantas consultas uma operação faz. */
export function dbCountingPrepares(): { db: D1Database; sql: string[] } {
  const sql: string[] = [];
  const db = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare") {
        return (query: string) => {
          sql.push(query);
          return target.prepare(query);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db, sql };
}
```

Criar `test/paths.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { pathsForFolders, trailOf } from "../src/worker/lib/paths";
import { registerUser } from "./auth-helpers";
import { dbCountingPrepares } from "./db-helpers";
import { createFolder } from "./folder-helpers";
import { resetDb } from "./helpers";

beforeEach(resetDb);

describe("pathsForFolders", () => {
  it("devolve o caminho da raiz até cada pasta, numa só consulta", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B", a.id);
    const c = await createFolder(cookie, "C", b.id);
    const d = await createFolder(cookie, "D");

    const { db, sql } = dbCountingPrepares();
    const paths = await pathsForFolders(db, user.id, [c.id, d.id, b.id, c.id]);

    expect(paths.get(c.id)).toEqual([
      { id: a.id, name: "A" },
      { id: b.id, name: "B" },
      { id: c.id, name: "C" },
    ]);
    expect(paths.get(d.id)).toEqual([{ id: d.id, name: "D" }]);
    expect(paths.get(b.id)).toHaveLength(2);
    expect(sql).toHaveLength(1);
  });

  it("não devolve pastas de outro utilizador nem ids desconhecidos", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const daAna = await createFolder(ana.cookie, "Da Ana");

    const paths = await pathsForFolders(env.DB, bob.user.id, [daAna.id, "nao-existe"]);

    expect(paths.size).toBe(0);
  });

  it("sem pastas não consulta a base", async () => {
    const { user } = await registerUser("ana@example.com");
    const { db, sql } = dbCountingPrepares();
    expect((await pathsForFolders(db, user.id, [])).size).toBe(0);
    expect(sql).toHaveLength(0);
  });

  it("divide em blocos de 50 pastas: 120 pastas fazem 3 consultas", async () => {
    const { user } = await registerUser("ana@example.com");
    const ids = Array.from({ length: 120 }, (_unused, index) => `pasta-${index}`);
    await env.DB.batch(
      ids.map((id) =>
        env.DB.prepare(
          "INSERT INTO folders (id, user_id, parent_id, name, name_norm, created_at) VALUES (?1, ?2, NULL, ?1, ?1, 0)",
        ).bind(id, user.id),
      ),
    );

    const { db, sql } = dbCountingPrepares();
    const paths = await pathsForFolders(db, user.id, ids);

    expect(paths.size).toBe(120);
    expect(sql).toHaveLength(3);
  });

  it("termina mesmo com um ciclo gravado na base (limite de profundidade)", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    const b = await createFolder(cookie, "B");
    await env.DB.batch([
      env.DB.prepare("UPDATE folders SET parent_id = ?1 WHERE id = ?2").bind(b.id, a.id),
      env.DB.prepare("UPDATE folders SET parent_id = ?1 WHERE id = ?2").bind(a.id, b.id),
    ]);

    const paths = await pathsForFolders(env.DB, user.id, [a.id]);

    expect(paths.get(a.id)!.length).toBeLessThanOrEqual(1001);
  });
});

describe("trailOf", () => {
  it("a raiz e as pastas desconhecidas têm caminho vazio", () => {
    const paths = new Map([["f1", [{ id: "f1", name: "Fotos" }]]]);
    expect(trailOf(paths, null)).toEqual([]);
    expect(trailOf(paths, "outra")).toEqual([]);
    expect(trailOf(paths, "f1")).toEqual([{ id: "f1", name: "Fotos" }]);
  });
});
```

Run: `npx vitest run test/paths.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/worker/lib/paths.ts`:

```ts
import type { BreadcrumbItem } from "../../shared/types";
import { MAX_FOLDER_DEPTH } from "./folders";

/** Pastas por consulta: bem abaixo do limite de 100 parâmetros de uma instrução da D1. */
const CHUNK_SIZE = 50;

/**
 * O caminho (da raiz até à pasta, inclusive) de cada uma das pastas pedidas. Uma consulta recursiva por bloco de 50 pastas,
 * nunca uma por pasta: o plano gratuito do Workers limita as chamadas por invocação, e uma pesquisa ou a lixeira
 * mostram até 200 itens. Pastas que não existem ou são de outro utilizador ficam fora do mapa.
 */
export async function pathsForFolders(
  db: D1Database,
  userId: string,
  folderIds: Iterable<string>,
): Promise<Map<string, BreadcrumbItem[]>> {
  const unique = [...new Set(folderIds)];
  const paths = new Map<string, BreadcrumbItem[]>();
  for (let start = 0; start < unique.length; start += CHUNK_SIZE) {
    const chunk = unique.slice(start, start + CHUNK_SIZE);
    const marks = chunk.map((_id, index) => `?${index + 2}`).join(", ");
    const { results } = await db
      .prepare(
        `WITH RECURSIVE anc(start_id, id, parent_id, name, depth) AS (
           SELECT id, id, parent_id, name, 0 FROM folders WHERE user_id = ?1 AND id IN (${marks})
           UNION ALL
           SELECT a.start_id, f.id, f.parent_id, f.name, a.depth + 1
           FROM folders f JOIN anc a ON f.id = a.parent_id
           WHERE f.user_id = ?1 AND a.depth < ${MAX_FOLDER_DEPTH}
         )
         SELECT start_id, id, name FROM anc ORDER BY start_id, depth DESC`,
      )
      .bind(userId, ...chunk)
      .all<{ start_id: string; id: string; name: string }>();
    for (const row of results) {
      const item = { id: row.id, name: row.name };
      const trail = paths.get(row.start_id);
      if (trail) trail.push(item);
      else paths.set(row.start_id, [item]);
    }
  }
  return paths;
}

/** O caminho de uma pasta no mapa de `pathsForFolders`; `null` (a raiz) tem caminho vazio. */
export function trailOf(paths: Map<string, BreadcrumbItem[]>, folderId: string | null): BreadcrumbItem[] {
  return folderId === null ? [] : (paths.get(folderId) ?? []);
}
```

Run: `npx vitest run test/paths.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  6 passed (6)`.

- [ ] **Step 3: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  25 passed (25)`, `Tests  220 passed (220)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src test
git commit -m "Acrescenta os tipos da lixeira, pesquisa e partilha e o cálculo dos caminhos de várias pastas" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pesquisa por nome: `GET /api/search`

**Files:**
- Create: `src/worker/routes/search.ts`, `test/search.test.ts`
- Modify: `src/worker/app.ts`

**Interfaces:**
- Consumes: `normalizeName`, `searchKey` (`src/shared/names.ts`), `pathsForFolders`/`trailOf` (Task 2), `SearchResult` (Task 2), `createAuthedRouter`, `dbCountingPrepares` (Task 2).
- Produces: `GET /api/search?q=` → `{ results: SearchResult[] }` (pastas e ficheiros prontos fora da lixeira; `name_norm LIKE %q%` com `%`, `_` e `\` escapados; mínimo 2 caracteres,
  máximo 100; no máximo 50 resultados, por nome; cada um com o `path` da pasta onde está). Erros: `400 query_too_short`, `400 query_too_long`.

- [ ] **Step 1: A rota de pesquisa (teste primeiro)**

Criar `test/search.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { SearchResult } from "../src/shared/types";
import { registerUser } from "./auth-helpers";
import { dbCountingPrepares, fetchWithEnv } from "./db-helpers";
import { insertFileRow, uploadOk } from "./file-helpers";
import { createFolder } from "./folder-helpers";
import { api, buildRequest, resetState } from "./helpers";

beforeEach(resetState);

async function search(cookie: string, q: string): Promise<Response> {
  return api(`/api/search?q=${encodeURIComponent(q)}`, { cookie });
}

async function results(cookie: string, q: string): Promise<SearchResult[]> {
  const res = await search(cookie, q);
  expect(res.status).toBe(200);
  return ((await res.json()) as { results: SearchResult[] }).results;
}

const names = (found: SearchResult[]) => found.map((r) => (r.kind === "folder" ? r.folder.name : r.file.name));

describe("GET /api/search", () => {
  it("exige sessão", async () => {
    expect((await api("/api/search?q=ab")).status).toBe(401);
  });

  it("recusa pesquisas com menos de 2 caracteres (depois de tirar espaços e acentos) e com mais de 100", async () => {
    const { cookie } = await registerUser("ana@example.com");
    for (const q of ["", " a ", "́"]) {
      const res = await search(cookie, q);
      expect(res.status, JSON.stringify(q)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "query_too_short" });
    }
    const long = await search(cookie, "x".repeat(101));
    expect(long.status).toBe(400);
    expect(await long.json()).toMatchObject({ error: "query_too_long" });
  });

  it("encontra pastas e ficheiros sem distinguir maiúsculas nem acentos, por ordem de nome, com o caminho", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const docs = await createFolder(cookie, "Documentos");
    const contas = await createFolder(cookie, "Contas 2026", docs.id);
    await uploadOk(cookie, "Relatório Final.PDF", "x", { folder: contas.id });
    await uploadOk(cookie, "relatorio-rascunho.txt", "x");
    await createFolder(cookie, "Relatórios antigos", docs.id);
    await uploadOk(cookie, "outra coisa.txt", "x");

    const found = await results(cookie, "RELATORIO");

    expect(names(found)).toEqual(["Relatório Final.PDF", "relatorio-rascunho.txt", "Relatórios antigos"]);
    expect(found[0]).toMatchObject({ kind: "file", path: [{ name: "Documentos" }, { name: "Contas 2026" }] });
    expect(found[1]).toMatchObject({ kind: "file", path: [] });
    expect(found[2]).toMatchObject({ kind: "folder", path: [{ name: "Documentos" }] });
    expect(found[2].kind === "folder" && found[2].folder.parentId).toBe(docs.id);
  });

  it("trata `%`, `_` e `\\` do utilizador como letras, não como padrões", async () => {
    const { cookie } = await registerUser("ana@example.com");
    for (const name of ["desconto 50% hoje.txt", "desconto 500.txt", "a_b.txt", "axb.txt", "c\\d.txt", "cd.txt"]) {
      await uploadOk(cookie, name, "x");
    }
    expect(names(await results(cookie, "50%"))).toEqual(["desconto 50% hoje.txt"]);
    expect(names(await results(cookie, "a_b"))).toEqual(["a_b.txt"]);
    expect(names(await results(cookie, "c\\d"))).toEqual(["c\\d.txt"]);
  });

  it("não devolve ficheiros na lixeira nem envios `pending`, e não mistura utilizadores", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const visivel = await uploadOk(ana.cookie, "projeto-visivel.txt", "x");
    const apagado = await uploadOk(ana.cookie, "projeto-apagado.txt", "x");
    await api(`/api/files/${apagado.id}`, { method: "DELETE", cookie: ana.cookie });
    await insertFileRow(ana.user.id, null, { name: "projeto-pendente.txt", status: "pending" });
    await uploadOk(bob.cookie, "projeto-do-bob.txt", "x");

    expect(names(await results(ana.cookie, "projeto"))).toEqual(["projeto-visivel.txt"]);
    expect((await results(ana.cookie, "projeto"))[0]).toMatchObject({ kind: "file", file: { id: visivel.id } });
    expect(names(await results(bob.cookie, "projeto"))).toEqual(["projeto-do-bob.txt"]);
  });

  it("devolve no máximo 50 resultados e calcula os caminhos de todos numa só consulta recursiva", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const folderIds = Array.from({ length: 60 }, (_unused, index) => `pasta-${index}`);
    await env.DB.batch([
      ...folderIds.map((id) =>
        env.DB.prepare(
          "INSERT INTO folders (id, user_id, parent_id, name, name_norm, created_at) VALUES (?1, ?2, NULL, ?1, ?1, 0)",
        ).bind(id, user.id),
      ),
      ...folderIds.map((id, index) =>
        env.DB.prepare(
          `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at)
           VALUES (?1, ?2, ?3, ?4, ?4, 1, 'text/plain', ?5, 'ready', 0)`,
        ).bind(`ficheiro-${index}`, user.id, id, `relatorio-${String(index).padStart(2, "0")}.txt`, `u/${user.id}/ficheiro-${index}`),
      ),
    ]);

    const { db, sql } = dbCountingPrepares();
    const res = await fetchWithEnv(buildRequest("/api/search?q=relatorio", { cookie }), { DB: db });
    const found = ((await res.json()) as { results: SearchResult[] }).results;

    expect(found).toHaveLength(50);
    expect(names(found)[0]).toBe("relatorio-00.txt");
    expect(sql.filter((query) => query.includes("WITH RECURSIVE"))).toHaveLength(1);
  });
});
```

Run: `npx vitest run test/search.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  6 failed (6)).

Criar `src/worker/routes/search.ts`:

```ts
import { normalizeName, searchKey } from "../../shared/names";
import type { SearchResult } from "../../shared/types";
import { ApiError } from "../errors";
import { pathsForFolders, trailOf } from "../lib/paths";
import { createAuthedRouter } from "./authed";

export const search = createAuthedRouter();

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 50;

interface SearchRow {
  kind: "folder" | "file";
  id: string;
  container_id: string | null;
  name: string;
  size: number;
  mime: string;
  created_at: number;
}

/** O texto como padrão de `LIKE ... ESCAPE '\'`: `%`, `_` e `\` do utilizador valem como letras. */
function containsPattern(key: string): string {
  return `%${key.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * Pesquisa por nome (sem maiúsculas nem acentos) nas pastas e nos ficheiros prontos e fora da lixeira do utilizador:
 * mínimo 2 caracteres, no máximo 50 resultados, por ordem de nome. Cada resultado traz o caminho da pasta onde está.
 */
search.get("/", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const query = normalizeName(c.req.query("q") ?? "");
  if (query.length > MAX_QUERY_LENGTH) {
    throw new ApiError(400, "query_too_long", `A pesquisa não pode ter mais de ${MAX_QUERY_LENGTH} caracteres.`);
  }
  const key = searchKey(query);
  if ([...key].length < MIN_QUERY_LENGTH) {
    throw new ApiError(400, "query_too_short", `Escreva pelo menos ${MIN_QUERY_LENGTH} caracteres.`);
  }

  const { results: rows } = await db
    .prepare(
      `SELECT 'folder' AS kind, id, parent_id AS container_id, name, name_norm, 0 AS size, '' AS mime, created_at
         FROM folders WHERE user_id = ?1 AND name_norm LIKE ?2 ESCAPE '\\'
       UNION ALL
       SELECT 'file', id, folder_id, name, name_norm, size, mime, created_at
         FROM files WHERE user_id = ?1 AND status = 'ready' AND deleted_at IS NULL AND name_norm LIKE ?2 ESCAPE '\\'
       ORDER BY name_norm, name LIMIT ${MAX_RESULTS}`,
    )
    .bind(userId, containsPattern(key))
    .all<SearchRow>();

  const paths = await pathsForFolders(
    db,
    userId,
    rows.flatMap((row) => (row.container_id === null ? [] : [row.container_id])),
  );
  const results: SearchResult[] = rows.map((row) => {
    const path = trailOf(paths, row.container_id);
    return row.kind === "folder"
      ? {
          kind: "folder",
          folder: { id: row.id, name: row.name, parentId: row.container_id, createdAt: row.created_at },
          path,
        }
      : {
          kind: "file",
          file: {
            id: row.id,
            name: row.name,
            folderId: row.container_id,
            size: row.size,
            mime: row.mime,
            createdAt: row.created_at,
          },
          path,
        };
  });
  return c.json({ results });
});
```

Em `src/worker/app.ts`, nos `import`, trocar:

```ts
import { folders } from "./routes/folders";
```

por:

```ts
import { folders } from "./routes/folders";
import { search } from "./routes/search";
```

No mesmo ficheiro, trocar:

```ts
app.route("/api/files", files);
```

por:

```ts
app.route("/api/files", files);
app.route("/api/search", search);
```

Run: `npx vitest run test/search.test.ts test/authz.test.ts`
Expected: `Test Files  2 passed (2)`, `Tests  8 passed (8)` (a varredura de `test/authz.test.ts` apanha a rota nova e confirma o 401).

- [ ] **Step 2: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  26 passed (26)`, `Tests  226 passed (226)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src test
git commit -m "Acrescenta a pesquisa por nome com o caminho de cada resultado" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Lixeira: listar e eliminar de vez

**Files:**
- Create: `src/worker/lib/trash.ts`, `src/worker/routes/trash.ts`, `test/trash.test.ts`
- Modify: `src/worker/app.ts`

**Interfaces:**
- Consumes: `pathsForFolders`/`trailOf`, `TrashItem`/`TrashContents` (Task 2), `getConfig`, `FILE_COLUMNS`/`rowToFile`/`FileRow`, `createAuthedRouter`, `dbWithStatementHook`/`fetchWithEnv`/`silenceErrors`, `insertFileRow`.
- Produces: `GET /api/trash` → `TrashContents` (até 200, os mais recentes primeiro); `DELETE /api/trash/:id` → 204 (404 `file_not_found` se não está na lixeira);
  `DELETE /api/trash` → `{ purged, remaining }` (por blocos de 50); `purgeTrashed(env, userId, ids)` e `TRASH_PURGE_BATCH = 50` em `src/worker/lib/trash.ts`
  (o cron do Plano 4 reutiliza-os).

- [ ] **Step 1: Listar, eliminar um e esvaziar (testes primeiro)**

Eliminar de vez desconta a quota e apaga o objeto do R2. Faz-se numa só `batch` com `DELETE ... RETURNING`: só os objetos das linhas que saíram mesmo vão para fora do R2 (um ficheiro restaurado entretanto não perde o objeto) e a quota usa `MAX(used_bytes - ..., 0)`, para um desvio na contabilidade não fazer falhar a `batch` para sempre. Esvaziar é por blocos de 50: o plano gratuito limita as chamadas por invocação.

Criar `test/trash.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { TrashContents } from "../src/shared/types";
import { registerUser } from "./auth-helpers";
import { dbWithStatementHook, fetchWithEnv, silenceErrors } from "./db-helpers";
import { insertFileRow, uploadOk, usedBytes } from "./file-helpers";
import { createFolder, getContents } from "./folder-helpers";
import { api, buildRequest, resetState } from "./helpers";

beforeEach(resetState);

const DAY_MS = 86_400_000;

async function trashFile(cookie: string, id: string): Promise<void> {
  expect((await api(`/api/files/${id}`, { method: "DELETE", cookie })).status).toBe(204);
}

async function listTrash(cookie: string): Promise<TrashContents> {
  const res = await api("/api/trash", { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as TrashContents;
}

/** Cria `count` ficheiros já na lixeira, por SQL e com o objeto no R2 (bem mais rápido do que pela API). */
async function seedTrashed(userId: string, count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, (_unused, index) => `lixo-${String(index).padStart(3, "0")}`);
  await env.DB.batch([
    ...ids.map((id, index) =>
      env.DB.prepare(
        `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at, deleted_at)
         VALUES (?1, ?2, NULL, ?1, ?1, 10, 'text/plain', ?3, 'ready', 0, ?4)`,
      ).bind(id, userId, `u/${userId}/${id}`, 1000 + index),
    ),
    env.DB.prepare("UPDATE users SET used_bytes = used_bytes + ?1 WHERE id = ?2").bind(10 * count, userId),
  ]);
  await Promise.all(ids.map((id) => env.FILES.put(`u/${userId}/${id}`, "0123456789")));
  return ids;
}

const objectCount = async () => (await env.FILES.list({ prefix: "u/" })).objects.length;

describe("GET /api/trash", () => {
  it("exige sessão", async () => {
    expect((await api("/api/trash")).status).toBe(401);
  });

  it("lista só os ficheiros excluídos do utilizador, do mais recente para o mais antigo, com a pasta e a data de eliminação", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const fotos = await createFolder(ana.cookie, "Fotos");
    const ferias = await createFolder(ana.cookie, "Férias", fotos.id);
    const antigo = await uploadOk(ana.cookie, "antigo.txt", "x");
    const recente = await uploadOk(ana.cookie, "praia.png", "xy", { folder: ferias.id });
    await uploadOk(ana.cookie, "fica.txt", "x");
    const doBob = await uploadOk(bob.cookie, "do-bob.txt", "x");
    await trashFile(ana.cookie, antigo.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await trashFile(ana.cookie, recente.id);
    await trashFile(bob.cookie, doBob.id);

    const { items, total, retentionDays } = await listTrash(ana.cookie);

    expect(items.map((item) => item.name)).toEqual(["praia.png", "antigo.txt"]);
    expect(total).toBe(2);
    expect(retentionDays).toBe(30);
    expect(items[0]).toMatchObject({ id: recente.id, size: 2, folderId: ferias.id });
    expect(items[0].path).toEqual([
      { id: fotos.id, name: "Fotos" },
      { id: ferias.id, name: "Férias" },
    ]);
    expect(items[1]).toMatchObject({ folderId: null, path: [] });
    expect(items[0].purgeAt).toBe(items[0].deletedAt + 30 * DAY_MS);
  });

  it("está vazia sem ficheiros excluídos, e um ficheiro `pending` nunca aparece", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    await insertFileRow(user.id, null, { name: "pendente.txt", status: "pending" });
    expect(await listTrash(cookie)).toEqual({ items: [], total: 0, retentionDays: 30 });
  });

  it("mostra no máximo os 200 mais recentes, e `total` conta todos", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    await seedTrashed(user.id, 205);
    const { items, total } = await listTrash(cookie);
    expect(items).toHaveLength(200);
    expect(total).toBe(205);
    expect(items[0].name).toBe("lixo-204"); // o mais recente: deleted_at 1204
  });
});

describe("DELETE /api/trash/:id", () => {
  it("elimina o ficheiro de vez: o objeto do R2, a linha e o espaço usado", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "12345");
    await uploadOk(cookie, "fica.txt", "123");
    await trashFile(cookie, file.id);
    expect(await usedBytes(cookie)).toBe(8); // na lixeira ainda ocupa espaço
    expect(await objectCount()).toBe(2);

    const res = await api(`/api/trash/${file.id}`, { method: "DELETE", cookie });

    expect(res.status).toBe(204);
    expect(await usedBytes(cookie)).toBe(3);
    expect(await objectCount()).toBe(1);
    expect((await listTrash(cookie)).total).toBe(0);
    expect((await getContents(cookie)).files.map((f) => f.name)).toEqual(["fica.txt"]);
  });

  it("só elimina ficheiros que estão na lixeira e que são do utilizador (senão 404)", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const ativo = await uploadOk(ana.cookie, "ativo.txt", "x");
    const apagado = await uploadOk(ana.cookie, "apagado.txt", "x");
    await trashFile(ana.cookie, apagado.id);

    for (const [cookie, id] of [[ana.cookie, ativo.id], [bob.cookie, apagado.id], [ana.cookie, "nao-existe"]]) {
      const res = await api(`/api/trash/${id}`, { method: "DELETE", cookie });
      expect(res.status, id).toBe(404);
      expect(await res.json()).toMatchObject({ error: "file_not_found" });
    }
    expect(await objectCount()).toBe(2);
    expect((await listTrash(ana.cookie)).total).toBe(1);
  });

  it("a quota nunca fica negativa, mesmo que a contabilidade esteja desviada", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "12345");
    await trashFile(cookie, file.id);
    await env.DB.prepare("UPDATE users SET used_bytes = 2 WHERE id = ?1").bind(user.id).run();

    expect((await api(`/api/trash/${file.id}`, { method: "DELETE", cookie })).status).toBe(204);

    expect(await usedBytes(cookie)).toBe(0);
  });

  it("se o R2 falhar, a linha e a quota ficam certas e o objeto órfão fica registado", async () => {
    const errors = silenceErrors();
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "12345");
    await trashFile(cookie, file.id);
    const brokenFiles = new Proxy(env.FILES, {
      get(target, prop) {
        if (prop === "delete") return () => Promise.reject(new Error("R2 em baixo"));
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const res = await fetchWithEnv(buildRequest(`/api/trash/${file.id}`, { method: "DELETE", cookie }), { FILES: brokenFiles });

    expect(res.status).toBe(204);
    expect(await usedBytes(cookie)).toBe(0);
    expect((await listTrash(cookie)).total).toBe(0);
    expect(errors).toHaveBeenCalled();
  });
});

describe("DELETE /api/trash (esvaziar)", () => {
  it("esvazia por blocos de 50 e diz quantos faltam", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    await seedTrashed(user.id, 55);
    const ativo = await uploadOk(cookie, "ativo.txt", "123");
    expect(await usedBytes(cookie)).toBe(553);

    const first = await api("/api/trash", { method: "DELETE", cookie });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ purged: 50, remaining: 5 });
    expect(await usedBytes(cookie)).toBe(53);
    expect(await objectCount()).toBe(6); // 5 na lixeira + o ativo

    const second = await api("/api/trash", { method: "DELETE", cookie });
    expect(await second.json()).toEqual({ purged: 5, remaining: 0 });
    expect(await usedBytes(cookie)).toBe(3);
    expect(await objectCount()).toBe(1);
    expect((await getContents(cookie)).files.map((f) => f.id)).toEqual([ativo.id]);

    const third = await api("/api/trash", { method: "DELETE", cookie });
    expect(await third.json()).toEqual({ purged: 0, remaining: 0 });
  });

  it("não mexe na lixeira de outro utilizador", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    await seedTrashed(bob.user.id, 3);
    await api("/api/trash", { method: "DELETE", cookie: ana.cookie });
    expect((await listTrash(bob.cookie)).total).toBe(3);
    expect(await objectCount()).toBe(3);
  });

  it("um ficheiro restaurado entre a escolha e a eliminação não é apagado nem perde o objeto", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const [first, second] = await seedTrashed(user.id, 2);
    const racingDb = dbWithStatementHook(/^\s*UPDATE users SET used_bytes = MAX/, async () => {
      await env.DB.prepare("UPDATE files SET deleted_at = NULL WHERE id = ?1").bind(first).run();
    });

    const res = await fetchWithEnv(buildRequest("/api/trash", { method: "DELETE", cookie }), { DB: racingDb });

    expect(await res.json()).toEqual({ purged: 1, remaining: 0 });
    expect(await env.FILES.head(`u/${user.id}/${first}`)).not.toBeNull();
    expect(await env.FILES.head(`u/${user.id}/${second}`)).toBeNull();
    expect(await usedBytes(cookie)).toBe(10); // só o ficheiro restaurado continua a contar
  });
});
```

Run: `npx vitest run test/trash.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  11 failed (11)).

Criar `src/worker/lib/trash.ts`:

```ts
/** Ficheiros eliminados de vez por chamada: o `IN (...)` tem de caber nos 100 parâmetros de uma instrução da D1. */
export const TRASH_PURGE_BATCH = 50;

/**
 * Elimina de vez ficheiros que estão na lixeira (`ids`, no máximo `TRASH_PURGE_BATCH`). Numa só `batch` desconta o tamanho
 * a `used_bytes` (nunca abaixo de 0) e apaga as linhas: só as que ainda estão na lixeira, por isso um ficheiro restaurado
 * entretanto não é tocado. O `RETURNING` diz que linhas saíram mesmo e só os objetos dessas vão para fora do R2, numa
 * só chamada. Se o R2 falhar, o objeto fica órfão (fica registado), mas a quota e a base ficam certas.
 * Devolve quantos ficheiros foram eliminados.
 */
export async function purgeTrashed(env: Pick<Env, "DB" | "FILES">, userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  if (ids.length > TRASH_PURGE_BATCH) throw new Error(`purgeTrashed: no máximo ${TRASH_PURGE_BATCH} ficheiros por chamada.`);
  const marks = ids.map((_id, index) => `?${index + 2}`).join(", ");
  const [, deleted] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET used_bytes = MAX(used_bytes - (
         SELECT COALESCE(SUM(size), 0) FROM files WHERE user_id = ?1 AND deleted_at IS NOT NULL AND id IN (${marks})
       ), 0) WHERE id = ?1`,
    ).bind(userId, ...ids),
    env.DB.prepare(
      `DELETE FROM files WHERE user_id = ?1 AND deleted_at IS NOT NULL AND id IN (${marks}) RETURNING r2_key`,
    ).bind(userId, ...ids),
  ]);
  const keys = (deleted.results as { r2_key: string }[]).map((row) => row.r2_key);
  if (keys.length > 0) {
    await env.FILES.delete(keys).catch((error) => console.error(`Objetos órfãos no R2 (${keys.length})`, error));
  }
  return keys.length;
}
```

Criar `src/worker/routes/trash.ts`:

```ts
import type { TrashContents, TrashItem } from "../../shared/types";
import { getConfig } from "../config";
import { ApiError } from "../errors";
import { FILE_COLUMNS, rowToFile, type FileRow } from "../lib/files";
import { pathsForFolders, trailOf } from "../lib/paths";
import { purgeTrashed, TRASH_PURGE_BATCH } from "../lib/trash";
import { createAuthedRouter } from "./authed";

export const trash = createAuthedRouter();

const DAY_MS = 86_400_000;
/** Itens que a lixeira lista de cada vez (os mais recentes); `total` conta todos. */
const TRASH_LIST_LIMIT = 200;

async function countTrashed(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM files WHERE user_id = ?1 AND status = 'ready' AND deleted_at IS NOT NULL")
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Os ficheiros excluídos, do mais recente para o mais antigo, com a pasta onde estavam e quando o cron os elimina de vez. */
trash.get("/", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const retentionDays = getConfig(c.env).trashRetentionDays;

  const [{ results: rows }, total] = await Promise.all([
    db
      .prepare(
        `SELECT ${FILE_COLUMNS}, deleted_at FROM files
         WHERE user_id = ?1 AND status = 'ready' AND deleted_at IS NOT NULL
         ORDER BY deleted_at DESC, id LIMIT ${TRASH_LIST_LIMIT}`,
      )
      .bind(userId)
      .all<FileRow & { deleted_at: number }>(),
    countTrashed(db, userId),
  ]);
  const paths = await pathsForFolders(
    db,
    userId,
    rows.flatMap((row) => (row.folder_id === null ? [] : [row.folder_id])),
  );
  const items: TrashItem[] = rows.map((row) => {
    const { id, name, size, mime, folderId } = rowToFile(row);
    return {
      id,
      name,
      size,
      mime,
      folderId,
      path: trailOf(paths, folderId),
      deletedAt: row.deleted_at,
      purgeAt: row.deleted_at + retentionDays * DAY_MS,
    };
  });
  return c.json({ items, total, retentionDays } satisfies TrashContents);
});

/** Elimina de vez um ficheiro da lixeira (apaga o objeto do R2 e a linha, e devolve o espaço). */
trash.delete("/:id", async (c) => {
  const purged = await purgeTrashed(c.env, c.get("user").id, [c.req.param("id")]);
  if (purged !== 1) throw new ApiError(404, "file_not_found", "Ficheiro não encontrado na lixeira.");
  return c.body(null, 204);
});

/**
 * Esvazia a lixeira por blocos de `TRASH_PURGE_BATCH` ficheiros (para respeitar o limite de chamadas por invocação).
 * Responde `{ purged, remaining }`: quem chama repete até `remaining` ser 0 (ou `purged` ser 0, se outro pedido mexer na lixeira).
 */
trash.delete("/", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const { results } = await db
    .prepare(
      `SELECT id FROM files WHERE user_id = ?1 AND status = 'ready' AND deleted_at IS NOT NULL
       ORDER BY deleted_at, id LIMIT ${TRASH_PURGE_BATCH}`,
    )
    .bind(userId)
    .all<{ id: string }>();
  const purged = await purgeTrashed(c.env, userId, results.map((row) => row.id));
  return c.json({ purged, remaining: await countTrashed(db, userId) });
});
```

Em `src/worker/app.ts`, nos `import`, trocar:

```ts
import { search } from "./routes/search";
```

por:

```ts
import { search } from "./routes/search";
import { trash } from "./routes/trash";
```

No mesmo ficheiro, trocar:

```ts
app.route("/api/search", search);
```

por:

```ts
app.route("/api/search", search);
app.route("/api/trash", trash);
```

Run: `npx vitest run test/trash.test.ts test/authz.test.ts`
Expected: `Test Files  2 passed (2)`, `Tests  13 passed (13)` (a varredura de `test/authz.test.ts` apanha as rotas novas e confirma o 401).

- [ ] **Step 2: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  27 passed (27)`, `Tests  237 passed (237)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src test
git commit -m "Acrescenta a lixeira: listar, eliminar de vez e esvaziar por blocos" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Lixeira: restaurar com sufixo quando o nome está ocupado

**Files:**
- Create: `src/worker/lib/restore-names.ts`, `test/restore-names.test.ts`, `test/trash-restore.test.ts`
- Modify: `src/worker/routes/trash.ts`

**Interfaces:**
- Consumes: `fileNameTaken` (Task 1), `isUniqueViolation`, `searchKey`, `FILE_COLUMNS`/`rowToFile`/`FileRow`, `NAME_MAX_LENGTH`, as rotas de `src/worker/routes/trash.ts` (Task 4).
- Produces: `POST /api/trash/:id/restore` → `{ file: FileItem }` (200; 404 `file_not_found`; 409 `name_taken` se as 10 tentativas estiverem ocupadas);
  `restoreCandidates(name)` e `RESTORE_ATTEMPTS = 10` em `src/worker/lib/restore-names.ts`.

- [ ] **Step 1: Os nomes candidatos do restauro (teste primeiro)**

Restaurar limpa `deleted_at`. Se o nome já está ocupado no destino, tenta " (restaurado)", " (restaurado 2)", ... (10 tentativas no total, a primeira com o nome original). Os nomes cabem sempre em 255 unidades UTF-16: o original é cortado, por pontos de código (sem partir um emoji ao meio), para o sufixo caber.

Criar `test/restore-names.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NAME_MAX_LENGTH, validateName } from "../src/shared/names";
import { RESTORE_ATTEMPTS, restoreCandidates } from "../src/worker/lib/restore-names";

describe("restoreCandidates", () => {
  it("começa pelo nome original e depois acrescenta o sufixo, numerado a partir do segundo", () => {
    const candidates = restoreCandidates("relatório.pdf");
    expect(candidates).toHaveLength(RESTORE_ATTEMPTS);
    expect(candidates.slice(0, 4)).toEqual([
      "relatório.pdf",
      "relatório.pdf (restaurado)",
      "relatório.pdf (restaurado 2)",
      "relatório.pdf (restaurado 3)",
    ]);
    expect(candidates[9]).toBe("relatório.pdf (restaurado 9)");
    expect(new Set(candidates).size).toBe(RESTORE_ATTEMPTS);
  });

  it("corta o nome para o sufixo caber nos 255 caracteres, sem partir um emoji ao meio", () => {
    // 241 letras e 7 emojis: 255 unidades UTF-16 (cada emoji conta 2)
    const name = "a".repeat(241) + "😀".repeat(7);
    expect(validateName(name)).toBeNull();
    for (const candidate of restoreCandidates(name)) {
      expect(candidate.length).toBeLessThanOrEqual(NAME_MAX_LENGTH);
      expect(validateName(candidate), candidate).toBeNull(); // sem surrogates isolados
    }
    // " (restaurado)" tem 13 unidades: sobram 242, e o 1.º emoji (unidades 242 e 243) já não cabe, por isso sai inteiro
    expect(restoreCandidates(name)[1]).toBe("a".repeat(241) + " (restaurado)");
  });

  it("um nome curto não é cortado", () => {
    expect(restoreCandidates("a")[1]).toBe("a (restaurado)");
  });
});
```

Run: `npx vitest run test/restore-names.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/worker/lib/restore-names.ts`:

```ts
import { NAME_MAX_LENGTH } from "../../shared/names";

/** Tentativas ao restaurar um ficheiro cujo nome já está ocupado: o nome original e nove com sufixo. */
export const RESTORE_ATTEMPTS = 10;

/** Corta `text` a `max` unidades UTF-16 sem partir um par de substituição (um emoji conta 2). */
function truncateUnits(text: string, max: number): string {
  let result = "";
  for (const char of text) {
    if (result.length + char.length > max) break;
    result += char;
  }
  return result;
}

/**
 * Os nomes que o restauro experimenta, por ordem: o original, depois " (restaurado)", " (restaurado 2)", ... Todos cabem em
 * `NAME_MAX_LENGTH`: se for preciso, o nome original é cortado para o sufixo caber.
 */
export function restoreCandidates(name: string): string[] {
  const candidates = [name];
  for (let attempt = 1; attempt < RESTORE_ATTEMPTS; attempt++) {
    const suffix = attempt === 1 ? " (restaurado)" : ` (restaurado ${attempt})`;
    candidates.push(truncateUnits(name, NAME_MAX_LENGTH - suffix.length) + suffix);
  }
  return candidates;
}
```

Run: `npx vitest run test/restore-names.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  3 passed (3)`.

- [ ] **Step 2: A rota de restauro (teste primeiro)**

Cada tentativa é um `UPDATE` que pode falhar no índice único (um nome ocupado, incluindo por um envio `pending`, que também está nesse índice): nesse caso tenta-se o nome seguinte. Um 404 quer dizer que o ficheiro já não está na lixeira (foi restaurado ou eliminado entretanto).

Criar `test/trash-restore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { FileItem } from "../src/shared/types";
import { NAME_MAX_LENGTH } from "../src/shared/names";
import { registerUser } from "./auth-helpers";
import { insertFileRow, uploadOk, usedBytes } from "./file-helpers";
import { createFolder, getContents } from "./folder-helpers";
import { api, resetState } from "./helpers";

beforeEach(resetState);

async function trashFile(cookie: string, id: string): Promise<void> {
  expect((await api(`/api/files/${id}`, { method: "DELETE", cookie })).status).toBe(204);
}

const restore = (cookie: string, id: string) => api(`/api/trash/${id}/restore`, { method: "POST", cookie });

async function trashedCount(cookie: string): Promise<number> {
  return ((await (await api("/api/trash", { cookie })).json()) as { total: number }).total;
}

describe("POST /api/trash/:id/restore", () => {
  it("exige sessão", async () => {
    expect((await api("/api/trash/x/restore", { method: "POST" })).status).toBe(401);
  });

  it("devolve o ficheiro à pasta onde estava, com o mesmo nome, sem mexer na quota", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const folder = await createFolder(cookie, "Fotos");
    const file = await uploadOk(cookie, "praia.png", "12345", { folder: folder.id });
    await trashFile(cookie, file.id);

    const res = await restore(cookie, file.id);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { file: FileItem }).file).toMatchObject({ id: file.id, name: "praia.png", folderId: folder.id });
    expect((await getContents(cookie, folder.id)).files.map((f) => f.name)).toEqual(["praia.png"]);
    expect(await trashedCount(cookie)).toBe(0);
    expect(await usedBytes(cookie)).toBe(5);
    expect((await restore(cookie, file.id)).status).toBe(404); // já não está na lixeira
  });

  it("se a pasta original já foi apagada, restaura para a raiz", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const folder = await createFolder(cookie, "Fotos");
    const file = await uploadOk(cookie, "praia.png", "x", { folder: folder.id });
    await trashFile(cookie, file.id);
    expect((await api(`/api/folders/${folder.id}`, { method: "DELETE", cookie })).status).toBe(204);

    const res = await restore(cookie, file.id);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { file: FileItem }).file.folderId).toBeNull();
    expect((await getContents(cookie)).files.map((f) => f.name)).toEqual(["praia.png"]);
  });

  it("se o nome já existe no destino, restaura com o sufixo, e numerado se for preciso", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const first = await uploadOk(cookie, "a.txt", "1");
    await trashFile(cookie, first.id);
    await uploadOk(cookie, "a.txt", "2"); // o nome ficou livre e foi reutilizado

    const second = (await (await restore(cookie, first.id)).json()) as { file: FileItem };
    expect(second.file.name).toBe("a.txt (restaurado)");

    const again = await uploadOk(cookie, "b.txt", "3");
    await trashFile(cookie, again.id);
    await uploadOk(cookie, "b.txt", "4");
    await insertFileRow(user.id, null, { name: "b.txt (restaurado)" });
    const third = (await (await restore(cookie, again.id)).json()) as { file: FileItem };
    expect(third.file.name).toBe("b.txt (restaurado 2)");
  });

  it("um envio `pending` com o nome também conta como ocupado", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "1");
    await trashFile(cookie, file.id);
    await insertFileRow(user.id, null, { name: "a.txt", status: "pending" });

    const res = await restore(cookie, file.id);

    expect(((await res.json()) as { file: FileItem }).file.name).toBe("a.txt (restaurado)");
  });

  it("respeita o limite de 255 caracteres: corta o nome para o sufixo caber", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const name = "a".repeat(NAME_MAX_LENGTH);
    const file = await uploadOk(cookie, name, "1");
    await trashFile(cookie, file.id);
    await uploadOk(cookie, name, "2");

    const restored = ((await (await restore(cookie, file.id)).json()) as { file: FileItem }).file;

    expect(restored.name).toHaveLength(NAME_MAX_LENGTH);
    expect(restored.name.endsWith(" (restaurado)")).toBe(true);
  });

  it("se as 10 tentativas estiverem ocupadas, devolve 409 e o ficheiro continua na lixeira", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "1");
    await trashFile(cookie, file.id);
    const taken = ["a.txt", "a.txt (restaurado)", ...Array.from({ length: 8 }, (_unused, index) => `a.txt (restaurado ${index + 2})`)];
    for (const name of taken) await insertFileRow(user.id, null, { name });

    const res = await restore(cookie, file.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "name_taken" });
    expect(await trashedCount(cookie)).toBe(1);
  });

  it("só restaura ficheiros que estão na lixeira e que são do utilizador (senão 404)", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const ativo = await uploadOk(ana.cookie, "ativo.txt", "x");
    const apagado = await uploadOk(ana.cookie, "apagado.txt", "x");
    await trashFile(ana.cookie, apagado.id);

    expect((await restore(ana.cookie, ativo.id)).status).toBe(404);
    expect((await restore(bob.cookie, apagado.id)).status).toBe(404);
    expect((await restore(ana.cookie, "nao-existe")).status).toBe(404);
    expect(await trashedCount(ana.cookie)).toBe(1);
  });
});
```

Run: `npx vitest run test/trash-restore.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  6 failed | 2 passed (8)).

Em `src/worker/routes/trash.ts`, substituir o bloco de `import` no topo do ficheiro (todas as linhas de `import`, até à linha em branco) por:

```ts
import { searchKey } from "../../shared/names";
import type { FileItem, TrashContents, TrashItem } from "../../shared/types";
import { getConfig } from "../config";
import { ApiError, isUniqueViolation } from "../errors";
import { FILE_COLUMNS, fileNameTaken, rowToFile, type FileRow } from "../lib/files";
import { pathsForFolders, trailOf } from "../lib/paths";
import { restoreCandidates } from "../lib/restore-names";
import { purgeTrashed, TRASH_PURGE_BATCH } from "../lib/trash";
import { createAuthedRouter } from "./authed";
```

Acrescentar ao fim de `src/worker/routes/trash.ts`:

```ts
/**
 * Restaura um ficheiro da lixeira (limpa `deleted_at`; a quota já o contava). Se o nome já está ocupado no destino,
 * experimenta os nomes de `restoreCandidates`; o destino é a pasta onde estava (ao apagar uma pasta, os ficheiros
 * que estavam na lixeira passaram para a raiz, por isso `folder_id` existe sempre ou é a raiz).
 */
trash.post("/:id/restore", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const row = await db
    .prepare(
      `SELECT ${FILE_COLUMNS} FROM files WHERE id = ?1 AND user_id = ?2 AND status = 'ready' AND deleted_at IS NOT NULL`,
    )
    .bind(c.req.param("id"), userId)
    .first<FileRow>();
  if (!row) throw new ApiError(404, "file_not_found", "Ficheiro não encontrado na lixeira.");

  for (const name of restoreCandidates(row.name)) {
    try {
      const restored = await db
        .prepare(
          `UPDATE files SET deleted_at = NULL, name = ?1, name_norm = ?2
           WHERE id = ?3 AND user_id = ?4 AND status = 'ready' AND deleted_at IS NOT NULL`,
        )
        .bind(name, searchKey(name), row.id, userId)
        .run();
      // Nenhuma linha alterada: outro pedido restaurou-o ou eliminou-o entretanto.
      if (restored.meta.changes !== 1) throw new ApiError(404, "file_not_found", "Ficheiro não encontrado na lixeira.");
      return c.json({ file: { ...rowToFile(row), name } satisfies FileItem });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error; // nome ocupado: tenta o seguinte
    }
  }
  throw fileNameTaken();
});
```

Run: `npx vitest run test/trash-restore.test.ts test/trash.test.ts test/authz.test.ts`
Expected: `Test Files  3 passed (3)`, `Tests  21 passed (21)`.

- [ ] **Step 3: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  29 passed (29)`, `Tests  248 passed (248)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src test
git commit -m "Acrescenta o restauro da lixeira com sufixo quando o nome está ocupado" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Partilha por link: criar, listar e revogar

**Files:**
- Create: `src/worker/lib/shares.ts`, `src/worker/routes/file-shares.ts`, `src/worker/routes/shares.ts`, `test/shares.test.ts`
- Modify: `src/worker/routes/files.ts`, `src/worker/app.ts`

**Interfaces:**
- Consumes: `requireFile` (Plano 2A), `randomToken`/`sha256Hex` (`src/worker/lib/crypto.ts`), `readJsonObject`, `ShareItem` (Task 2), `createAuthedRouter`, o limite global do corpo (Task 1),
  a tabela `shares` (migração `0001`, com `ON DELETE CASCADE` em `file_id`).
- Produces: `POST /api/files/:id/shares` (`{ expiresAt? }` → 201 `{ share: ShareItem, token }`; 400 `invalid_expiry`; 409 `too_many_shares` com 20 links ativos);
  `GET /api/files/:id/shares` → `{ shares: ShareItem[] }` (só os ativos, sem token); `DELETE /api/shares/:id` → 204 (404 `share_not_found`).
  `activeShare(alias, now)`, `parseExpiry(value, now)`, `rowToShare`, `SHARE_COLUMNS`, `MAX_ACTIVE_SHARES_PER_FILE = 20` em `src/worker/lib/shares.ts` (a Task 7 usa `activeShare`).

- [ ] **Step 1: As rotas de partilha (testes primeiro)**

O token tem 32 bytes aleatórios e só aparece na resposta da criação; a D1 guarda o hash (SHA-256), como nas sessões. Um link está ativo se não foi revogado nem expirou (`activeShare`, usado também na página pública). O teto de 20 links ativos por ficheiro verifica-se na própria instrução do `INSERT`.

Criar `test/shares.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ShareItem } from "../src/shared/types";
import { sha256Hex } from "../src/worker/lib/crypto";
import { JSON_BODY_LIMIT_BYTES } from "../src/worker/middleware/body-limit";
import { registerUser } from "./auth-helpers";
import { uploadOk } from "./file-helpers";
import { api, resetState } from "./helpers";

beforeEach(resetState);

const HOUR_MS = 3_600_000;

const createShare = (cookie: string, fileId: string, json: unknown = {}) =>
  api(`/api/files/${fileId}/shares`, { method: "POST", cookie, json });

async function created(cookie: string, fileId: string, json: unknown = {}): Promise<{ share: ShareItem; token: string }> {
  const res = await createShare(cookie, fileId, json);
  expect(res.status).toBe(201);
  return (await res.json()) as { share: ShareItem; token: string };
}

async function listShares(cookie: string, fileId: string): Promise<ShareItem[]> {
  const res = await api(`/api/files/${fileId}/shares`, { cookie });
  expect(res.status).toBe(200);
  return ((await res.json()) as { shares: ShareItem[] }).shares;
}

describe("POST /api/files/:id/shares", () => {
  it("exige sessão", async () => {
    expect((await api("/api/files/x/shares", { method: "POST", json: {} })).status).toBe(401);
    expect((await api("/api/files/x/shares")).status).toBe(401);
    expect((await api("/api/shares/x", { method: "DELETE" })).status).toBe(401);
  });

  it("cria um link: devolve o token uma só vez e a D1 guarda só o hash", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "x");

    const { share, token } = await created(cookie, file.id);

    expect(share).toMatchObject({ fileId: file.id, expiresAt: null });
    expect(typeof share.createdAt).toBe("number");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes em base64url
    const row = await env.DB.prepare("SELECT token_hash FROM shares WHERE id = ?1").bind(share.id).first<{ token_hash: string }>();
    expect(row?.token_hash).toBe(await sha256Hex(token));
    expect(row?.token_hash).not.toBe(token);
    expect((await created(cookie, file.id)).token).not.toBe(token); // cada link tem o seu token
  });

  it("aceita uma validade no futuro e recusa tudo o resto com 400", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "x");
    const inOneHour = Date.now() + HOUR_MS;

    expect((await created(cookie, file.id, { expiresAt: inOneHour })).share.expiresAt).toBe(inOneHour);
    expect((await created(cookie, file.id, { expiresAt: null })).share.expiresAt).toBeNull();

    for (const expiresAt of [Date.now() - 1000, 0, "amanhã", 1.5, true, {}]) {
      const res = await createShare(cookie, file.id, { expiresAt });
      expect(res.status, JSON.stringify(expiresAt)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_expiry" });
    }
    const noBody = await api(`/api/files/${file.id}/shares`, { method: "POST", cookie });
    expect(noBody.status).toBe(400);
    expect(await noBody.json()).toMatchObject({ error: "invalid_body" });
  });

  it("só se partilha um ficheiro pronto, fora da lixeira e do próprio utilizador (senão 404)", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const file = await uploadOk(ana.cookie, "a.txt", "x");
    const apagado = await uploadOk(ana.cookie, "b.txt", "x");
    await api(`/api/files/${apagado.id}`, { method: "DELETE", cookie: ana.cookie });

    for (const [cookie, id] of [[bob.cookie, file.id], [ana.cookie, apagado.id], [ana.cookie, "nao-existe"]]) {
      const res = await createShare(cookie, id);
      expect(res.status, id).toBe(404);
      expect(await res.json()).toMatchObject({ error: "file_not_found" });
    }
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM shares").first<{ n: number }>())?.n).toBe(0);
  });

  it("no máximo 20 links ativos por ficheiro; os revogados e os expirados não contam", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "x");
    const shares: ShareItem[] = [];
    for (let i = 0; i < 20; i++) shares.push((await created(cookie, file.id)).share);

    const tooMany = await createShare(cookie, file.id);
    expect(tooMany.status).toBe(409);
    expect(await tooMany.json()).toMatchObject({ error: "too_many_shares" });

    await api(`/api/shares/${shares[0].id}`, { method: "DELETE", cookie });
    await env.DB.prepare("UPDATE shares SET expires_at = 1 WHERE id = ?1").bind(shares[1].id).run();
    expect((await createShare(cookie, file.id)).status).toBe(201);
    expect((await createShare(cookie, file.id)).status).toBe(201);
    expect((await createShare(cookie, file.id)).status).toBe(409);
  });

  it("recusa com 413 um corpo acima de 64 KiB", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "x");
    const res = await createShare(cookie, file.id, { expiresAt: null, lixo: "x".repeat(JSON_BODY_LIMIT_BYTES) });
    expect(res.status).toBe(413);
  });
});

describe("GET /api/files/:id/shares", () => {
  it("lista só os links ativos, do mais recente para o mais antigo, sem o token", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "x");
    const first = await created(cookie, file.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await created(cookie, file.id, { expiresAt: Date.now() + HOUR_MS });
    const expired = await created(cookie, file.id, { expiresAt: Date.now() + HOUR_MS });
    const revoked = await created(cookie, file.id);
    await env.DB.prepare("UPDATE shares SET expires_at = 1 WHERE id = ?1").bind(expired.share.id).run();
    await api(`/api/shares/${revoked.share.id}`, { method: "DELETE", cookie });

    const res = await api(`/api/files/${file.id}/shares`, { cookie });
    const text = await res.text();

    const { shares } = JSON.parse(text) as { shares: ShareItem[] };
    expect(shares.map((s) => s.id)).toEqual([second.share.id, first.share.id]);
    expect(text).not.toContain(first.token);
    expect(text).not.toContain("token");
  });

  it("os links de outro utilizador ou de um ficheiro que não existe dão 404", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const file = await uploadOk(ana.cookie, "a.txt", "x");
    await created(ana.cookie, file.id);
    expect((await api(`/api/files/${file.id}/shares`, { cookie: bob.cookie })).status).toBe(404);
    expect((await api("/api/files/nao-existe/shares", { cookie: ana.cookie })).status).toBe(404);
    expect(await listShares(ana.cookie, file.id)).toHaveLength(1);
  });
});

describe("DELETE /api/shares/:id", () => {
  it("revoga o link: desaparece da lista e uma segunda revogação dá 404", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "x");
    const { share } = await created(cookie, file.id);

    const res = await api(`/api/shares/${share.id}`, { method: "DELETE", cookie });

    expect(res.status).toBe(204);
    expect(await listShares(cookie, file.id)).toEqual([]);
    const again = await api(`/api/shares/${share.id}`, { method: "DELETE", cookie });
    expect(again.status).toBe(404);
    expect(await again.json()).toMatchObject({ error: "share_not_found" });
  });

  it("um utilizador não revoga links de outro (404) e o link continua ativo", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const file = await uploadOk(ana.cookie, "a.txt", "x");
    const { share } = await created(ana.cookie, file.id);

    expect((await api(`/api/shares/${share.id}`, { method: "DELETE", cookie: bob.cookie })).status).toBe(404);
    expect((await api("/api/shares/nao-existe", { method: "DELETE", cookie: ana.cookie })).status).toBe(404);
    expect(await listShares(ana.cookie, file.id)).toHaveLength(1);
  });
});
```

Run: `npx vitest run test/shares.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  9 failed | 1 passed (10)).

Criar `src/worker/lib/shares.ts`:

```ts
import type { ShareItem } from "../../shared/types";
import { ApiError } from "../errors";

/** Links ativos por ficheiro: um teto simples contra linhas a mais (as contas abertas não têm outro limite). */
export const MAX_ACTIVE_SHARES_PER_FILE = 20;

/** Colunas de `shares` tal como vêm da D1. */
export interface ShareRow {
  id: string;
  file_id: string;
  created_at: number;
  expires_at: number | null;
}

export const SHARE_COLUMNS = "id, file_id, created_at, expires_at";

export function rowToShare(row: ShareRow): ShareItem {
  return { id: row.id, fileId: row.file_id, createdAt: row.created_at, expiresAt: row.expires_at };
}

/** Condição SQL "a partilha `alias` está ativa": não revogada e não expirada; `now` é o parâmetro (ex.: "?3") com o instante atual. */
export function activeShare(alias: string, now: string): string {
  return `${alias}.revoked_at IS NULL AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > ${now})`;
}

/** O `expiresAt` do pedido: ausente ou null = sem validade; senão um instante no futuro (milissegundos Unix). */
export function parseExpiry(value: unknown, now: number): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= now) {
    throw new ApiError(400, "invalid_expiry", "A validade tem de ser um instante no futuro.");
  }
  return value;
}
```

Criar `src/worker/routes/file-shares.ts`:

```ts
import type { Hono } from "hono";
import type { ShareItem } from "../../shared/types";
import { ApiError } from "../errors";
import { randomToken, sha256Hex } from "../lib/crypto";
import { requireFile } from "../lib/files";
import { readJsonObject } from "../lib/http";
import {
  activeShare,
  MAX_ACTIVE_SHARES_PER_FILE,
  parseExpiry,
  rowToShare,
  SHARE_COLUMNS,
  type ShareRow,
} from "../lib/shares";
import type { AppEnv } from "../types";

/**
 * As rotas de partilha de um ficheiro. Acrescentam-se ao router de `/api/files` (e não a um router à parte montado no mesmo
 * prefixo) para cada pedido passar por um só `requireAuth`.
 */
export function addFileShareRoutes(router: Hono<AppEnv>): void {
  /**
   * Cria um link (`{ expiresAt? }`). O token tem 32 bytes aleatórios; a D1 guarda só o hash e o token só sai nesta resposta.
   * O teto de links ativos é verificado na própria instrução do `INSERT`, por isso pedidos em paralelo não o passam.
   */
  router.post("/:id/shares", async (c) => {
    const db = c.env.DB;
    const user = c.get("user");
    const file = await requireFile(db, user.id, c.req.param("id"));
    const body = await readJsonObject(c);
    const now = Date.now();
    const expiresAt = parseExpiry(body.expiresAt, now);

    const token = randomToken();
    const id = crypto.randomUUID();
    const inserted = await db
      .prepare(
        `INSERT INTO shares (id, token_hash, file_id, user_id, created_at, expires_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6
         WHERE (SELECT COUNT(*) FROM shares s WHERE s.file_id = ?3 AND ${activeShare("s", "?5")}) < ?7`,
      )
      .bind(id, await sha256Hex(token), file.id, user.id, now, expiresAt, MAX_ACTIVE_SHARES_PER_FILE)
      .run();
    if (inserted.meta.changes !== 1) {
      throw new ApiError(
        409,
        "too_many_shares",
        `Este ficheiro já tem ${MAX_ACTIVE_SHARES_PER_FILE} links ativos. Revogue algum antes de criar outro.`,
      );
    }
    return c.json({ share: { id, fileId: file.id, createdAt: now, expiresAt } satisfies ShareItem, token }, 201);
  });

  /** Os links ativos do ficheiro (não revogados nem expirados), do mais recente para o mais antigo. Nunca incluem o token. */
  router.get("/:id/shares", async (c) => {
    const user = c.get("user");
    const file = await requireFile(c.env.DB, user.id, c.req.param("id"));
    const { results } = await c.env.DB.prepare(
      `SELECT ${SHARE_COLUMNS} FROM shares s
       WHERE s.file_id = ?1 AND s.user_id = ?2 AND ${activeShare("s", "?3")}
       ORDER BY s.created_at DESC, s.id`,
    )
      .bind(file.id, user.id, Date.now())
      .all<ShareRow>();
    return c.json({ shares: results.map(rowToShare) });
  });
}
```

Criar `src/worker/routes/shares.ts`:

```ts
import { ApiError } from "../errors";
import { createAuthedRouter } from "./authed";

export const shares = createAuthedRouter();

/** Revoga um link: deixa de funcionar logo (`revoked_at`). A linha fica até o cron de manutenção a limpar (Plano 4). */
shares.delete("/:id", async (c) => {
  const revoked = await c.env.DB.prepare(
    "UPDATE shares SET revoked_at = ?1 WHERE id = ?2 AND user_id = ?3 AND revoked_at IS NULL",
  )
    .bind(Date.now(), c.req.param("id"), c.get("user").id)
    .run();
  if (revoked.meta.changes !== 1) throw new ApiError(404, "share_not_found", "Link não encontrado.");
  return c.body(null, 204);
});
```

Em `src/worker/routes/files.ts`, nos `import`, trocar:

```ts
import { createAuthedRouter } from "./authed";
```

por:

```ts
import { createAuthedRouter } from "./authed";
import { addFileShareRoutes } from "./file-shares";
```

No mesmo ficheiro, trocar:

```ts
export const files = createAuthedRouter();
```

por:

```ts
export const files = createAuthedRouter();
addFileShareRoutes(files);
```

Em `src/worker/app.ts`, nos `import`, trocar:

```ts
import { search } from "./routes/search";
```

por:

```ts
import { search } from "./routes/search";
import { shares } from "./routes/shares";
```

No mesmo ficheiro, trocar:

```ts
app.route("/api/search", search);
```

por:

```ts
app.route("/api/search", search);
app.route("/api/shares", shares);
```

Run: `npx vitest run test/shares.test.ts test/authz.test.ts`
Expected: `Test Files  2 passed (2)`, `Tests  12 passed (12)` (a varredura de `test/authz.test.ts` apanha as rotas novas e confirma o 401).

- [ ] **Step 2: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  30 passed (30)`, `Tests  258 passed (258)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src test
git commit -m "Acrescenta a partilha por link: criar com validade opcional, listar e revogar" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Páginas públicas de partilha: nome, tamanho e descarregamento sem sessão

**Files:**
- Create: `src/worker/routes/public.ts`, `test/public-shares.test.ts`
- Modify: `src/worker/app.ts`, `test/authz.test.ts`

**Interfaces:**
- Consumes: `activeShare` (Task 6), `attachmentResponse`/`missingObject` (Task 1), `sha256Hex`, `PublicShare` (Task 2), `setUserStatus`/`registerUser`, `bodyText`, `silenceErrors`.
- Produces: `GET /api/public/shares/:token` → `{ name, size }` e `GET /api/public/shares/:token/download` (anexo), ambos **sem sessão**; qualquer link inválido, revogado, expirado, de um ficheiro
  na lixeira ou de uma conta que não está ativa dá a mesma resposta `404 share_not_found`. As duas rotas passam a estar na lista de rotas públicas de `test/authz.test.ts`.

- [ ] **Step 1: As rotas públicas (testes primeiro)**

As rotas públicas são as únicas, além do registo, do login e do `health`, que não exigem sessão. Um link só serve o ficheiro se estiver ativo, o ficheiro estiver pronto e fora da lixeira (por isso excluir um ficheiro desliga os links e restaurá-lo volta a ligá-los) e a conta do dono estiver ativa. Todos os casos em que não serve respondem do mesmo modo.

Criar `test/public-shares.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { PublicShare, ShareItem } from "../src/shared/types";
import { registerUser, setUserStatus } from "./auth-helpers";
import { silenceErrors } from "./db-helpers";
import { bodyText, uploadOk } from "./file-helpers";
import { api, resetState } from "./helpers";

beforeEach(resetState);

async function share(cookie: string, fileId: string, json: unknown = {}): Promise<{ share: ShareItem; token: string }> {
  const res = await api(`/api/files/${fileId}/shares`, { method: "POST", cookie, json });
  expect(res.status).toBe(201);
  return (await res.json()) as { share: ShareItem; token: string };
}

const info = (token: string) => api(`/api/public/shares/${token}`);
const download = (token: string) => api(`/api/public/shares/${token}/download`);

/** Cria um ficheiro partilhado e devolve tudo o que os testes precisam. */
async function setup(content = "conteúdo secreto") {
  const ana = await registerUser("ana@example.com");
  const file = await uploadOk(ana.cookie, "relatório.txt", content);
  return { ana, file, ...(await share(ana.cookie, file.id)) };
}

const NOT_FOUND = { error: "share_not_found", message: "Este link não existe ou já não está disponível." };

describe("páginas públicas de partilha", () => {
  it("mostra o nome e o tamanho a quem tem o link, sem sessão", async () => {
    const { token, file } = await setup("12345");

    const res = await info(token); // sem cookie

    expect(res.status).toBe(200);
    expect((await res.json()) as PublicShare).toEqual({ name: "relatório.txt", size: file.size });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("descarrega o ficheiro como anexo, sem sessão", async () => {
    const { token } = await setup("conteúdo secreto");

    const res = await download(token);

    expect(res.status).toBe(200);
    expect(await bodyText(res)).toBe("conteúdo secreto");
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''relat%C3%B3rio.txt");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("um link que nunca existiu e um ativo falham do mesmo modo que um link revogado, expirado ou de um ficheiro na lixeira (404 igual, sem pistas)", async () => {
    const { ana, file, token } = await setup();
    const expired = await share(ana.cookie, file.id, { expiresAt: Date.now() + 3_600_000 });
    const revoked = await share(ana.cookie, file.id);
    await env.DB.prepare("UPDATE shares SET expires_at = 1 WHERE id = ?1").bind(expired.share.id).run();
    await api(`/api/shares/${revoked.share.id}`, { method: "DELETE", cookie: ana.cookie });

    for (const dead of ["nunca-existiu", expired.token, revoked.token]) {
      for (const get of [info, download]) {
        const res = await get(dead);
        expect(res.status, dead).toBe(404);
        expect(await res.json()).toEqual(NOT_FOUND);
      }
    }
    expect((await info(token)).status).toBe(200); // o link ativo não foi afetado
  });

  it("enquanto o ficheiro está na lixeira o link não funciona, e volta a funcionar depois do restauro", async () => {
    const { ana, file, token } = await setup();
    await api(`/api/files/${file.id}`, { method: "DELETE", cookie: ana.cookie });

    for (const get of [info, download]) {
      const res = await get(token);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }

    expect((await api(`/api/trash/${file.id}/restore`, { method: "POST", cookie: ana.cookie })).status).toBe(200);
    expect((await info(token)).status).toBe(200);
    expect((await download(token)).status).toBe(200);
  });

  it("depois de eliminar o ficheiro de vez, o link nunca mais funciona (as partilhas saem em cascata)", async () => {
    const { ana, file, token } = await setup();
    await api(`/api/files/${file.id}`, { method: "DELETE", cookie: ana.cookie });
    await api(`/api/trash/${file.id}`, { method: "DELETE", cookie: ana.cookie });

    expect((await info(token)).status).toBe(404);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM shares").first<{ n: number }>())?.n).toBe(0);
  });

  it("os links de uma conta suspensa deixam de funcionar", async () => {
    const { token } = await setup();
    await setUserStatus("ana@example.com", "suspended");
    const res = await info(token);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    await setUserStatus("ana@example.com", "active");
    expect((await info(token)).status).toBe(200);
  });

  it("se o objeto falta no R2, o descarregamento responde 404 `file_missing` e regista o problema", async () => {
    const errors = silenceErrors();
    const { token } = await setup();
    const { results } = await env.DB.prepare("SELECT r2_key FROM files").all<{ r2_key: string }>();
    await env.FILES.delete(results.map((row) => row.r2_key));

    const res = await download(token);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "file_missing" });
    expect(errors).toHaveBeenCalled();
  });
});
```

Run: `npx vitest run test/public-shares.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  6 failed | 1 passed (7)).

Criar `src/worker/routes/public.ts`:

```ts
import { Hono } from "hono";
import type { PublicShare } from "../../shared/types";
import { ApiError } from "../errors";
import { sha256Hex } from "../lib/crypto";
import { activeShare } from "../lib/shares";
import { attachmentResponse, missingObject } from "../lib/serve";
import type { AppEnv } from "../types";

/** Rotas públicas (sem sessão): só servem ficheiros partilhados por um link ativo. */
export const publicRoutes = new Hono<AppEnv>();

interface SharedFile {
  fileId: string;
  name: string;
  size: number;
  mime: string;
  r2Key: string;
}

/**
 * O ficheiro de um link, ou 404 `share_not_found`, sempre com a mesma resposta (nada diz se o link nunca existiu, foi revogado, expirou
 * ou o ficheiro está na lixeira). Só vale se o link está ativo, o ficheiro está pronto e fora da lixeira e a conta do dono está ativa.
 */
async function requireSharedFile(db: D1Database, token: string): Promise<SharedFile> {
  const row = await db
    .prepare(
      `SELECT f.id, f.name, f.size, f.mime, f.r2_key
       FROM shares s
       JOIN files f ON f.id = s.file_id
       JOIN users u ON u.id = f.user_id
       WHERE s.token_hash = ?1 AND ${activeShare("s", "?2")}
         AND f.status = 'ready' AND f.deleted_at IS NULL AND u.status = 'active'`,
    )
    .bind(await sha256Hex(token), Date.now())
    .first<{ id: string; name: string; size: number; mime: string; r2_key: string }>();
  if (!row) throw new ApiError(404, "share_not_found", "Este link não existe ou já não está disponível.");
  return { fileId: row.id, name: row.name, size: row.size, mime: row.mime, r2Key: row.r2_key };
}

/** O que a página pública mostra: o nome e o tamanho. */
publicRoutes.get("/shares/:token", async (c) => {
  const file = await requireSharedFile(c.env.DB, c.req.param("token"));
  return c.json({ name: file.name, size: file.size } satisfies PublicShare);
});

/** Descarrega o ficheiro partilhado, sempre como anexo. */
publicRoutes.get("/shares/:token/download", async (c) => {
  const file = await requireSharedFile(c.env.DB, c.req.param("token"));
  const object = await c.env.FILES.get(file.r2Key);
  if (!object) throw missingObject(file.fileId);
  return attachmentResponse(object, file);
});
```

Em `src/worker/app.ts`, nos `import`, trocar:

```ts
import { folders } from "./routes/folders";
```

por:

```ts
import { folders } from "./routes/folders";
import { publicRoutes } from "./routes/public";
```

No mesmo ficheiro, trocar:

```ts
app.route("/api/files", files);
```

por:

```ts
app.route("/api/files", files);
app.route("/api/public", publicRoutes);
```

Run: `npx vitest run test/public-shares.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  7 passed (7)`.

Run: `npx vitest run test/authz.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  1 failed | 1 passed (2)). a varredura de `test/authz.test.ts` trata as rotas públicas novas como privadas e falha: é o aviso de que a lista de rotas públicas tem de ser atualizada de propósito

Em `test/authz.test.ts`, na lista `PUBLIC_ROUTES`, trocar:

```ts
  "POST /api/auth/logout",
]);
```

por:

```ts
  "POST /api/auth/logout",
  "GET /api/public/shares/:token",
  "GET /api/public/shares/:token/download",
]);
```

Run: `npx vitest run test/authz.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  2 passed (2)`.

- [ ] **Step 2: Isolamento entre utilizadores nas partilhas**

Acrescentar ao fim de `test/authz.test.ts`:

```ts
describe("isolamento das partilhas", () => {
  it("o Bob não cria, lista nem revoga links da Ana, e o Bob não vê nada da Ana pela rota pública sem o token", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const ficheiro = await uploadOk(ana.cookie, "da-ana.txt", "segredo");
    const created = await api(`/api/files/${ficheiro.id}/shares`, { method: "POST", cookie: ana.cookie, json: {} });
    const { share } = (await created.json()) as { share: { id: string } };

    const attempts: Array<[string, string, unknown?]> = [
      ["POST", `/api/files/${ficheiro.id}/shares`, {}],
      ["GET", `/api/files/${ficheiro.id}/shares`],
      ["DELETE", `/api/shares/${share.id}`],
    ];
    for (const [method, path, json] of attempts) {
      const res = await api(path, { method, cookie: bob.cookie, json });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    const mine = await api(`/api/files/${ficheiro.id}/shares`, { cookie: ana.cookie });
    expect(((await mine.json()) as { shares: unknown[] }).shares).toHaveLength(1);
  });
});
```

Run: `npx vitest run test/authz.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  3 passed (3)`.

- [ ] **Step 3: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  31 passed (31)`, `Tests  266 passed (266)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src test
git commit -m "Acrescenta as rotas públicas de partilha e testa o isolamento das partilhas" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Documentação e verificação final do Plano 3A

**Files:**
- Modify: `README.md`, `docs/superpowers/plans/README.md`

**Interfaces:**
- Sem código novo: documenta a API da lixeira, da pesquisa e da partilha no README, regista o Plano 3A (e o 3B por escrever) no índice dos planos, passa os pendentes e faz a verificação final.

- [ ] **Step 1: Documentar a API no README**

Em `README.md`, no título da secção da API, trocar:

```markdown
## API (pastas e ficheiros)
```

por:

```markdown
## API
```

No primeiro parágrafo dessa secção, trocar:

```markdown
Todas as rotas desta secção exigem sessão (cookie `sw_session`). Em toda a API só são públicas `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout` e `GET /api/health`.
```

por:

```markdown
Todas as rotas desta secção exigem sessão (cookie `sw_session`), exceto as duas de `/api/public/shares/…`. Em toda a API só são públicas `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/health`, `GET /api/public/shares/:token` e `GET /api/public/shares/:token/download`.
```

Na tabela da API, trocar a última linha:

```markdown
| `GET /api/config` | Limites do servidor para o browser: `{ maxUploadBytes }` |
```

por:

```markdown
| `GET /api/config` | Limites do servidor para o browser: `{ maxUploadBytes }` |
| `GET /api/search?q=` | Pesquisa por nome nas pastas e nos ficheiros (sem distinguir maiúsculas nem acentos; 2 a 100 caracteres; até 50 resultados, cada um com o caminho da pasta onde está) |
| `GET /api/trash` | A lixeira: até 200 ficheiros excluídos, os mais recentes primeiro, com a pasta onde estavam e a data da eliminação automática (`total` conta todos) |
| `POST /api/trash/:id/restore` | Restaura um ficheiro; se o nome estiver ocupado acrescenta « (restaurado)», « (restaurado 2)», … |
| `DELETE /api/trash/:id` | Elimina um ficheiro de vez (apaga o objeto do R2 e devolve o espaço) |
| `DELETE /api/trash` | Esvazia a lixeira por blocos de 50 e responde `{ purged, remaining }`: repetir até `remaining` ser 0 |
| `POST /api/files/:id/shares` | Cria um link (`{ expiresAt? }`, em milissegundos Unix). O `token` só vem nesta resposta; no máximo 20 links ativos por ficheiro (409 `too_many_shares`) |
| `GET /api/files/:id/shares` | Os links ativos do ficheiro (sem o token) |
| `DELETE /api/shares/:id` | Revoga um link |
| `GET /api/public/shares/:token` | Público: nome e tamanho do ficheiro partilhado |
| `GET /api/public/shares/:token/download` | Público: descarrega o ficheiro partilhado (sempre como anexo) |

Um link só funciona se não foi revogado nem expirou, o ficheiro está fora da lixeira e a conta do dono está ativa; nos outros casos a resposta é sempre `404 share_not_found`, sem dizer porquê.
```

Na secção «Interface», trocar:

```markdown
Até ao Plano 3 não há ecrã da lixeira: os ficheiros excluídos continuam a ocupar quota.
```

por:

```markdown
A API da lixeira, da pesquisa e da partilha já existe, mas só o Plano 3B lhes dá ecrãs: até lá os ficheiros excluídos continuam a ocupar quota até serem eliminados de vez.
```

- [ ] **Step 2: Registar o Plano 3A no índice dos planos**

Em `docs/superpowers/plans/README.md`, na tabela, trocar o estado do Plano 3A:

```markdown
| 3A | [API da lixeira, pesquisa e partilha](2026-10-03-03a-api-lixeira-pesquisa-partilha.md) | Lixeira (listar, restaurar com sufixo, eliminar de vez, esvaziar), pesquisa por nome com o caminho de cada resultado, links de partilha (criar com validade, listar, revogar) e as rotas públicas de nome, tamanho e descarregamento | Escrito, por executar |
```

por:

```markdown
| 3A | [API da lixeira, pesquisa e partilha](2026-10-03-03a-api-lixeira-pesquisa-partilha.md) | Lixeira (listar, restaurar com sufixo, eliminar de vez, esvaziar), pesquisa por nome com o caminho de cada resultado, links de partilha (criar com validade, listar, revogar) e as rotas públicas de nome, tamanho e descarregamento | Concluído |
```

Na secção "Pendentes herdados", trocar todo o bloco do Plano 3:

```markdown
**Plano 3 (lixeira, pesquisa, partilha)**
- Decrementos de quota com `MAX(used_bytes - ?, 0)`, para um desvio de contabilidade não fazer falhar a `batch` para sempre.
- Testes de `shares` (`token_hash` único, `ON DELETE CASCADE` de `file_id`).
- Novo (revisão final do 2A): montar o `jsonBodyLimit` por construção (global em `/api/*`, exceto `PUT /api/files`), em vez de rota a rota.
- Novo: na pesquisa, calcular os caminhos dos até 50 resultados numa só consulta (nunca um `breadcrumbFor` por resultado: o limite do plano gratuito é 50 subpedidos por invocação).
- Novo: nos decrementos de quota, preferir `UPDATE ... WHERE EXISTS (linha)` antes do `DELETE` a depender de `changes()` entre instruções da `batch`.
- Novo: extrair de `routes/files.ts` os helpers de servir ficheiros (cabeçalhos e `missingObject`; o `parseRange` já está em `lib/files.ts`) para o descarregamento público.
- Novo: no restauro com sufixo, respeitar o limite de 255 e as linhas `pending`.
- Novo (revisão final do 2B): extrair o código comum de `FolderActions`/`FileActions` quando entrar «Partilhar»; dividir o contexto dos envios (itens e ações) para a lista não re-renderizar a cada evento de progresso; um refresh por ficheiro enviado (agrupar quando a fila fica ociosa).
- Novo: a mensagem `name_taken` dos ficheiros está duplicada em dois literais (`routes/files.ts`) e a do `PATCH` não tem teste; faltam testes de isolamento entre utilizadores de `subtreeHeight`, de profundidade com árvores que não são cadeias, e do ramo `depth >= MAX_FOLDER_DEPTH` do `UPDATE_FOLDER_SQL` (deixou de ter teste quando `assertFitsBelow` passou à frente; cobre-se com `patchWithRace`); `breadcrumbFor` corre duas vezes por movimento; faltam testes dos hooks `useDeleteFolder`/`useUpdateFile`; `formatDate` com `NaN`.
- Novo: se outro separador do mesmo browser termina a sessão e entra com outra conta, a fila de um separador antigo pode enviar ficheiros da raiz para a conta nova (a fila só se cancela quando o `me` desse separador muda de utilizador): solução robusta com `BroadcastChannel` ou com verificação do dono do envio no servidor.
- Novo: «Sair» com envios em curso cancela-os em silêncio: avisar antes.
```

por:

```markdown
**Plano 3 (lixeira, pesquisa, partilha): a API ficou no Plano 3A; a interface é o Plano 3B**
- Resolvido no 3A: decrementos de quota com `MAX(used_bytes - ?, 0)` e, ao desfazer uma reserva, `UPDATE ... WHERE EXISTS` antes do `DELETE` (sem depender de `changes()`); testes de `shares` (`token_hash` único, `ON DELETE CASCADE`); o limite do corpo (64 KiB) montado em `/api/*`, menos o upload; os caminhos dos resultados da pesquisa e da lixeira numa só consulta por bloco de 50 pastas (`pathsForFolders`); os ajudantes de servir ficheiros em `lib/serve.ts`; o restauro com sufixo (respeita os 255 caracteres e as linhas `pending`); a mensagem `name_taken` dos ficheiros numa só função, com teste; testes de isolamento de `subtreeHeight`, de pastas largas e da guarda do `UPDATE_FOLDER_SQL`.
- Para o 3B (interface): esvaziar a lixeira repete `DELETE /api/trash` até `remaining` ser 0 (ou `purged` ser 0); a lixeira lista no máximo 200 (`total` conta todos); o link completo só se mostra uma vez, na criação (`token` da resposta de `POST /api/files/:id/shares`); extrair o código comum de `FolderActions`/`FileActions` quando entrar «Partilhar»; dividir o contexto dos envios (itens e ações) para a lista não re-renderizar a cada evento de progresso; um refresh por ficheiro enviado (agrupar quando a fila fica ociosa); «Sair» com envios em curso cancela-os em silêncio: avisar antes; faltam testes dos hooks `useDeleteFolder`/`useUpdateFile`; `formatDate` com `NaN`.
- Fica sem plano: `breadcrumbFor` corre duas vezes por movimento de pasta (uma em `wouldCreateCycle` e outra em `assertFitsBelow`); se outro separador do mesmo browser termina a sessão e entra com outra conta, a fila de um separador antigo pode enviar ficheiros da raiz para a conta nova (solução robusta com `BroadcastChannel` ou com verificação do dono do envio no servidor).
```

No bloco do Plano 4, acrescentar uma linha a seguir à última:

```markdown
- Novo: as pastas de uma conta apagam-se com um só `DELETE ... WHERE user_id = ?`, depois dos ficheiros.
```

por:

```markdown
- Novo: as pastas de uma conta apagam-se com um só `DELETE ... WHERE user_id = ?`, depois dos ficheiros.
- Novo (3A): o cron da lixeira usa `purgeTrashed` (`lib/trash.ts`, no máximo 50 ficheiros por chamada), que já desconta a quota e tira os objetos do R2; se o R2 falhar o objeto fica órfão e só aparece no registo (a varredura pelo prefixo `u/<userId>/` também os apanha). O cron apaga ainda as partilhas revogadas ou expiradas há mais de 30 dias (as de ficheiros eliminados saem em cascata).
```

- [ ] **Step 3: Verificação final**

Run: `npx vitest run`
Expected: `Test Files  31 passed (31)`, `Tests  266 passed (266)`.

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  21 passed (21)`, `Tests  137 passed (137)` (a interface não mudou neste plano: os mesmos testes do Plano 2B).

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npm run build`
Expected: `✓ built in ...` duas vezes (Worker e cliente).

- [ ] **Step 4: Verificação manual da API com `curl`**

Os testes correm no `workerd` com a D1 e o R2 simulados; antes de dar o plano por concluído, passar pelas rotas novas com HTTP a sério (o controlador faz isto; **não** usar a senha do master real):

1. Numa pasta de trabalho limpa: `rm -rf .wrangler`, `npm run db:migrate:local`, criar um utilizador de teste com o `seed:master` (`MASTER_EMAIL=master@example.test` e uma senha inventada na hora, só em variáveis de ambiente) e `--local`, e arrancar `npm run dev` (`http://localhost:5173`).
2. Entrar com `curl -c jar ... /api/auth/login` (cabeçalho `Origin: http://localhost:5173`), enviar dois ficheiros com `curl -X PUT --data-binary @ficheiro -H 'Origin: ...' -b jar 'http://localhost:5173/api/files?name=a.txt'`, excluir um (`DELETE /api/files/:id`) e ver `GET /api/trash`: aparece com `purgeAt` a 30 dias.
3. Restaurar (`POST /api/trash/:id/restore`) depois de enviar outro ficheiro com o mesmo nome: volta com ` (restaurado)`.
4. `GET /api/search?q=` com 1 e com 2 letras, com acentos e maiúsculas trocadas; criar um link (`POST /api/files/:id/shares` com `{}`), abrir `GET /api/public/shares/<token>` e o `/download` **sem cookie** (`curl` sem `-b`) e confirmar o cabeçalho `Content-Disposition: attachment`.
5. Revogar (`DELETE /api/shares/:id`) e ver o 404 `share_not_found` no mesmo URL; excluir o ficheiro e ver que um link novo também dá 404 até o restaurar.
6. Esvaziar a lixeira (`DELETE /api/trash`) e ver `{ "purged": n, "remaining": 0 }` e o espaço usado (`/api/auth/me`) a descer.
7. Parar o `npm run dev` e apagar `.wrangler`.

- [ ] **Step 5: Commit**

Commit:

```bash
git add README.md docs
git commit -m "Documenta a API da lixeira, da pesquisa e da partilha e regista o Plano 3A" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Auto-revisão do plano contra a especificação

| Requisito | Onde |
|---|---|
| Spec §5, restaurar: limpa `deleted_at`; nome ocupado → sufixo " (restaurado)", " (restaurado 2)"…; pasta original apagada → raiz | Task 5 |
| Spec §5, eliminar definitivamente (um ficheiro ou esvaziar): apaga o R2 e a linha e desconta a quota | Task 4 |
| Spec §5, pesquisa: `name_norm LIKE`, `%` e `_` escapados, mínimo 2, máximo 50, só `ready` e fora da lixeira, com o caminho completo | Tasks 2 e 3 |
| Spec §5, partilha: token de 32 bytes, só o hash na D1, link completo só na criação, validade opcional, lista de ativos, revogar | Task 6 |
| Spec §5, partilha: só vale com o ficheiro `ready` e fora da lixeira e o link nem expirado nem revogado; página pública com nome, tamanho e descarregar | Task 7 |
| Spec §6: `GET /api/trash`, `POST /api/trash/:id/restore`, `DELETE /api/trash/:id`, `DELETE /api/trash`, `POST`/`GET /api/files/:id/shares`, `DELETE /api/shares/:id`, `GET /api/public/shares/:token` e `/download`, `GET /api/search?q=` | Tasks 3, 4, 5, 6 e 7 |
| Spec §4: isolamento entre utilizadores (404) nas rotas novas | Tasks 3 a 7 e `test/authz.test.ts` (Task 7) |
| Pendente do Plano 2A: `MAX(used_bytes - ?, 0)` e `UPDATE ... WHERE EXISTS` nos decrementos de quota | Tasks 1 e 4 |
| Pendente do Plano 2A: testes de `shares` (`token_hash` único, `ON DELETE CASCADE`) | Task 1 |
| Pendente do Plano 2A: `jsonBodyLimit` por construção | Task 1 |
| Pendente do Plano 2A: caminhos dos resultados numa só consulta | Task 2 |
| Pendente do Plano 2A: extrair os ajudantes de servir ficheiros para o descarregamento público | Tasks 1 e 7 |
| Pendente do Plano 2A: restauro com sufixo respeita os 255 caracteres e as linhas `pending` | Task 5 |
| Pendente do Plano 2B (API): `name_taken` numa só função e testada; testes de `subtreeHeight` e da guarda do `UPDATE_FOLDER_SQL` | Task 1 |

**Fora deste plano:** a interface da lixeira, da pesquisa e da partilha (Plano 3B); o painel de administração e o cron de manutenção, que vai reutilizar `purgeTrashed` (Plano 4); o deploy (Plano 5). Até ao 3B nada na interface mostra a lixeira: os ficheiros excluídos continuam a ocupar quota.

**Totais de testes (medidos na execução deste plano numa pasta limpa):** Worker: Test Files 31 passed (31); Tests 266 passed (266). Interface: Test Files 21 passed (21); Tests 137 passed (137).

## Notas da execução

- **Decisões de desenho que a especificação deixa em aberto:** a lixeira lista no máximo 200 itens (`total` conta todos) e esvazia-se por blocos de 50 (`{ purged, remaining }`), porque cada chamada à API gasta chamadas de D1 e R2 do limite do plano gratuito; cada ficheiro tem no máximo 20 links ativos (`409 too_many_shares`), um teto simples contra linhas a mais; os links de uma conta que não está ativa (suspensa ou a ser apagada) deixam de funcionar; e `purgeTrashed` só apaga do R2 os objetos das linhas que o `DELETE ... RETURNING` apagou mesmo, para um ficheiro restaurado a meio nunca perder o conteúdo.
- **Verificação manual:** a lista da Task 8 foi percorrida com `curl` contra o `npm run dev` durante a escrita deste plano (excluir, lixeira com `purgeAt` a 30 dias, restauro com ` (restaurado)`, pesquisa, link público sem cookie com `Content-Disposition: attachment`, revogação, esvaziar a lixeira e o espaço a descer).
