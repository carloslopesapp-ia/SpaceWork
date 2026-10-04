# SpaceWork — Plano 2B: Interface «Meu espaço» (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A página «Meu espaço»: ver as pastas e os ficheiros com o caminho (*breadcrumb*), criar pastas, enviar ficheiros (botão ou arrastar-e-largar) com progresso, e, por item, pré-visualizar, descarregar, renomear, mover e excluir — tudo sobre a API do Plano 2A.

**Architecture:** A interface lê o servidor com TanStack Query (uma consulta por pasta, mais a árvore de pastas e o utilizador) e **todas** as mutações invalidam essas consultas ao terminar, por isso nenhum ecrã precisa de se lembrar de atualizar o resto. Os envios usam `XMLHttpRequest` (o `fetch` não dá progresso) numa fila fora do React (3 em paralelo) montada na área autenticada, para continuarem quando se muda de pasta. O `apiFetch` trata num só sítio a falha de rede e a sessão expirada. Os testes de interface correm em jsdom, numa segunda configuração do Vitest, com um servidor falso (`mockApi`); a API real já tem os seus testes.

**Tech Stack:** o do Plano 1 (React 19, React Router 8, TanStack Query 5, Tailwind 4, Vite 8) e do Plano 2A, mais `jsdom` e o Testing Library (`@testing-library/react`, `dom`, `user-event`, `jest-dom`) como dependências de desenvolvimento.

**Spec:** [docs/superpowers/specs/2026-10-03-spacework-design.md](../specs/2026-10-03-spacework-design.md) (secção 8, ecrã «Meu espaço», sem a pesquisa, a partilha e a lixeira, que são do Plano 3). Índice dos planos: [README.md](README.md). Este plano trata também dos pendentes do Plano 1 (frontend) e do 2A atribuídos ao 2B (secção "Pendentes herdados" do índice).

## Global Constraints

Valores da especificação e dos planos anteriores; todas as tarefas os cumprem implicitamente.

- Interface e mensagens ao utilizador em português europeu. A interface mostra a `message` que a API devolve; só as mensagens geradas no cliente (rede em baixo, ficheiro acima do limite, pasta que não existe, resposta sem JSON) são escritas na interface.
- Nomes de pastas e ficheiros: a interface valida com `normalizeName` e `validateName` (`src/shared/names.ts`), as mesmas regras do servidor; o servidor continua a ser a autoridade (409 `name_taken`, 400 `invalid_name`).
- Todas as chamadas à API passam por `apiFetch` (JSON) ou `uploadFile` (envio); os erros chegam como `ApiRequestError` com `status`, `code` e `message`. Um 401 `unauthorized` leva sempre ao ecrã de entrada.
- Envios: no máximo 3 em paralelo (`MAX_PARALLEL_UPLOADS`); um ficheiro acima de `maxUploadBytes` (de `GET /api/config`) nem sai do browser; o nome e a pasta vão no URL construído com `URLSearchParams`.
- Pré-visualizar: só os tipos de `src/shared/preview.ts` (png, jpg, jpeg, gif, webp, pdf). Sem miniaturas na lista (a API responde com `no-store`).
- Acessibilidade: diálogos com `role="dialog"`, título, foco preso lá dentro e devolvido a quem os abriu; menus com `role="menu"`; todos os botões de ícone com nome acessível.
- Pastas: no máximo 100 níveis (`400 folder_too_deep`).
- O que só corre no browser (`src/web`) nunca importa de `src/worker`; `src/shared` não importa nada.
- O estado da D1 e do R2 de teste não é isolado entre testes do mesmo ficheiro (testes do Worker: `beforeEach(resetState)` ou `resetDb`). Vitest `^4.1`.
- **Nenhum `git push` sem confirmação explícita do utilizador.**

## Ambiente

- Node 24 e npm 11; todos os comandos correm na raiz do repositório (`~/Developer/SpaceWork`, fora do iCloud). Ramo de trabalho: `plano-2b-interface`.
- Commits: mensagem curta em português; cada commit termina com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (nos comandos abaixo, é o segundo `-m`). Escrever **exatamente** esse trailer, "Claude Sonnet 5.5", mesmo que o modelo que executa seja outro.
- Dois conjuntos de testes: `npx vitest run` (o Worker, no `workerd`, a partir da Task 1) e `npx vitest run -c vitest.web.config.ts` (a interface, em jsdom, a partir da Task 2). `npm test` corre os dois.
- Os testes mostram só o resumo do Vitest: se aparecer qualquer outra saída (avisos do `workerd`, `console.error`, avisos `act(...)` do React), é um defeito do teste a corrigir.
- A Task 2 instala pacotes (`npm install -D …`): precisa de rede. Os avisos `allow-scripts` do npm 11 são inofensivos.

## Estrutura de ficheiros deste plano

```
src/shared/preview.ts            previewContentType (movido de src/worker/lib/files.ts)
src/shared/format.ts             + formatDate
src/shared/types.ts              + ClientConfig
src/worker/routes/config.ts      GET /api/config
src/worker/lib/folders.ts        + MAX_NESTING, assertFitsBelow
vitest.web.config.ts             testes da interface (jsdom)
src/web/api.ts                   apiFetch com rede, mensagens de recurso e sessão expirada
src/web/query-client.ts          createQueryClient, shouldRetry
src/web/space.ts                 consultas e mutações do espaço
src/web/tree.ts                  árvore de pastas para o diálogo "Mover"
src/web/upload.ts                uploadFile (XHR)
src/web/uploads.ts               UploadManager (fila, 3 em paralelo)
src/web/uploads-context.tsx      UploadsProvider, useUploads
src/web/dropped-files.ts         filesFromDrop
src/web/pages/FolderPage.tsx     «Meu espaço» (substitui HomePage)
src/web/components/              Modal, NameDialog, ConfirmDialog, RowMenu, Breadcrumb, MoveDialog,
                                 FolderActions, FileActions, PreviewDialog, UploadPanel, ItemRows, icons
src/web/test/                    setup, mock-api, render, fake-xhr (ajudantes dos testes)
```

---


### Task 1: API: configuração do cliente, pré-visualização partilhada, profundidade das pastas e nomes de teste

**Files:**
- Create: `src/shared/preview.ts`, `src/worker/routes/config.ts`
- Create: `test/preview.test.ts`, `test/client-config.test.ts`, `test/folders-depth.test.ts`
- Modify: `src/shared/types.ts`, `src/worker/app.ts`, `src/worker/lib/files.ts`, `src/worker/lib/folders.ts`
- Modify: `src/worker/routes/files.ts`, `src/worker/routes/folders.ts`
- Modify: `test/names.test.ts`, `test/files-upload.test.ts`, `test/folders-races.test.ts`

**Interfaces:**
- Consumes: `getConfig`, `createAuthedRouter`, `breadcrumbFor`, `requireFolder`, `ApiError` (Planos 1 e 2A).
- Produces: `GET /api/config` → `{ maxUploadBytes: number }` (tipo `ClientConfig`); `previewContentType(name)` em `src/shared/preview.ts`;
  `assertFitsBelow(db, userId, parentId, movingFolderId?)` e `MAX_NESTING = 100` em `src/worker/lib/folders.ts`; erro `400 folder_too_deep`.

- [ ] **Step 1: Trocar os caracteres invisíveis de `test/names.test.ts` por escapes `\u…`**

O ficheiro tem literais invisíveis (U+0301, NBSP, BOM, controlos de direção, ZWJ) em vez de escapes: o GitHub avisa de Unicode bidirecional e quem lê o teste não os vê. Esta troca não muda o comportamento: os testes têm de continuar a passar e as guardas existentes (que verificam o comprimento dos valores) mantêm-se.

Run:

```bash
perl -CSD -i -pe 's/([\x{0300}-\x{036f}\x{00a0}\x{061c}\x{0080}-\x{009f}\x{200b}-\x{200f}\x{202a}-\x{202e}\x{2066}-\x{2069}\x{feff}])/sprintf("\\u%04x", ord($1))/ge' test/names.test.ts
```
Expected: não imprime nada.

Confirmar que já não sobra nenhum:

```bash
perl -CSD -ne 'print "$.: $_" if /[\x{0300}-\x{036f}\x{00a0}\x{061c}\x{0080}-\x{009f}\x{200b}-\x{200f}\x{202a}-\x{202e}\x{2066}-\x{2069}\x{feff}]/' test/names.test.ts
```
Expected: não imprime nada.

Run: `npx vitest run test/names.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  13 passed (13)`.

- [ ] **Step 2: Mover `previewContentType` para `src/shared` (teste primeiro)**

O menu da interface só deve mostrar "Pré-visualizar" quando o servidor a aceita; para isso o browser e o Worker partilham a mesma função.

Criar `test/preview.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { previewContentType } from "../src/shared/preview";

describe("previewContentType", () => {
  it("devolve o tipo fixo das imagens e do PDF, sem distinguir maiúsculas", () => {
    expect(previewContentType("foto.png")).toBe("image/png");
    expect(previewContentType("FOTO.JPG")).toBe("image/jpeg");
    expect(previewContentType("a.jpeg")).toBe("image/jpeg");
    expect(previewContentType("a.gif")).toBe("image/gif");
    expect(previewContentType("a.webp")).toBe("image/webp");
    expect(previewContentType("relatório.final.pdf")).toBe("application/pdf");
  });

  it("recusa tudo o resto, incluindo nomes que parecem propriedades de objetos", () => {
    for (const name of ["a.svg", "b.html", "c.txt", "png", ".png", "d.png.exe", "e.constructor", "f.__proto__"]) {
      expect(previewContentType(name), name).toBeNull();
    }
  });
});
```

Run: `npx vitest run test/preview.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/shared/preview.ts`:

```ts
// Só estes tipos abrem dentro da app. SVG e HTML ficam de fora de propósito: executariam código no nosso domínio.
// Sem imports: serve o Worker (o Content-Type da resposta) e o browser (mostrar ou não "Pré-visualizar").
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
  const extension = name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(PREVIEW_TYPES, extension) ? PREVIEW_TYPES[extension] : null;
}
```

Em `src/worker/lib/files.ts`, apagar o bloco da pré-visualização (a constante `PREVIEW_TYPES` e a função `previewContentType`; o resto do ficheiro fica como está):

```ts
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
  const extension = name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(PREVIEW_TYPES, extension) ? PREVIEW_TYPES[extension] : null;
}
```

Em `src/worker/routes/files.ts`, nos `import` do topo, trocar:

```ts
import { searchKey } from "../../shared/names";
import type { FileItem } from "../../shared/types";
```

por:

```ts
import { searchKey } from "../../shared/names";
import { previewContentType } from "../../shared/preview";
import type { FileItem } from "../../shared/types";
```

No mesmo ficheiro, na lista de `import` de `../lib/files`, trocar:

```ts
  parseRange,
  previewContentType,
  r2KeyFor,
```

por:

```ts
  parseRange,
  r2KeyFor,
```

Run: `npx vitest run test/preview.test.ts test/files-download.test.ts`
Expected: `Test Files  2 passed (2)`, `Tests  23 passed (23)`.

- [ ] **Step 3: `GET /api/config` (teste primeiro)**

Criar `test/client-config.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { registerUser } from "./auth-helpers";
import { fetchWithEnv } from "./db-helpers";
import { api, buildRequest, resetDb } from "./helpers";

beforeEach(resetDb);

describe("GET /api/config", () => {
  it("exige sessão", async () => {
    expect((await api("/api/config")).status).toBe(401);
  });

  it("devolve o tamanho máximo de um ficheiro", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const res = await api("/api/config", { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ maxUploadBytes: 104_857_600 });
  });

  it("segue a variável MAX_UPLOAD_BYTES", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const res = await fetchWithEnv(buildRequest("/api/config", { cookie }), { MAX_UPLOAD_BYTES: "2048" });
    expect(await res.json()).toEqual({ maxUploadBytes: 2048 });
  });
});
```

Run: `npx vitest run test/client-config.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  3 failed (3)).

Acrescentar ao fim de `src/shared/types.ts`:

```ts
/** Limites do servidor que o browser precisa de conhecer (`GET /api/config`). */
export interface ClientConfig {
  /** Tamanho máximo de um ficheiro, em bytes. */
  maxUploadBytes: number;
}
```

Criar `src/worker/routes/config.ts`:

```ts
import type { ClientConfig } from "../../shared/types";
import { getConfig } from "../config";
import { createAuthedRouter } from "./authed";

export const clientConfig = createAuthedRouter();

/** Os limites que o browser precisa de conhecer (hoje só o tamanho máximo de um ficheiro). */
clientConfig.get("/", (c) =>
  c.json({ maxUploadBytes: getConfig(c.env).maxUploadBytes } satisfies ClientConfig),
);
```

Em `src/worker/app.ts`, nos `import`, trocar:

```ts
import { auth } from "./routes/auth";
```

por:

```ts
import { auth } from "./routes/auth";
import { clientConfig } from "./routes/config";
```

No mesmo ficheiro, trocar:

```ts
app.route("/api/auth", auth);
```

por:

```ts
app.route("/api/auth", auth);
app.route("/api/config", clientConfig);
```

Run: `npx vitest run test/client-config.test.ts test/authz.test.ts`
Expected: `Test Files  2 passed (2)`, `Tests  5 passed (5)` (a varredura de `test/authz.test.ts` apanha a rota nova e confirma o 401).

- [ ] **Step 4: Limite de profundidade das pastas: 100 níveis (teste primeiro)**

As consultas recursivas já têm um tecto de 1000 níveis, mas mover uma pasta para uma zona mais funda do que isso dava `invalid_move` com uma mensagem enganadora. Passa a haver um limite visível de 100 níveis ao criar e ao mover; o `400 folder_too_deep` diz isso mesmo. A verificação é separada da escrita: dois pedidos em paralelo podem passar o limite por poucos níveis, o que é inofensivo (o tecto de 1000 continua a proteger as consultas).

Criar `test/folders-depth.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { registerUser } from "./auth-helpers";
import { createFolder } from "./folder-helpers";
import { api, resetDb } from "./helpers";

beforeEach(resetDb);

/** Cria `depth` pastas encadeadas (a 1.ª na raiz) diretamente na D1, que é bem mais rápido do que pela API. */
async function insertChain(userId: string, prefix: string, depth: number, parentId: string | null = null) {
  const ids: string[] = [];
  let parent = parentId;
  const statements = [];
  for (let level = 1; level <= depth; level++) {
    const id = `${prefix}-${level}`;
    statements.push(
      env.DB.prepare(
        "INSERT INTO folders (id, user_id, parent_id, name, name_norm, created_at) VALUES (?1, ?2, ?3, ?4, ?4, 0)",
      ).bind(id, userId, parent, id),
    );
    ids.push(id);
    parent = id;
  }
  await env.DB.batch(statements);
  return ids;
}

const post = (cookie: string, name: string, parentId: string | null) =>
  api("/api/folders", { method: "POST", cookie, json: { name, parentId } });
const patch = (cookie: string, id: string, json: unknown) =>
  api(`/api/folders/${id}`, { method: "PATCH", cookie, json });

describe("profundidade máxima das pastas (100 níveis)", () => {
  it("deixa criar até ao nível 100 e recusa o 101", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const chain = await insertChain(user.id, "n", 99);
    expect((await post(cookie, "nivel-100", chain[98])).status).toBe(201);

    const tooDeep = await insertChain(user.id, "m", 100);
    const res = await post(cookie, "nivel-101", tooDeep[99]);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "folder_too_deep",
      message: expect.stringContaining("100"),
    });
  });

  it("ao mover conta a profundidade da pasta com tudo o que tem dentro", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const chain = await insertChain(user.id, "n", 98); // a última está no nível 98
    const moved = await createFolder(cookie, "movida");
    const child = await createFolder(cookie, "filha", moved.id);
    await createFolder(cookie, "neta", child.id); // a pasta movida tem 3 níveis

    // por baixo do nível 98 ficariam nos níveis 99, 100 e 101: não cabe
    const res = await patch(cookie, moved.id, { parentId: chain[97] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "folder_too_deep" });
    // por baixo do nível 97 ficam nos níveis 98, 99 e 100: cabe
    expect((await patch(cookie, moved.id, { parentId: chain[96] })).status).toBe(200);
  });

  it("mover para a raiz nunca é recusado por causa da profundidade", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const chain = await insertChain(user.id, "n", 100);
    expect((await patch(cookie, chain[99], { parentId: null })).status).toBe(200);
  });
});
```

Run: `npx vitest run test/folders-depth.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  2 failed | 1 passed (3)).

Acrescentar ao fim de `src/worker/lib/folders.ts`:

```ts
/** Profundidade máxima das pastas do utilizador (as da raiz estão no nível 1). */
export const MAX_NESTING = 100;

/** Número de níveis de uma pasta contando com as suas descendentes (1 = sem subpastas). */
async function subtreeHeight(db: D1Database, userId: string, folderId: string): Promise<number> {
  const row = await db
    .prepare(
      `WITH RECURSIVE sub(id, depth) AS (
         SELECT id, 1 FROM folders WHERE id = ?1 AND user_id = ?2
         UNION ALL
         SELECT f.id, s.depth + 1 FROM folders f JOIN sub s ON f.parent_id = s.id
         WHERE f.user_id = ?2 AND s.depth < ${MAX_FOLDER_DEPTH}
       )
       SELECT MAX(depth) AS height FROM sub`,
    )
    .bind(folderId, userId)
    .first<{ height: number | null }>();
  return row?.height ?? 1;
}

/**
 * Garante que uma pasta nova (ou, com `movingFolderId`, a pasta movida com tudo o que tem dentro) cabe por baixo
 * de `parentId` sem passar de `MAX_NESTING` níveis. A raiz (`null`) nunca é recusada. É uma verificação à parte
 * da escrita: dois pedidos em paralelo podem passar o limite por poucos níveis.
 */
export async function assertFitsBelow(
  db: D1Database,
  userId: string,
  parentId: string | null,
  movingFolderId?: string,
): Promise<void> {
  if (parentId === null) return;
  const height = movingFolderId === undefined ? 1 : await subtreeHeight(db, userId, movingFolderId);
  const depth = (await breadcrumbFor(db, userId, parentId)).length;
  if (depth + height > MAX_NESTING) {
    throw new ApiError(400, "folder_too_deep", `As pastas não podem ter mais de ${MAX_NESTING} níveis de profundidade.`);
  }
}
```

Em `src/worker/routes/folders.ts`, na lista de `import` de `../lib/folders`, trocar:

```ts
import {
  breadcrumbFor,
```

por:

```ts
import {
  assertFitsBelow,
  breadcrumbFor,
```

No `POST /` (criar pasta), trocar:

```ts
  if (parentId !== null) await requireFolder(db, userId, parentId);

  const id = crypto.randomUUID();
```

por:

```ts
  if (parentId !== null) {
    await requireFolder(db, userId, parentId);
    await assertFitsBelow(db, userId, parentId);
  }

  const id = crypto.randomUUID();
```

No `PATCH /:id`, trocar:

```ts
    if (await wouldCreateCycle(db, userId, folder.id, parentId)) throw invalidMove;
  }
```

por:

```ts
    if (await wouldCreateCycle(db, userId, folder.id, parentId)) throw invalidMove;
    await assertFitsBelow(db, userId, parentId, folder.id);
  }
```

Um ciclo já gravado na base (só possível por SQL direto, a API nunca o cria) é uma cadeia sem fim: o teste `test/folders-races.test.ts` que o simula passa a receber `folder_too_deep` em vez de `invalid_move`, porque o limite de profundidade responde antes do `UPDATE`. O que o teste garante (a base não bloqueia e o pedido termina com 400) mantém-se; a guarda do `UPDATE` continua a proteger contra corridas.

Em `test/folders-races.test.ts`, no teste do ciclo já gravado, trocar:

```ts
    expect(await move.json()).toMatchObject({ error: "invalid_move" });
    expect((await getContents(cookie)).folders.map((f) => f.name)).toEqual(["C"]);
```

por:

```ts
    // O ciclo vê-se como uma cadeia sem fim: o limite de profundidade responde antes do UPDATE.
    expect(await move.json()).toMatchObject({ error: "folder_too_deep" });
    expect((await getContents(cookie)).folders.map((f) => f.name)).toEqual(["C"]);
```

Run:

```bash
npx vitest run test/folders-depth.test.ts test/folders-manage.test.ts test/folders.test.ts test/folders-races.test.ts
```
Expected: `Test Files  4 passed (4)`, `Tests  44 passed (44)`.

- [ ] **Step 5: Um 409 de ficheiro pode vir de um envio em curso: dizê-lo na mensagem (teste primeiro)**

Uma linha `pending` (envio ainda a decorrer) ocupa o nome mas não aparece na lista; sem uma pista o utilizador vê "já existe" e não encontra o ficheiro.

Em `test/files-upload.test.ts`, no teste do nome repetido, trocar:

```ts
    expect(await dup.json()).toMatchObject({ error: "name_taken" });
    expect(await usedBytes(cookie)).toBe(5);
```

por:

```ts
    expect(await dup.json()).toMatchObject({
      error: "name_taken",
      message: expect.stringContaining("em curso"),
    });
    expect(await usedBytes(cookie)).toBe(5);
```

Run: `npx vitest run test/files-upload.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  1 failed | 24 passed (25)).

Em `src/worker/routes/files.ts`, nas duas mensagens do `name_taken` (upload e `PATCH`), trocar `"Já existe um ficheiro com esse nome neste local."` por `"Já existe um ficheiro com esse nome neste local (pode ser um envio ainda em curso)."`.

Run: `npx vitest run test/files-upload.test.ts test/files-manage.test.ts`
Expected: `Test Files  2 passed (2)`, `Tests  43 passed (43)`.

- [ ] **Step 6: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  24 passed (24)`, `Tests  207 passed (207)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src test
git commit -m "Expõe GET /api/config, partilha a pré-visualização, limita a profundidade das pastas e usa escapes nos testes de nomes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Testes de interface (jsdom) e `apiFetch` mais robusto

**Files:**
- Create: `vitest.web.config.ts`, `src/web/test/setup.ts`, `src/web/test/mock-api.ts`, `src/web/test/render.tsx`
- Create: `src/web/query-client.ts`, `src/web/api.test.ts`, `src/web/query-client.test.ts`, `src/web/auth.test.tsx`
- Modify: `package.json` (+ `package-lock.json`), `vitest.config.ts`, `tsconfig.node.json`, `src/web/api.ts`, `src/web/main.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `ApiRequestError`, `useMe`, `ME_KEY` (Plano 1).
- Produces: `npm run test:web` (Vitest em jsdom, só `src/web/**/*.test.{ts,tsx}`) e `npm run test:worker`; `npm test` corre os dois.
  `src/web/test/mock-api.ts`: `mockApi(routes)` (fetch falso com rotas "MÉTODO /caminho/:param"), `json`, `apiError`, `noContent`, `ME`, `SESSION`.
  `src/web/test/render.tsx`: `testQueryClient()`, `queryWrapper(client)`.
  `src/web/api.ts`: `apiFetch` (falha de rede → `ApiRequestError(0, "network_error", ...)`), `errorMessage(error)`, `fallbackMessage(status)`,
  `errorFromResponse(status, data)`, `networkError()`, `setUnauthorizedHandler(fn | null)`, `NETWORK_ERROR_MESSAGE`.
  `src/web/query-client.ts`: `createQueryClient()` (um 401 `unauthorized` esquece os dados e põe `["me"]` a `null`) e `shouldRetry`.

- [ ] **Step 1: Instalar as bibliotecas de teste de interface e configurar o Vitest em jsdom**

Os testes atuais correm no `workerd`, que não tem DOM. Os da interface correm numa segunda configuração do Vitest, em `jsdom`, com o Testing Library; cada configuração só apanha os seus ficheiros.

Run:

```bash
npm install -D jsdom@^30 @testing-library/react@^16 @testing-library/dom@^10 @testing-library/user-event@^14 @testing-library/jest-dom@^7
```
Expected: `added N packages` (os avisos `allow-scripts` são inofensivos).

Criar `vitest.web.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Testes da interface: correm em jsdom (os do Worker correm no workerd, ver vitest.config.ts).
export default defineConfig({
  plugins: [react()],
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/web/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/web/test/setup.ts"],
  },
});
```

Em `vitest.config.ts`, para esta configuração só apanhar os testes do Worker, trocar:

```ts
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
```

por:

```ts
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
```

Em `tsconfig.node.json`, trocar:

```json
"include": ["vite.config.ts", "vitest.config.ts", "scripts"]
```

por:

```json
"include": ["vite.config.ts", "vitest.config.ts", "vitest.web.config.ts", "scripts"]
```

Em `package.json`, nos `scripts`, trocar:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

por:

```json
    "test": "npm run test:worker && npm run test:web",
    "test:worker": "vitest run",
    "test:web": "vitest run -c vitest.web.config.ts",
    "test:watch": "vitest",
```

Criar `src/web/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
```

Criar `src/web/test/mock-api.ts`:

```ts
import { vi } from "vitest";
import type { PublicUser } from "../../shared/types";

export interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  /** Os `:segmentos` da rota que casou. */
  params: Record<string, string>;
  /** O corpo JSON do pedido; `undefined` se não havia corpo. */
  body: unknown;
  /** A chave da rota que casou (ex.: "PATCH /api/files/:id"), ou null se nenhuma casou. */
  route: string | null;
}

type Handler = (request: MockRequest) => Response | Promise<Response>;

export const json = (data: unknown, status = 200): Response => Response.json(data, { status });
export const apiError = (status: number, error: string, message: string): Response =>
  Response.json({ error, message }, { status });
export const noContent = (): Response => new Response(null, { status: 204 });

export const ME: PublicUser = {
  id: "u1",
  email: "ana@example.com",
  role: "user",
  quotaBytes: 1_073_741_824,
  usedBytes: 0,
};

/** A rota de sessão que quase todos os testes de páginas precisam. */
export const SESSION = { "GET /api/auth/me": () => json({ user: ME }) };

/**
 * Substitui o `fetch` global por um servidor falso: `routes` mapeia "MÉTODO /caminho/:param" para uma função
 * que devolve a resposta. Um pedido sem rota recebe 404 (e fica em `calls` com `route: null`).
 */
export function mockApi(routes: Record<string, Handler>) {
  const compiled = Object.entries(routes).map(([key, handler]) => {
    const [method, pattern] = key.split(" ");
    const names: string[] = [];
    const source = pattern.replace(/:(\w+)/g, (_match, name: string) => {
      names.push(name);
      return "([^/]+)";
    });
    return { key, method, regex: new RegExp(`^${source}$`), names, handler };
  });
  const calls: MockRequest[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const match = compiled.find((route) => route.method === method && route.regex.test(url.pathname));
      const params: Record<string, string> = {};
      match?.regex.exec(url.pathname)?.slice(1).forEach((value, index) => {
        params[match.names[index]] = decodeURIComponent(value);
      });
      const request: MockRequest = { method, path: url.pathname, query: url.searchParams, params, body, route: match?.key ?? null };
      calls.push(request);
      if (!match) return apiError(404, "not_found", `Sem rota no mock: ${method} ${url.pathname}`);
      return match.handler(request);
    }),
  );

  return {
    calls,
    /** Os pedidos que casaram com a rota indicada (a mesma chave que se deu em `routes`). */
    callsTo: (key: string) => calls.filter((call) => call.route === key),
  };
}
```

O primeiro teste de interface descreve o comportamento atual do `apiFetch` (ainda sem as melhorias do passo seguinte) e serve de prova de que o ambiente funciona.

Criar `src/web/api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiRequestError, apiFetch } from "./api";
import { apiError, json, mockApi, noContent } from "./test/mock-api";

describe("apiFetch", () => {
  it("devolve o JSON da resposta e envia o corpo como JSON", async () => {
    const server = mockApi({
      "POST /api/folders": ({ body }) => json({ folder: { id: "f1", echo: body } }, 201),
    });
    const data = await apiFetch<{ folder: { id: string; echo: unknown } }>("/api/folders", {
      method: "POST",
      json: { name: "Fotos" },
    });
    expect(data.folder).toEqual({ id: "f1", echo: { name: "Fotos" } });
    expect(server.callsTo("POST /api/folders")).toHaveLength(1);
  });

  it("devolve undefined quando a resposta é 204", async () => {
    mockApi({ "DELETE /api/files/:id": () => noContent() });
    await expect(apiFetch("/api/files/f1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("lança ApiRequestError com o código e a mensagem em português da API", async () => {
    mockApi({
      "GET /api/x": () => apiError(409, "name_taken", "Já existe uma pasta com esse nome neste local."),
    });
    const failure = apiFetch("/api/x");
    await expect(failure).rejects.toBeInstanceOf(ApiRequestError);
    await expect(failure).rejects.toMatchObject({
      status: 409,
      code: "name_taken",
      message: "Já existe uma pasta com esse nome neste local.",
    });
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  1 passed (1)`, `Tests  3 passed (3)`.

Run: `npx vitest run`
Expected: `Test Files  24 passed (24)`, `Tests  207 passed (207)` (os testes do Worker não mudam: a configuração do Worker já não apanha `src/web`).

- [ ] **Step 2: Falha de rede, mensagens de recurso e sessão expirada no `apiFetch` (testes primeiro)**

Hoje uma falha de rede aparece ao utilizador como "Failed to fetch"; uma resposta de erro que não é JSON (o 413 da própria Cloudflare, um 502) dá uma mensagem genérica sem sentido; e, quando a sessão expira a meio do uso, cada ecrã mostra o seu erro em vez de voltar ao login. O `apiFetch` passa a tratar disto num só sítio.

Em `src/web/api.test.ts`, substituir o bloco de `import` no topo do ficheiro (todas as linhas de `import`, até à linha em branco) por:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  apiFetch,
  errorMessage,
  NETWORK_ERROR_MESSAGE,
  setUnauthorizedHandler,
} from "./api";
import { apiError, json, mockApi, noContent } from "./test/mock-api";
```

Acrescentar ao fim de `src/web/api.test.ts`:

```ts
describe("apiFetch: erros sem o JSON da API", () => {
  it.each([
    [413, "O ficheiro é demasiado grande."],
    [502, "Erro do servidor. Tente novamente dentro de instantes."],
    [400, "Ocorreu um erro. Tente novamente."],
  ])("o estado %i usa a mensagem de recurso", async (status, message) => {
    mockApi({ "GET /api/x": () => new Response("<html>erro</html>", { status }) });
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ status, code: "unknown_error", message });
  });

  it("converte uma falha de rede numa mensagem em português (e não em 'Failed to fetch')", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(apiFetch("/api/x")).rejects.toMatchObject({
      status: 0,
      code: "network_error",
      message: NETWORK_ERROR_MESSAGE,
    });
  });
});

describe("sessão expirada", () => {
  it("avisa o handler num 401 `unauthorized`, mas não noutros 401", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockApi({
      "GET /api/a": () => apiError(401, "unauthorized", "Sessão inválida ou expirada."),
      "POST /api/auth/login": () => apiError(401, "invalid_credentials", "Email ou senha inválidos."),
    });
    await expect(apiFetch("/api/a")).rejects.toMatchObject({ code: "unauthorized" });
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(apiFetch("/api/auth/login", { method: "POST", json: {} })).rejects.toMatchObject({
      code: "invalid_credentials",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("errorMessage", () => {
  it("usa a mensagem do erro, ou uma genérica se o valor não for um erro", () => {
    expect(errorMessage(new ApiRequestError(409, "name_taken", "Nome repetido."))).toBe("Nome repetido.");
    expect(errorMessage("estranho")).toBe("Ocorreu um erro. Tente novamente.");
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/api.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  5 failed | 4 passed (9)).

Substituir o conteúdo de `src/web/api.ts`:

```ts
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const NETWORK_ERROR_MESSAGE = "Sem ligação ao servidor. Verifique a internet e tente novamente.";

/** Mensagem para uma resposta de erro sem o JSON da API (ex.: o 413 da própria Cloudflare ou um 502). */
export function fallbackMessage(status: number): string {
  if (status === 413) return "O ficheiro é demasiado grande.";
  if (status >= 500) return "Erro do servidor. Tente novamente dentro de instantes.";
  return "Ocorreu um erro. Tente novamente.";
}

let onUnauthorized: (() => void) | null = null;

/** Regista o que fazer quando a sessão deixa de valer (resposta 401 `unauthorized`); ver `createQueryClient`. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** O erro de uma resposta falhada; `data` é o JSON da resposta (ou null). Avisa o handler se a sessão expirou. */
export function errorFromResponse(status: number, data: unknown): ApiRequestError {
  const body = (data ?? {}) as { error?: unknown; message?: unknown };
  const code = typeof body.error === "string" ? body.error : "unknown_error";
  const message = typeof body.message === "string" ? body.message : fallbackMessage(status);
  if (code === "unauthorized") onUnauthorized?.();
  return new ApiRequestError(status, code, message);
}

export function networkError(): ApiRequestError {
  return new ApiRequestError(0, "network_error", NETWORK_ERROR_MESSAGE);
}

/** Texto para mostrar ao utilizador a partir de qualquer erro apanhado (as mutações guardam-no como `unknown`). */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : fallbackMessage(0);
}

interface RequestOptions {
  method?: string;
  json?: unknown;
}

/** Chama a API. Devolve o JSON da resposta, `undefined` em 204, e lança `ApiRequestError` em erros. */
export async function apiFetch<T = void>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body,
      credentials: "same-origin",
    });
  } catch {
    throw networkError();
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw errorFromResponse(response.status, data);
  return data as T;
}
```

Substituir o conteúdo de `src/web/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { setUnauthorizedHandler } from "../api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});
```

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  1 passed (1)`, `Tests  9 passed (9)`.

- [ ] **Step 3: `createQueryClient`: repetir só o que vale a pena e voltar ao login quando a sessão expira (teste primeiro)**

Criar `src/web/query-client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiRequestError, apiFetch, networkError } from "./api";
import { ME_KEY } from "./auth";
import { createQueryClient, shouldRetry } from "./query-client";
import { apiError, ME, mockApi } from "./test/mock-api";

describe("shouldRetry", () => {
  it("repete falhas de rede e erros 5xx até duas vezes", () => {
    for (const error of [networkError(), new ApiRequestError(502, "unknown_error", "x")]) {
      expect(shouldRetry(0, error)).toBe(true);
      expect(shouldRetry(1, error)).toBe(true);
      expect(shouldRetry(2, error)).toBe(false);
    }
  });

  it("não repete erros 4xx (um 404 ou um 409 não se resolvem a repetir)", () => {
    expect(shouldRetry(0, new ApiRequestError(404, "folder_not_found", "x"))).toBe(false);
    expect(shouldRetry(0, new ApiRequestError(409, "name_taken", "x"))).toBe(false);
  });
});

describe("createQueryClient", () => {
  it("num 401 `unauthorized` esquece as consultas da conta e põe a sessão a null", async () => {
    const client = createQueryClient();
    client.setQueryData(ME_KEY, ME);
    client.setQueryData(["folder", "root"], { folders: [], files: [] });
    mockApi({ "GET /api/folders/tree": () => apiError(401, "unauthorized", "Sessão inválida ou expirada.") });

    await expect(apiFetch("/api/folders/tree")).rejects.toBeInstanceOf(ApiRequestError);

    expect(client.getQueryData(ME_KEY)).toBeNull();
    expect(client.getQueryData(["folder", "root"])).toBeUndefined();
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/query-client.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/query-client.ts`:

```ts
import { QueryClient } from "@tanstack/react-query";
import { ApiRequestError, setUnauthorizedHandler } from "./api";
import { ME_KEY } from "./auth";

/** Repete só falhas de rede e erros 5xx, no máximo duas vezes: um 404 ou um 409 não se resolvem a repetir. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const clientError = error instanceof ApiRequestError && error.status >= 400 && error.status < 500;
  return failureCount < 2 && !clientError;
}

export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: shouldRetry } },
  });
  // Sessão expirada (401 `unauthorized` em qualquer pedido): esquece os dados da conta e deixa o layout
  // redirecionar para o login (o AppLayout vê `me === null`).
  setUnauthorizedHandler(() => {
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] });
    client.setQueryData(ME_KEY, null);
  });
  return client;
}
```

Substituir o conteúdo de `src/web/main.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import "./index.css";
import { createQueryClient } from "./query-client";

const queryClient = createQueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
```

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  2 passed (2)`, `Tests  12 passed (12)`.

- [ ] **Step 4: Testes do contrato de `useMe`**

Criar `src/web/test/render.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createQueryClient } from "../query-client";

/** Cliente de consultas para testes: o de produção, mas sem repetições (os erros aparecem logo). */
export function testQueryClient(): QueryClient {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } });
  return client;
}

/** `wrapper` para `renderHook`. */
export function queryWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
```

Criar `src/web/auth.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NETWORK_ERROR_MESSAGE } from "./api";
import { useMe } from "./auth";
import { apiError, json, ME, mockApi } from "./test/mock-api";
import { queryWrapper, testQueryClient } from "./test/render";

function renderMe() {
  return renderHook(() => useMe(), { wrapper: queryWrapper(testQueryClient()) });
}

describe("useMe", () => {
  it("devolve o utilizador da sessão", async () => {
    mockApi({ "GET /api/auth/me": () => json({ user: ME }) });
    const { result } = renderMe();
    await waitFor(() => expect(result.current.data).toEqual(ME));
  });

  it("devolve null quando não há sessão (401)", async () => {
    mockApi({ "GET /api/auth/me": () => apiError(401, "unauthorized", "Sessão inválida ou expirada.") });
    const { result } = renderMe();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("falha com a mensagem da API quando o servidor dá erro", async () => {
    mockApi({ "GET /api/auth/me": () => apiError(500, "internal_error", "Erro interno do servidor.") });
    const { result } = renderMe();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Erro interno do servidor.");
  });

  it("falha por falha de rede com a mensagem de ligação", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { result } = renderMe();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(NETWORK_ERROR_MESSAGE);
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  3 passed (3)`, `Tests  16 passed (16)`.

- [ ] **Step 5: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  24 passed (24)`, `Tests  207 passed (207)`.

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  3 passed (3)`, `Tests  16 passed (16)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npm run build`
Expected: `✓ built in ...` duas vezes (Worker e cliente).

Commit:

```bash
git add package.json package-lock.json vitest.config.ts vitest.web.config.ts tsconfig.node.json src
git commit -m "Acrescenta testes de interface em jsdom e torna o apiFetch robusto a falhas de rede e sessões expiradas" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Dados da interface: data legível, árvore de pastas, consultas e mutações

**Files:**
- Create: `src/web/tree.ts`, `src/web/tree.test.ts`, `src/web/space.ts`, `src/web/space.test.tsx`
- Modify: `src/shared/format.ts`, `test/format.test.ts`

**Interfaces:**
- Consumes: `apiFetch` (Task 2), `ME_KEY` (`src/web/auth.ts`), `mockApi`/`queryWrapper`/`testQueryClient` (Task 2), os tipos de `src/shared/types.ts`.
- Produces: `formatDate(timestamp)` em `src/shared/format.ts`.
  `src/web/tree.ts`: `ROOT_LABEL`, `FolderOption { id: string | null; name; depth }`, `folderOptions(folders)`, `subtreeIds(folders, id)`.
  `src/web/space.ts`: `folderKey(id | null)`, `TREE_KEY`, `CONFIG_KEY`, `useContents(folderId | null)`, `useTree()`, `useConfig()`, `useRefreshSpace()`,
  e as mutações `useCreateFolder`, `useUpdateFolder`, `useDeleteFolder`, `useUpdateFile`, `useDeleteFile` (todas atualizam listagens, árvore e quota ao terminar).

- [ ] **Step 1: `formatDate` (teste primeiro)**

Em `test/format.test.ts`, substituir o bloco de `import` no topo do ficheiro (todas as linhas de `import`, até à linha em branco) por:

```ts
import { describe, expect, it } from "vitest";
import { formatBytes, formatDate } from "../src/shared/format";
```

Acrescentar ao fim de `test/format.test.ts`:

```ts
describe("formatDate", () => {
  it("formata a data em português, no fuso do utilizador", () => {
    expect(formatDate(new Date(2026, 9, 3, 12).getTime())).toBe("03/10/2026");
    expect(formatDate(new Date(2027, 0, 5, 23, 59).getTime())).toBe("05/01/2027");
  });
});
```

Run: `npx vitest run test/format.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  1 failed | 4 passed (5)).

Acrescentar ao fim de `src/shared/format.ts`:

```ts
const dateFormat = new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Data legível (ex.: "03/10/2026") a partir de milissegundos Unix, no fuso do utilizador. */
export function formatDate(timestamp: number): string {
  return dateFormat.format(timestamp);
}
```

Run: `npx vitest run test/format.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  5 passed (5)`.

- [ ] **Step 2: Árvore de pastas para o diálogo "Mover" (teste primeiro)**

Criar `src/web/tree.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { FolderItem } from "../shared/types";
import { folderOptions, ROOT_LABEL, subtreeIds } from "./tree";

const folder = (id: string, name: string, parentId: string | null): FolderItem => ({ id, name, parentId, createdAt: 0 });

// Fotos > Férias > Praia; Fotos > Natal; Docs (a API manda-as por nome)
const FOLDERS = [
  folder("docs", "Docs", null),
  folder("fotos", "Fotos", null),
  folder("ferias", "Férias", "fotos"),
  folder("natal", "Natal", "fotos"),
  folder("praia", "Praia", "ferias"),
];

describe("folderOptions", () => {
  it("lista a raiz e as pastas em pré-ordem, com o recuo de cada uma", () => {
    expect(folderOptions(FOLDERS)).toEqual([
      { id: null, name: ROOT_LABEL, depth: 0 },
      { id: "docs", name: "Docs", depth: 1 },
      { id: "fotos", name: "Fotos", depth: 1 },
      { id: "ferias", name: "Férias", depth: 2 },
      { id: "praia", name: "Praia", depth: 3 },
      { id: "natal", name: "Natal", depth: 2 },
    ]);
  });

  it("só tem a raiz quando não há pastas", () => {
    expect(folderOptions([])).toEqual([{ id: null, name: ROOT_LABEL, depth: 0 }]);
  });

  it("não fica preso num ciclo", () => {
    const options = folderOptions([folder("a", "A", "b"), folder("b", "B", "a")]);
    expect(options).toEqual([{ id: null, name: ROOT_LABEL, depth: 0 }]); // nenhuma chega à raiz
  });
});

describe("subtreeIds", () => {
  it("inclui a própria pasta e todas as descendentes", () => {
    expect([...subtreeIds(FOLDERS, "fotos")].sort()).toEqual(["ferias", "fotos", "natal", "praia"]);
    expect([...subtreeIds(FOLDERS, "praia")]).toEqual(["praia"]);
  });

  it("termina mesmo com um ciclo", () => {
    const cyclic = [folder("a", "A", "b"), folder("b", "B", "a")];
    expect([...subtreeIds(cyclic, "a")].sort()).toEqual(["a", "b"]);
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/tree.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/tree.ts`:

```ts
import type { FolderItem } from "../shared/types";

export const ROOT_LABEL = "Meu espaço";

/** Uma linha do seletor de pastas: a raiz (`id: null`) ou uma pasta, com o nível de recuo. */
export interface FolderOption {
  id: string | null;
  name: string;
  depth: number;
}

function childrenByParent(folders: FolderItem[]): Map<string | null, FolderItem[]> {
  const children = new Map<string | null, FolderItem[]>();
  for (const folder of folders) {
    const siblings = children.get(folder.parentId);
    if (siblings) siblings.push(folder);
    else children.set(folder.parentId, [folder]);
  }
  return children;
}

/** O id da pasta e os de todas as suas descendentes (as pastas que não podem ser o destino de um movimento dela). */
export function subtreeIds(folders: FolderItem[], folderId: string): Set<string> {
  const children = childrenByParent(folders);
  const found = new Set<string>();
  const pending = [folderId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (found.has(id)) continue; // protege contra um ciclo
    found.add(id);
    for (const child of children.get(id) ?? []) pending.push(child.id);
  }
  return found;
}

/**
 * A raiz seguida de todas as pastas em pré-ordem (cada pasta antes das suas subpastas), cada uma com o seu nível.
 * A ordem entre irmãs é a da lista recebida (a API já a manda por nome, sem acentos).
 */
export function folderOptions(folders: FolderItem[]): FolderOption[] {
  const children = childrenByParent(folders);
  const options: FolderOption[] = [{ id: null, name: ROOT_LABEL, depth: 0 }];
  const seen = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of children.get(parentId) ?? []) {
      if (seen.has(folder.id)) continue; // protege contra um ciclo
      seen.add(folder.id);
      options.push({ id: folder.id, name: folder.name, depth });
      visit(folder.id, depth + 1);
    }
  };
  visit(null, 1);
  return options;
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/tree.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  5 passed (5)`.

- [ ] **Step 3: Consultas e mutações (teste primeiro)**

Todas as mutações invalidam, ao terminar (com êxito ou não), a listagem das pastas, a árvore e o utilizador (a barra de quota). Assim nenhum ecrã precisa de se lembrar de atualizar o resto.

Criar `src/web/space.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { FolderContents } from "../shared/types";
import { useMe } from "./auth";
import { useConfig, useContents, useCreateFolder, useDeleteFile, useTree, useUpdateFolder } from "./space";
import { apiError, json, ME, mockApi, noContent } from "./test/mock-api";
import { queryWrapper, testQueryClient } from "./test/render";

const EMPTY: FolderContents = { folder: null, breadcrumb: [], folders: [], files: [] };

describe("consultas", () => {
  it("useContents pede a raiz como `root` e as pastas pelo id", async () => {
    const server = mockApi({ "GET /api/folders/:id/contents": () => json(EMPTY) });
    const wrapper = queryWrapper(testQueryClient());
    const root = renderHook(() => useContents(null), { wrapper });
    const inner = renderHook(() => useContents("abc"), { wrapper });
    await waitFor(() => expect(root.result.current.data).toEqual(EMPTY));
    await waitFor(() => expect(inner.result.current.data).toEqual(EMPTY));
    expect(server.calls.map((call) => call.path).sort()).toEqual([
      "/api/folders/abc/contents",
      "/api/folders/root/contents",
    ]);
  });

  it("useTree devolve a lista de pastas e useConfig os limites", async () => {
    const folders = [{ id: "a", name: "A", parentId: null, createdAt: 1 }];
    mockApi({
      "GET /api/folders/tree": () => json({ folders }),
      "GET /api/config": () => json({ maxUploadBytes: 1024 }),
    });
    const wrapper = queryWrapper(testQueryClient());
    const tree = renderHook(() => useTree(), { wrapper });
    const config = renderHook(() => useConfig(), { wrapper });
    await waitFor(() => expect(tree.result.current.data).toEqual(folders));
    await waitFor(() => expect(config.result.current.data).toEqual({ maxUploadBytes: 1024 }));
  });
});

describe("mutações", () => {
  it("criar uma pasta envia o corpo certo e atualiza a listagem, a árvore e a quota", async () => {
    let created = false;
    const server = mockApi({
      "GET /api/folders/:id/contents": () =>
        json({ ...EMPTY, folders: created ? [{ id: "n", name: "Nova", parentId: null, createdAt: 1 }] : [] }),
      "GET /api/folders/tree": () => json({ folders: [] }),
      "GET /api/auth/me": () => json({ user: { ...ME, usedBytes: created ? 10 : 0 } }),
      "POST /api/folders": () => {
        created = true;
        return json({ folder: { id: "n", name: "Nova", parentId: null, createdAt: 1 } }, 201);
      },
    });
    const { result } = renderHook(
      () => ({ contents: useContents(null), tree: useTree(), me: useMe(), create: useCreateFolder() }),
      { wrapper: queryWrapper(testQueryClient()) },
    );
    await waitFor(() => expect(result.current.contents.data?.folders).toEqual([]));
    await waitFor(() => expect(result.current.me.data?.usedBytes).toBe(0));
    await waitFor(() => expect(result.current.tree.isSuccess).toBe(true));

    await act(() => result.current.create.mutateAsync({ name: "Nova", parentId: null }));

    expect(server.callsTo("POST /api/folders")[0].body).toEqual({ name: "Nova", parentId: null });
    await waitFor(() => expect(result.current.contents.data?.folders).toHaveLength(1));
    await waitFor(() => expect(result.current.me.data?.usedBytes).toBe(10));
    await waitFor(() => expect(server.callsTo("GET /api/folders/tree")).toHaveLength(2));
  });

  it("também atualiza quando a mutação falha (os dados podem estar velhos)", async () => {
    const server = mockApi({
      "GET /api/folders/:id/contents": () => json(EMPTY),
      "PATCH /api/folders/:id": () => apiError(404, "folder_not_found", "Pasta não encontrada."),
    });
    const wrapper = queryWrapper(testQueryClient());
    const contents = renderHook(() => useContents(null), { wrapper });
    const update = renderHook(() => useUpdateFolder(), { wrapper });
    await waitFor(() => expect(contents.result.current.isSuccess).toBe(true));

    await act(async () => {
      await update.result.current.mutateAsync({ id: "x", name: "Y" }).catch(() => undefined);
    });

    await waitFor(() => expect(update.result.current.error?.message).toBe("Pasta não encontrada."));
    await waitFor(() => expect(server.callsTo("GET /api/folders/:id/contents")).toHaveLength(2));
  });

  it("excluir um ficheiro usa DELETE e o id codificado", async () => {
    const server = mockApi({ "DELETE /api/files/:id": () => noContent() });
    const { result } = renderHook(() => useDeleteFile(), { wrapper: queryWrapper(testQueryClient()) });
    await act(() => result.current.mutateAsync("a b"));
    expect(server.calls[0]).toMatchObject({ method: "DELETE", path: "/api/files/a%20b" });
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/space.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/space.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClientConfig, FileItem, FolderContents, FolderItem } from "../shared/types";
import { apiFetch } from "./api";
import { ME_KEY } from "./auth";

const FOLDER = "folder";

/** Chave da listagem de uma pasta (`null` = a raiz). */
export const folderKey = (folderId: string | null) => [FOLDER, folderId ?? "root"] as const;
export const TREE_KEY = ["tree"] as const;
export const CONFIG_KEY = ["config"] as const;

export function useContents(folderId: string | null) {
  return useQuery({
    queryKey: folderKey(folderId),
    queryFn: () => apiFetch<FolderContents>(`/api/folders/${encodeURIComponent(folderId ?? "root")}/contents`),
  });
}

/** Todas as pastas do utilizador, para o diálogo "Mover". */
export function useTree() {
  return useQuery({
    queryKey: TREE_KEY,
    queryFn: async () => (await apiFetch<{ folders: FolderItem[] }>("/api/folders/tree")).folders,
  });
}

/** Os limites do servidor (não mudam durante a sessão). */
export function useConfig() {
  return useQuery({
    queryKey: CONFIG_KEY,
    queryFn: () => apiFetch<ClientConfig>("/api/config"),
    staleTime: Infinity,
  });
}

/**
 * Depois de qualquer alteração ao espaço: as pastas listadas, a árvore do diálogo "Mover" e a quota usada
 * (barra lateral) ficam desatualizadas. Devolve a função que as invalida.
 */
export function useRefreshSpace() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [FOLDER] }),
      queryClient.invalidateQueries({ queryKey: TREE_KEY }),
      queryClient.invalidateQueries({ queryKey: ME_KEY }),
    ]);
}

/** Mutação que atualiza o resto da interface quando termina, com êxito ou não (um erro pode vir de dados já velhos). */
function useSpaceMutation<Variables, Data = void>(mutationFn: (variables: Variables) => Promise<Data>) {
  const refresh = useRefreshSpace();
  return useMutation({ mutationFn, onSettled: () => refresh() });
}

export function useCreateFolder() {
  return useSpaceMutation((values: { name: string; parentId: string | null }) =>
    apiFetch<{ folder: FolderItem }>("/api/folders", { method: "POST", json: values }),
  );
}

/** Renomeia e/ou move uma pasta (`parentId: null` = raiz). */
export function useUpdateFolder() {
  return useSpaceMutation(({ id, ...changes }: { id: string; name?: string; parentId?: string | null }) =>
    apiFetch<{ folder: FolderItem }>(`/api/folders/${encodeURIComponent(id)}`, { method: "PATCH", json: changes }),
  );
}

export function useDeleteFolder() {
  return useSpaceMutation((id: string) =>
    apiFetch(`/api/folders/${encodeURIComponent(id)}`, { method: "DELETE" }),
  );
}

/** Renomeia e/ou move um ficheiro (`folderId: null` = raiz). */
export function useUpdateFile() {
  return useSpaceMutation(({ id, ...changes }: { id: string; name?: string; folderId?: string | null }) =>
    apiFetch<{ file: FileItem }>(`/api/files/${encodeURIComponent(id)}`, { method: "PATCH", json: changes }),
  );
}

/** Exclui um ficheiro (vai para a lixeira). */
export function useDeleteFile() {
  return useSpaceMutation((id: string) =>
    apiFetch(`/api/files/${encodeURIComponent(id)}`, { method: "DELETE" }),
  );
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/space.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  5 passed (5)`.

- [ ] **Step 4: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  24 passed (24)`, `Tests  208 passed (208)`.

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  5 passed (5)`, `Tests  26 passed (26)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src test
git commit -m "Acrescenta as consultas e mutações do espaço, a árvore de pastas e o formatDate" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Envio de ficheiros: XHR com progresso e fila com 3 em paralelo

**Files:**
- Create: `src/web/upload.ts`, `src/web/upload.test.ts`, `src/web/uploads.ts`, `src/web/uploads.test.ts`, `src/web/test/fake-xhr.ts`

**Interfaces:**
- Consumes: `errorFromResponse`, `networkError`, `errorMessage`, `ApiRequestError` (Task 2); `formatBytes` (Plano 1); `FileItem` (Plano 2A).
- Produces: `src/web/upload.ts`: `uploadFile(file, folderId | null, onProgress(loaded, total)) → { promise: Promise<FileItem>, abort() }`, `ABORTED_CODE = "aborted"`, `UploadHandle`.
  `src/web/uploads.ts`: `UploadItem { id; name; size; folderId; status: "queued" | "uploading" | "done" | "error"; loaded; message? }`, `MAX_PARALLEL_UPLOADS = 3`,
  `new UploadManager({ maxUploadBytes: () => number, onSettled(item), upload? })` com `subscribe`, `getSnapshot`, `add(files, folderId | null)`, `cancel(id)`, `clearFinished()`.
  `src/web/test/fake-xhr.ts`: `stubXhr()` e `FakeXhr` (`progress`, `respond`, `fail`).

- [ ] **Step 1: `uploadFile` com XMLHttpRequest (teste primeiro)**

O `fetch` não dá o progresso do envio, por isso o upload usa `XMLHttpRequest`. O jsdom não simula o envio: o teste usa um `XMLHttpRequest` falso (`FakeXhr`) que o próprio teste comanda.

Criar `src/web/test/fake-xhr.ts`:

```ts
import { vi } from "vitest";

interface ProgressLike {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

/** `XMLHttpRequest` falso: o jsdom não simula o envio nem o progresso. Os testes comandam-no com `progress`, `respond` e `fail`. */
export class FakeXhr {
  static instances: FakeXhr[] = [];

  method = "";
  url = "";
  sent: unknown = undefined;
  status = 0;
  responseText = "";
  upload: { onprogress: ((event: ProgressLike) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  send(body: unknown): void {
    this.sent = body;
  }

  abort(): void {
    this.onabort?.();
  }

  progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }

  respond(status: number, body: unknown): void {
    this.status = status;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    this.onload?.();
  }

  fail(): void {
    this.onerror?.();
  }
}

/** Põe o `FakeXhr` no lugar do `XMLHttpRequest` (o `setup.ts` repõe o real no fim de cada teste). */
export function stubXhr(): typeof FakeXhr {
  FakeXhr.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return FakeXhr;
}
```

Criar `src/web/upload.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiRequestError, NETWORK_ERROR_MESSAGE, setUnauthorizedHandler } from "./api";
import { ABORTED_CODE, uploadFile } from "./upload";
import { stubXhr } from "./test/fake-xhr";

const FILE_ITEM = { id: "f1", name: "a.txt", folderId: null, size: 3, mime: "text/plain", createdAt: 1 };

function start(name = "a.txt", folderId: string | null = null, onProgress = vi.fn()) {
  const Xhr = stubXhr();
  const file = new File(["abc"], name, { type: "text/plain" });
  const handle = uploadFile(file, folderId, onProgress);
  return { handle, xhr: Xhr.instances[0], file, onProgress };
}

describe("uploadFile", () => {
  it("faz PUT /api/files com o ficheiro no corpo e a pasta no URL", () => {
    const { xhr, file } = start("a.txt", "pasta-1");
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe("/api/files?name=a.txt&folder=pasta-1");
    expect(xhr.sent).toBe(file);
  });

  it("não mete `folder` no URL quando o destino é a raiz", () => {
    expect(start("a.txt", null).xhr.url).toBe("/api/files?name=a.txt");
  });

  it("codifica o nome: `+`, `&`, `%` e `#` não podem mudar o significado do URL", () => {
    const { xhr } = start("a+b & c%d#e.txt");
    const query = new URL(xhr.url, "http://localhost").searchParams;
    expect(query.get("name")).toBe("a+b & c%d#e.txt");
    expect(xhr.url).toContain("name=a%2Bb+%26+c%25d%23e.txt");
  });

  it("devolve o progresso do envio", () => {
    const { xhr, onProgress } = start();
    xhr.progress(1, 3);
    xhr.progress(3, 3);
    expect(onProgress.mock.calls).toEqual([
      [1, 3],
      [3, 3],
    ]);
  });

  it("resolve com o ficheiro criado quando a API responde 201", async () => {
    const { handle, xhr } = start();
    xhr.respond(201, { file: FILE_ITEM });
    await expect(handle.promise).resolves.toEqual(FILE_ITEM);
  });

  it("falha com o código e a mensagem em português da API", async () => {
    const { handle, xhr } = start();
    xhr.respond(409, { error: "name_taken", message: "Já existe um ficheiro com esse nome neste local." });
    await expect(handle.promise).rejects.toBeInstanceOf(ApiRequestError);
    await expect(handle.promise).rejects.toMatchObject({ status: 409, code: "name_taken" });
  });

  it("um 413 sem JSON (o da Cloudflare) dá a mensagem de ficheiro grande", async () => {
    const { handle, xhr } = start();
    xhr.respond(413, "<html>Request Entity Too Large</html>");
    await expect(handle.promise).rejects.toMatchObject({
      status: 413,
      code: "unknown_error",
      message: "O ficheiro é demasiado grande.",
    });
  });

  it("uma resposta 201 sem o ficheiro é um erro, não um sucesso", async () => {
    const { handle, xhr } = start();
    xhr.respond(201, "isto não é JSON");
    await expect(handle.promise).rejects.toMatchObject({ code: "unknown_error" });
  });

  it("avisa o handler quando a sessão expirou durante o envio", async () => {
    const handler = vi.fn();
    const { handle, xhr } = start();
    setUnauthorizedHandler(handler);
    xhr.respond(401, { error: "unauthorized", message: "Sessão inválida ou expirada." });
    await expect(handle.promise).rejects.toMatchObject({ code: "unauthorized" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("uma falha de rede dá a mensagem de ligação", async () => {
    const { handle, xhr } = start();
    xhr.fail();
    await expect(handle.promise).rejects.toMatchObject({ status: 0, message: NETWORK_ERROR_MESSAGE });
  });

  it("cancelar faz a promessa falhar com o código `aborted`", async () => {
    const { handle } = start();
    handle.abort();
    await expect(handle.promise).rejects.toMatchObject({ code: ABORTED_CODE });
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/upload.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/upload.ts`:

```ts
import type { FileItem } from "../shared/types";
import { ApiRequestError, errorFromResponse, networkError } from "./api";

/** Código do erro com que a promessa de um envio cancelado falha. */
export const ABORTED_CODE = "aborted";

export interface UploadHandle {
  promise: Promise<FileItem>;
  /** Cancela o envio; a promessa falha com o código `aborted`. */
  abort: () => void;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null; // resposta sem JSON (ex.: o 413 da própria Cloudflare)
  }
}

function isFileBody(data: unknown): data is { file: FileItem } {
  return typeof data === "object" && data !== null && "file" in data;
}

/**
 * Envia um ficheiro para `PUT /api/files` com `XMLHttpRequest`: o `fetch` não dá o progresso do envio. O nome e a pasta
 * vão no URL, construído com `URLSearchParams` (o servidor decodifica `+` como espaço, por isso um nome com `+` tem de
 * ir como `%2B`). O browser acrescenta sozinho o `Content-Length` e o `Content-Type` (do `File`), que a API exige.
 */
export function uploadFile(
  file: File,
  folderId: string | null,
  onProgress: (loaded: number, total: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const query = new URLSearchParams({ name: file.name });
  if (folderId !== null) query.set("folder", folderId);

  const promise = new Promise<FileItem>((resolve, reject) => {
    xhr.open("PUT", `/api/files?${query}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onload = () => {
      const data = parseJson(xhr.responseText);
      if (xhr.status === 201 && isFileBody(data)) resolve(data.file);
      else reject(errorFromResponse(xhr.status, data));
    };
    xhr.onerror = () => reject(networkError());
    xhr.onabort = () => reject(new ApiRequestError(0, ABORTED_CODE, "Envio cancelado."));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/upload.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  11 passed (11)`.

- [ ] **Step 2: Fila de envios (teste primeiro)**

A fila vive fora do React (uma classe com `subscribe`/`getSnapshot`) para os envios continuarem quando o utilizador muda de pasta. Um ficheiro acima de `maxUploadBytes` nem sai do browser: acima do limite da Cloudflare, quem responde é a *edge* com um 413 que não é JSON.

Criar `src/web/uploads.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { FileItem } from "../shared/types";
import { ApiRequestError } from "./api";
import { ABORTED_CODE, type UploadHandle } from "./upload";
import { MAX_PARALLEL_UPLOADS, UploadManager } from "./uploads";

const FILE_ITEM: FileItem = { id: "f", name: "x", folderId: null, size: 1, mime: "text/plain", createdAt: 1 };
const file = (name: string, size = 10) => new File(["x".repeat(size)], name);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Um `uploadFile` falso em que cada envio fica pendente até o teste o resolver ou rejeitar. */
function fakeUploads() {
  const sent: Array<{
    file: File;
    folderId: string | null;
    progress: (loaded: number, total: number) => void;
    finish: () => void;
    fail: (error: unknown) => void;
    aborted: boolean;
  }> = [];
  const upload = (f: File, folderId: string | null, progress: (loaded: number, total: number) => void): UploadHandle => {
    let resolve!: (value: FileItem) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<FileItem>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const record = { file: f, folderId, progress, finish: () => resolve(FILE_ITEM), fail: reject, aborted: false };
    sent.push(record);
    return {
      promise,
      abort: () => {
        record.aborted = true;
        reject(new ApiRequestError(0, ABORTED_CODE, "Envio cancelado."));
      },
    };
  };
  return { upload, sent };
}

function setup(maxUploadBytes = Infinity) {
  const fake = fakeUploads();
  const onSettled = vi.fn();
  const manager = new UploadManager({ maxUploadBytes: () => maxUploadBytes, onSettled, upload: fake.upload });
  return { manager, onSettled, ...fake };
}

const statuses = (manager: UploadManager) => manager.getSnapshot().map((item) => `${item.name}:${item.status}`);

describe("UploadManager", () => {
  it(`envia no máximo ${MAX_PARALLEL_UPLOADS} ficheiros ao mesmo tempo e arranca o seguinte quando um termina`, async () => {
    const { manager, sent } = setup();
    manager.add(["a", "b", "c", "d", "e"].map((name) => file(name)), null);
    expect(sent.map((s) => s.file.name)).toEqual(["a", "b", "c"]);
    expect(statuses(manager)).toEqual(["a:uploading", "b:uploading", "c:uploading", "d:queued", "e:queued"]);

    sent[1].finish();
    await flush();
    expect(sent.map((s) => s.file.name)).toEqual(["a", "b", "c", "d"]);
    expect(statuses(manager)).toEqual(["a:uploading", "b:done", "c:uploading", "d:uploading", "e:queued"]);
  });

  it("regista o progresso e marca o ficheiro como concluído com todos os bytes", async () => {
    const { manager, sent } = setup();
    manager.add([file("a", 10)], null);
    sent[0].progress(4, 10);
    expect(manager.getSnapshot()[0]).toMatchObject({ status: "uploading", loaded: 4, size: 10 });
    sent[0].finish();
    await flush();
    expect(manager.getSnapshot()[0]).toMatchObject({ status: "done", loaded: 10 });
  });

  it("um erro fica no item com a mensagem e não pára os outros; onSettled avisa de todos", async () => {
    const { manager, sent, onSettled } = setup();
    manager.add([file("a"), file("b")], "pasta");
    sent[0].fail(new ApiRequestError(409, "name_taken", "Já existe um ficheiro com esse nome neste local."));
    sent[1].finish();
    await flush();
    expect(manager.getSnapshot()).toMatchObject([
      { name: "a", status: "error", message: "Já existe um ficheiro com esse nome neste local." },
      { name: "b", status: "done" },
    ]);
    expect(onSettled).toHaveBeenCalledTimes(2);
    expect(onSettled.mock.calls.map(([item]) => item.name)).toEqual(["a", "b"]);
  });

  it("recusa logo, sem enviar, um ficheiro acima do limite", () => {
    const { manager, sent } = setup(5);
    manager.add([file("grande", 6), file("pequeno", 5)], null);
    expect(statuses(manager)).toEqual(["grande:error", "pequeno:uploading"]);
    expect(manager.getSnapshot()[0].message).toBe("O ficheiro excede o limite de 5 B.");
    expect(sent.map((s) => s.file.name)).toEqual(["pequeno"]);
  });

  it("fixa a pasta de destino quando o ficheiro entra na fila", () => {
    const { manager, sent } = setup();
    manager.add([file("a")], "pasta-1");
    manager.add([file("b")], null);
    expect(sent.map((s) => s.folderId)).toEqual(["pasta-1", null]);
  });

  it("cancelar um ficheiro em espera tira-o da fila", () => {
    const { manager, sent } = setup();
    manager.add(["a", "b", "c", "d"].map((name) => file(name)), null);
    manager.cancel(manager.getSnapshot()[3].id);
    expect(statuses(manager)).toEqual(["a:uploading", "b:uploading", "c:uploading"]);
    expect(sent).toHaveLength(3);
  });

  it("cancelar um envio em curso aborta-o, tira-o da lista e deixa arrancar o seguinte", async () => {
    const { manager, sent, onSettled } = setup();
    manager.add(["a", "b", "c", "d"].map((name) => file(name)), null);
    manager.cancel(manager.getSnapshot()[0].id);
    await flush();
    expect(sent[0].aborted).toBe(true);
    expect(statuses(manager)).toEqual(["b:uploading", "c:uploading", "d:uploading"]);
    expect(onSettled).toHaveBeenCalledTimes(1); // o servidor pode ter mexido na quota: atualizar na mesma
  });

  it("limpar os terminados mantém o que está em curso ou em espera", async () => {
    const { manager, sent } = setup();
    manager.add(["a", "b", "c", "d"].map((name) => file(name)), null);
    sent[0].finish();
    sent[1].fail(new ApiRequestError(500, "internal_error", "Erro interno do servidor."));
    await flush();
    manager.clearFinished();
    expect(statuses(manager)).toEqual(["c:uploading", "d:uploading"]);
  });

  it("avisa os ouvintes a cada mudança e só troca o snapshot quando algo mudou", () => {
    const { manager } = setup();
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    const before = manager.getSnapshot();
    expect(manager.getSnapshot()).toBe(before);
    manager.add([file("a")], null);
    expect(listener).toHaveBeenCalled();
    expect(manager.getSnapshot()).not.toBe(before);
    unsubscribe();
    listener.mockClear();
    manager.clearFinished();
    expect(listener).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/uploads.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/uploads.ts`:

```ts
import { formatBytes } from "../shared/format";
import { ApiRequestError, errorMessage } from "./api";
import { ABORTED_CODE, uploadFile, type UploadHandle } from "./upload";

export type UploadStatus = "queued" | "uploading" | "done" | "error";

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  /** Pasta de destino, fixada quando o ficheiro entra na fila (o utilizador pode mudar de pasta entretanto). */
  folderId: string | null;
  status: UploadStatus;
  /** Bytes já enviados. */
  loaded: number;
  /** O que correu mal, quando `status` é "error". */
  message?: string;
}

/** Envios em simultâneo: mais do que isto só reparte a mesma largura de banda e gasta ligações. */
export const MAX_PARALLEL_UPLOADS = 3;

export interface UploadManagerOptions {
  /** Tamanho máximo de um ficheiro (`Infinity` enquanto não se conhece). Um ficheiro maior nem sai do browser. */
  maxUploadBytes: () => number;
  /** Chamado quando um envio termina, com êxito, erro ou cancelado: serve para atualizar listagens e quota. */
  onSettled: (item: UploadItem) => void;
  /** Só os testes trocam isto. */
  upload?: typeof uploadFile;
}

/**
 * Fila de envios com no máximo `MAX_PARALLEL_UPLOADS` a decorrer. Vive fora do React para sobreviver à navegação
 * entre pastas; a interface lê-a com `useSyncExternalStore` (`subscribe` e `getSnapshot`).
 */
export class UploadManager {
  private items: readonly UploadItem[] = [];
  private readonly files = new Map<string, File>();
  private readonly handles = new Map<string, UploadHandle>();
  private readonly listeners = new Set<() => void>();
  private readonly options: UploadManagerOptions;
  private nextId = 1;

  constructor(options: UploadManagerOptions) {
    this.options = options;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** A lista atual; só muda de identidade quando há alterações (é o que o `useSyncExternalStore` exige). */
  getSnapshot = (): readonly UploadItem[] => this.items;

  /** Põe ficheiros na fila para a pasta indicada (`null` = raiz). */
  add = (files: File[], folderId: string | null): void => {
    const max = this.options.maxUploadBytes();
    const added: UploadItem[] = [];
    for (const file of files) {
      const base = { id: `upload-${this.nextId++}`, name: file.name, size: file.size, folderId, loaded: 0 };
      if (file.size > max) {
        added.push({ ...base, status: "error", message: `O ficheiro excede o limite de ${formatBytes(max)}.` });
      } else {
        this.files.set(base.id, file);
        added.push({ ...base, status: "queued" });
      }
    }
    this.set([...this.items, ...added]);
    this.pump();
  };

  /** Tira da fila um ficheiro em espera ou aborta o que está a ser enviado (em ambos os casos o item desaparece). */
  cancel = (id: string): void => {
    const handle = this.handles.get(id);
    if (handle) {
      handle.abort(); // a promessa falha com `aborted` e `finish` remove o item
      return;
    }
    if (this.items.find((item) => item.id === id)?.status === "queued") {
      this.files.delete(id);
      this.set(this.items.filter((item) => item.id !== id));
    }
  };

  /** Tira da lista os envios terminados (com êxito ou com erro). */
  clearFinished = (): void => {
    const running = this.items.filter((item) => item.status === "queued" || item.status === "uploading");
    if (running.length !== this.items.length) this.set(running);
  };

  private set(items: readonly UploadItem[]): void {
    this.items = items;
    for (const listener of this.listeners) listener();
  }

  private update(id: string, changes: Partial<UploadItem>): void {
    this.set(this.items.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }

  private pump(): void {
    while (this.handles.size < MAX_PARALLEL_UPLOADS) {
      const next = this.items.find((item) => item.status === "queued");
      if (!next) return;
      this.start(next);
    }
  }

  private start(item: UploadItem): void {
    const file = this.files.get(item.id)!;
    this.update(item.id, { status: "uploading" });
    const upload = this.options.upload ?? uploadFile;
    const handle = upload(file, item.folderId, (loaded) => this.update(item.id, { loaded }));
    this.handles.set(item.id, handle);
    handle.promise.then(
      () => this.finish(item.id, { status: "done", loaded: file.size }),
      (error: unknown) => {
        const aborted = error instanceof ApiRequestError && error.code === ABORTED_CODE;
        this.finish(item.id, aborted ? null : { status: "error", message: errorMessage(error) });
      },
    );
  }

  /** `changes` a `null` = envio cancelado: o item desaparece. */
  private finish(id: string, changes: Partial<UploadItem> | null): void {
    this.handles.delete(id);
    this.files.delete(id);
    const before = this.items.find((item) => item.id === id);
    if (changes === null) this.set(this.items.filter((item) => item.id !== id));
    else this.update(id, changes);
    if (before) this.options.onSettled({ ...before, ...changes });
    this.pump();
  }
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/uploads.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  9 passed (9)`.

- [ ] **Step 3: Verificação e commit**

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  7 passed (7)`, `Tests  46 passed (46)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src
git commit -m "Acrescenta o envio de ficheiros com progresso e a fila de envios" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Componentes base: diálogo modal, nome, confirmação, menu de ações e caminho

**Files:**
- Create: `src/web/components/Modal.tsx`, `src/web/components/NameDialog.tsx`, `src/web/components/ConfirmDialog.tsx`, `src/web/components/RowMenu.tsx`, `src/web/components/Breadcrumb.tsx` e o `.test.tsx` de cada um
- Modify: `src/web/components/Button.tsx` (variante `danger`)

**Interfaces:**
- Consumes: `normalizeName`/`validateName` (`src/shared/names.ts`), `Button`, `TextField`, `Message` (Plano 1), `ROOT_LABEL` (Task 3), `BreadcrumbItem`.
- Produces: `Modal({ title, onClose, children, wide? })`;
  `NameDialog({ title, label, initialValue?, confirmLabel, pending, error, onSubmit(name), onClose })` (valida e normaliza o nome);
  `ConfirmDialog({ title, message, confirmLabel, pending, error, onConfirm, onClose })`;
  `RowMenu({ label, actions: MenuAction[] })` com `MenuAction { label; onSelect?; href?; danger? }`;
  `Breadcrumb({ items: BreadcrumbItem[] })` (vazio = raiz); `Button` com `variant="danger"`.

- [ ] **Step 1: `Modal` (teste primeiro)**

Um diálogo modal acessível feito à mão: o `<dialog>.showModal()` não existe no jsdom e, de qualquer modo, é preciso controlar o foco (preso dentro do diálogo e devolvido a quem o abriu).

Criar `src/web/components/Modal.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Modal } from "./Modal";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      {open && (
        <Modal title="Um título" onClose={() => setOpen(false)}>
          <button>Primeiro</button>
          <button>Último</button>
        </Modal>
      )}
    </>
  );
}

async function openModal() {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Abrir" }));
  return user;
}

describe("Modal", () => {
  it("abre um diálogo com o título como nome e o foco no primeiro botão", async () => {
    await openModal();
    expect(screen.getByRole("dialog", { name: "Um título" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Primeiro" })).toHaveFocus();
  });

  it("Esc fecha e devolve o foco a quem o abriu", async () => {
    const user = await openModal();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir" })).toHaveFocus();
  });

  it("o foco dá a volta: Tab no último vai ao primeiro e Shift+Tab no primeiro vai ao último", async () => {
    const user = await openModal();
    await user.tab();
    expect(screen.getByRole("button", { name: "Último" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Primeiro" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Último" })).toHaveFocus();
  });

  it("um clique no fundo fecha, um clique dentro não", async () => {
    const user = await openModal();
    await user.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByTestId("modal-backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/Modal.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/components/Modal.tsx`:

```tsx
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Largo, para a pré-visualização. */
  wide?: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * Diálogo modal acessível: `role="dialog"` com título, foco preso lá dentro (Tab e Shift+Tab dão a volta), Esc ou clique
 * no fundo fecham, e o foco volta ao elemento que o abriu. (Não usa `<dialog>.showModal()`: o jsdom não o implementa.)
 */
export function Modal({ title, onClose, children, wide = false }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current!;
    const opener = document.activeElement as HTMLElement | null;
    // Um campo com `autoFocus` já tem o foco; senão, o primeiro botão ou campo (ou o próprio diálogo).
    if (!dialog.contains(document.activeElement)) {
      (dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog).focus();
    }
    return () => opener?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      data-testid="modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`max-h-full w-full overflow-auto rounded-2xl bg-white p-6 shadow-xl outline-none ${wide ? "max-w-4xl" : "max-w-md"}`}
      >
        <h2 id={titleId} className="mb-4 text-lg font-semibold break-words text-slate-900">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/Modal.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  4 passed (4)`.

- [ ] **Step 2: `NameDialog` (teste primeiro)**

Criar `src/web/components/NameDialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NameDialog } from "./NameDialog";

function setup(props: Partial<Parameters<typeof NameDialog>[0]> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <NameDialog
      title="Renomear pasta"
      label="Nome da pasta"
      confirmLabel="Renomear"
      pending={false}
      error={null}
      onSubmit={onSubmit}
      onClose={onClose}
      {...props}
    />,
  );
  return { onSubmit, onClose, user: userEvent.setup() };
}

describe("NameDialog", () => {
  it("abre com o nome atual todo selecionado, pronto a ser substituído", () => {
    setup({ initialValue: "Fotos" });
    const input = screen.getByLabelText<HTMLInputElement>("Nome da pasta");
    expect(input).toHaveFocus();
    expect(input.value).toBe("Fotos");
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
  });

  it("entrega o nome normalizado (sem espaços nas pontas, em NFC)", async () => {
    const { onSubmit, user } = setup({ confirmLabel: "Criar" });
    await user.type(screen.getByLabelText("Nome da pasta"), "  Férias ");
    await user.click(screen.getByRole("button", { name: "Criar" }));
    expect(onSubmit).toHaveBeenCalledWith("Férias");
  });

  it("recusa um nome inválido sem chamar o servidor, com a mesma mensagem da API", async () => {
    const { onSubmit, user } = setup();
    await user.type(screen.getByLabelText("Nome da pasta"), "a/b");
    await user.click(screen.getByRole("button", { name: "Renomear" }));
    expect(screen.getByRole("alert")).toHaveTextContent("O nome não pode conter a barra (/).");
    await user.clear(screen.getByLabelText("Nome da pasta"));
    await user.click(screen.getByRole("button", { name: "Renomear" }));
    expect(screen.getByRole("alert")).toHaveTextContent("O nome não pode estar vazio.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("mostra o erro do servidor e fica ocupado enquanto grava", () => {
    setup({ error: "Já existe uma pasta com esse nome neste local.", pending: true });
    expect(screen.getByRole("alert")).toHaveTextContent("Já existe uma pasta com esse nome neste local.");
    expect(screen.getByRole("button", { name: "A guardar…" })).toBeDisabled();
  });

  it("Cancelar fecha sem guardar", async () => {
    const { onSubmit, onClose, user } = setup();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/NameDialog.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/components/NameDialog.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import { normalizeName, validateName } from "../../shared/names";
import { Button } from "./Button";
import { Message } from "./Message";
import { Modal } from "./Modal";
import { TextField } from "./TextField";

interface NameDialogProps {
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel: string;
  pending: boolean;
  /** Erro do servidor (ex.: nome repetido). */
  error: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

/** Pede um nome (nova pasta, renomear). Valida com as mesmas regras do servidor e entrega o nome já normalizado. */
export function NameDialog({
  title,
  label,
  initialValue = "",
  confirmLabel,
  pending,
  error,
  onSubmit,
  onClose,
}: NameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const name = normalizeName(value);
    const problem = validateName(name);
    setLocalError(problem);
    if (!problem) onSubmit(name);
  }

  const shownError = localError ?? error;

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <TextField
          label={label}
          name="name"
          value={value}
          autoFocus
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setValue(event.target.value)}
        />
        {shownError && <Message kind="error">{shownError}</Message>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "A guardar…" : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/NameDialog.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  5 passed (5)`.

- [ ] **Step 3: `ConfirmDialog` e a variante `danger` do `Button` (teste primeiro)**

Criar `src/web/components/ConfirmDialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

function setup(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <ConfirmDialog
      title="Excluir pasta"
      message="Excluir a pasta «Fotos»?"
      confirmLabel="Excluir"
      pending={false}
      error={null}
      onConfirm={onConfirm}
      onClose={onClose}
      {...props}
    />,
  );
  return { onConfirm, onClose, user: userEvent.setup() };
}

describe("ConfirmDialog", () => {
  it("mostra a pergunta e deixa o foco em Cancelar (a ação segura)", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Excluir pasta" })).toHaveTextContent("Excluir a pasta «Fotos»?");
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
  });

  it("Excluir confirma e Cancelar fecha", async () => {
    const { onConfirm, onClose, user } = setup();
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("mostra o erro do servidor e desativa o botão enquanto exclui", () => {
    setup({ error: "A pasta não está vazia. Mova ou exclua primeiro o conteúdo.", pending: true });
    expect(screen.getByRole("alert")).toHaveTextContent("A pasta não está vazia.");
    expect(screen.getByRole("button", { name: "A excluir…" })).toBeDisabled();
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/ConfirmDialog.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Em `src/web/components/Button.tsx`, trocar:

```tsx
  variant?: "primary" | "secondary";
```

por:

```tsx
  variant?: "primary" | "secondary" | "danger";
```

No mesmo ficheiro, trocar:

```tsx
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
};
```

por:

```tsx
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  danger: "bg-red-600 text-white hover:bg-red-500",
};
```

Criar `src/web/components/ConfirmDialog.tsx`:

```tsx
import { Button } from "./Button";
import { Message } from "./Message";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** Confirmação de uma ação destrutiva. O foco começa em "Cancelar". */
export function ConfirmDialog({ title, message, confirmLabel, pending, error, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-700">{message}</p>
        {error && <Message kind="error">{error}</Message>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            {pending ? "A excluir…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/ConfirmDialog.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  3 passed (3)`.

- [ ] **Step 4: `RowMenu` (teste primeiro)**

Criar `src/web/components/RowMenu.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RowMenu } from "./RowMenu";

function setup() {
  const rename = vi.fn();
  const remove = vi.fn();
  render(
    <div>
      <p>Fora do menu</p>
      <RowMenu
        label="Ações para a pasta Fotos"
        actions={[
          { label: "Renomear", onSelect: rename },
          { label: "Descarregar", href: "/api/files/f1/download" },
          { label: "Excluir", danger: true, onSelect: remove },
        ]}
      />
    </div>,
  );
  const button = screen.getByRole("button", { name: "Ações para a pasta Fotos" });
  return { rename, remove, button, user: userEvent.setup() };
}

describe("RowMenu", () => {
  it("começa fechado e abre com o foco na primeira ação", async () => {
    const { button, user } = setup();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Renomear" })).toHaveFocus();
  });

  it("escolher uma ação chama-a, fecha o menu e deixa o foco no botão", async () => {
    const { rename, button, user } = setup();
    await user.click(button);
    await user.click(screen.getByRole("menuitem", { name: "Renomear" }));
    expect(rename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("uma ação com `href` é uma ligação", async () => {
    const { button, user } = setup();
    await user.click(button);
    expect(screen.getByRole("menuitem", { name: "Descarregar" })).toHaveAttribute("href", "/api/files/f1/download");
  });

  it("as setas dão a volta pelas ações", async () => {
    const { button, user } = setup();
    await user.click(button);
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Descarregar" })).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Renomear" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Excluir" })).toHaveFocus();
  });

  it("Esc fecha e devolve o foco ao botão", async () => {
    const { button, user } = setup();
    await user.click(button);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("um clique fora fecha o menu", async () => {
    const { user, button } = setup();
    await user.click(button);
    await user.click(screen.getByText("Fora do menu"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/RowMenu.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/components/RowMenu.tsx`:

```tsx
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export interface MenuAction {
  label: string;
  /** Faz algo quando se escolhe a ação. */
  onSelect?: () => void;
  /** Em vez de `onSelect`: a ação é uma ligação (ex.: descarregar). */
  href?: string;
  danger?: boolean;
}

interface RowMenuProps {
  /** Nome acessível do botão, ex.: "Ações para a pasta Fotos". */
  label: string;
  actions: MenuAction[];
}

const ITEM_CLASS = "block w-full px-3 py-2 text-left text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none";

/** Botão "⋮" que abre um menu de ações (`role="menu"`): setas movem o foco, Esc fecha e devolve o foco ao botão. */
export function RowMenu({ label, actions }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = [...rootRef.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
      const index = items.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length].focus();
    }
  }

  // O foco volta ao botão antes de agir: se a ação abrir um diálogo, é para aqui que o foco regressa ao fechá-lo.
  function choose(action: MenuAction) {
    setOpen(false);
    buttonRef.current?.focus();
    action.onSelect?.();
  }

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
          <circle cx="10" cy="4" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="10" cy="16" r="1.6" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {actions.map((action) => {
            const className = `${ITEM_CLASS} ${action.danger ? "text-red-700" : "text-slate-700"}`;
            return action.href ? (
              <a key={action.label} role="menuitem" href={action.href} className={className} onClick={() => choose(action)}>
                {action.label}
              </a>
            ) : (
              <button key={action.label} role="menuitem" type="button" className={className} onClick={() => choose(action)}>
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/RowMenu.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  6 passed (6)`.

- [ ] **Step 5: `Breadcrumb` (teste primeiro)**

Criar `src/web/components/Breadcrumb.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Breadcrumb } from "./Breadcrumb";

const renderCrumbs = (items: Parameters<typeof Breadcrumb>[0]["items"]) =>
  render(
    <MemoryRouter>
      <Breadcrumb items={items} />
    </MemoryRouter>,
  );

describe("Breadcrumb", () => {
  it("na raiz só mostra «Meu espaço», como página atual e sem ligação", () => {
    renderCrumbs([]);
    expect(screen.getByText("Meu espaço")).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("numa pasta liga a raiz e as pastas acima; a pasta atual não é uma ligação", () => {
    renderCrumbs([
      { id: "a", name: "Fotos" },
      { id: "b", name: "Férias" },
    ]);
    expect(screen.getByRole("navigation", { name: "Caminho" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Meu espaço" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Fotos" })).toHaveAttribute("href", "/pasta/a");
    expect(screen.queryByRole("link", { name: "Férias" })).not.toBeInTheDocument();
    expect(screen.getByText("Férias")).toHaveAttribute("aria-current", "page");
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/Breadcrumb.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/components/Breadcrumb.tsx`:

```tsx
import { Link } from "react-router";
import type { BreadcrumbItem } from "../../shared/types";
import { ROOT_LABEL } from "../tree";

const CURRENT = "font-semibold text-slate-900";

/** Caminho da raiz até à pasta atual; a pasta atual não é uma ligação. Vazio = estamos na raiz. */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Caminho">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-slate-600">
        <li>
          {items.length === 0 ? (
            <span aria-current="page" className={CURRENT}>
              {ROOT_LABEL}
            </span>
          ) : (
            <Link to="/" className="hover:underline">
              {ROOT_LABEL}
            </Link>
          )}
        </li>
        {items.map((item, index) => (
          <li key={item.id} className="flex items-center gap-1">
            <span aria-hidden="true">/</span>
            {index === items.length - 1 ? (
              <span aria-current="page" className={CURRENT}>
                {item.name}
              </span>
            ) : (
              <Link to={`/pasta/${item.id}`} className="hover:underline">
                {item.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/Breadcrumb.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  2 passed (2)`.

- [ ] **Step 6: Verificação e commit**

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  12 passed (12)`, `Tests  66 passed (66)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src
git commit -m "Acrescenta o diálogo modal, os diálogos de nome e confirmação, o menu de ações e o caminho" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Página «Meu espaço»: listagem, caminho, nova pasta e rotas

**Files:**
- Create: `src/web/components/icons.tsx`, `src/web/components/ItemRows.tsx`, `src/web/pages/FolderPage.tsx`, `src/web/pages/FolderPage.test.tsx`, `src/web/components/AppLayout.test.tsx`
- Modify: `src/web/App.tsx`, `src/web/components/AppLayout.tsx`, `src/web/test/render.tsx`
- Delete: `src/web/pages/HomePage.tsx`

**Interfaces:**
- Consumes: `useContents`, `useCreateFolder` (Task 3), `NameDialog`, `Breadcrumb` (Task 5), `ROOT_LABEL`, `errorMessage`, `ApiRequestError`, `mockApi`/`SESSION`/`ME` (Task 2).
- Produces: rotas `/` e `/pasta/:folderId` (ambas com `FolderPage`); `FolderRow({ folder })` e `FileRow({ file })` em `src/web/components/ItemRows.tsx`
  (cada linha tem uma ranhura `actions` à direita, que a Task 7 preenche); `FolderIcon`, `FileIcon`; `renderApp(route?, client?)` em `src/web/test/render.tsx`.
  O `AppLayout` passa a ter «Tentar novamente» no erro, o erro de «Sair» e «Meu espaço» ativo dentro das pastas.

- [ ] **Step 1: Página da pasta, linhas e rotas (testes primeiro)**

Em `src/web/test/render.tsx`, substituir o bloco de `import` no topo do ficheiro (todas as linhas de `import`, até à linha em branco) por:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import App from "../App";
import { createQueryClient } from "../query-client";
```

Acrescentar ao fim de `src/web/test/render.tsx`:

```tsx
/** A aplicação inteira numa rota (router em memória), para testes de páginas. */
export function renderApp(route = "/", client = testQueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client };
}
```

Criar `src/web/pages/FolderPage.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FolderContents } from "../../shared/types";
import { apiError, json, mockApi, SESSION } from "../test/mock-api";
import { renderApp } from "../test/render";

const CREATED = new Date(2026, 9, 3, 12).getTime();

const ROOT: FolderContents = {
  folder: null,
  breadcrumb: [],
  folders: [{ id: "f1", name: "Fotos", parentId: null, createdAt: CREATED }],
  files: [{ id: "a1", name: "relatório.pdf", folderId: null, size: 1536, mime: "application/pdf", createdAt: CREATED }],
};

const FOTOS: FolderContents = {
  folder: ROOT.folders[0],
  breadcrumb: [{ id: "f1", name: "Fotos" }],
  folders: [],
  files: [],
};

describe("FolderPage: listagem", () => {
  it("na raiz mostra as pastas e os ficheiros com tamanho e data", async () => {
    mockApi({ ...SESSION, "GET /api/folders/:id/contents": () => json(ROOT) });
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Meu espaço" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fotos" })).toHaveAttribute("href", "/pasta/f1");
    const file = screen.getByText("relatório.pdf").closest("li")!;
    expect(within(file).getByText("1,5 KB")).toBeInTheDocument();
    expect(within(file).getByText("03/10/2026")).toBeInTheDocument();
  });

  it("numa pasta mostra o caminho e o nome da pasta, e pede essa pasta à API", async () => {
    const server = mockApi({ ...SESSION, "GET /api/folders/:id/contents": () => json(FOTOS) });
    renderApp("/pasta/f1");
    expect(await screen.findByRole("heading", { name: "Fotos" })).toBeInTheDocument();
    const breadcrumb = within(screen.getByRole("navigation", { name: "Caminho" }));
    expect(breadcrumb.getByRole("link", { name: "Meu espaço" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Esta pasta está vazia.")).toBeInTheDocument();
    expect(server.callsTo("GET /api/folders/:id/contents")[0].params.id).toBe("f1");
  });

  it("clicar numa pasta abre-a", async () => {
    mockApi({
      ...SESSION,
      "GET /api/folders/:id/contents": ({ params }) => json(params.id === "root" ? ROOT : FOTOS),
    });
    renderApp("/");
    await userEvent.click(await screen.findByRole("link", { name: "Fotos" }));
    expect(await screen.findByRole("heading", { name: "Fotos" })).toBeInTheDocument();
  });

  it("uma pasta que não existe (404) diz isso e leva de volta à raiz, sem tentar de novo", async () => {
    const server = mockApi({
      ...SESSION,
      "GET /api/folders/:id/contents": () => apiError(404, "folder_not_found", "Pasta não encontrada."),
    });
    renderApp("/pasta/apagada");
    expect(await screen.findByText("Esta pasta não existe ou foi eliminada.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir para Meu espaço" })).toHaveAttribute("href", "/");
    expect(server.callsTo("GET /api/folders/:id/contents")).toHaveLength(1);
  });

  it("um erro do servidor mostra a mensagem e deixa tentar de novo", async () => {
    let calls = 0;
    mockApi({
      ...SESSION,
      "GET /api/folders/:id/contents": () =>
        ++calls === 1 ? apiError(500, "internal_error", "Erro interno do servidor.") : json(ROOT),
    });
    renderApp("/");
    expect(await screen.findByText("Erro interno do servidor.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByRole("link", { name: "Fotos" })).toBeInTheDocument();
  });
});

describe("FolderPage: nova pasta", () => {
  it("cria a pasta na pasta atual, fecha o diálogo e mostra a pasta nova", async () => {
    let created = false;
    const server = mockApi({
      ...SESSION,
      "GET /api/folders/:id/contents": () =>
        json(created ? { ...FOTOS, folders: [{ id: "n1", name: "Férias", parentId: "f1", createdAt: CREATED }] } : FOTOS),
      "POST /api/folders": () => {
        created = true;
        return json({ folder: { id: "n1", name: "Férias", parentId: "f1", createdAt: CREATED } }, 201);
      },
    });
    const user = userEvent.setup();
    renderApp("/pasta/f1");
    await user.click(await screen.findByRole("button", { name: "Nova pasta" }));
    await user.type(screen.getByLabelText("Nome da pasta"), "Férias");
    await user.click(screen.getByRole("button", { name: "Criar" }));

    expect(await screen.findByRole("link", { name: "Férias" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.callsTo("POST /api/folders")[0].body).toEqual({ name: "Férias", parentId: "f1" });
  });

  it("na raiz cria com `parentId: null`", async () => {
    const server = mockApi({
      ...SESSION,
      "GET /api/folders/:id/contents": () => json(ROOT),
      "POST /api/folders": () => json({ folder: { id: "n1", name: "Docs", parentId: null, createdAt: CREATED } }, 201),
    });
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Nova pasta" }));
    await user.type(screen.getByLabelText("Nome da pasta"), "Docs");
    await user.click(screen.getByRole("button", { name: "Criar" }));
    await screen.findByRole("heading", { name: "Meu espaço" });
    expect(server.callsTo("POST /api/folders")[0].body).toEqual({ name: "Docs", parentId: null });
  });

  it("um nome repetido mostra o erro do servidor e o diálogo fica aberto", async () => {
    mockApi({
      ...SESSION,
      "GET /api/folders/:id/contents": () => json(ROOT),
      "POST /api/folders": () => apiError(409, "name_taken", "Já existe uma pasta com esse nome neste local."),
    });
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Nova pasta" }));
    await user.type(screen.getByLabelText("Nome da pasta"), "Fotos");
    await user.click(screen.getByRole("button", { name: "Criar" }));
    expect(await screen.findByText("Já existe uma pasta com esse nome neste local.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Nova pasta" })).toBeInTheDocument();
  });

  it("um nome inválido nem chega ao servidor", async () => {
    const server = mockApi({ ...SESSION, "GET /api/folders/:id/contents": () => json(ROOT) });
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Nova pasta" }));
    await user.type(screen.getByLabelText("Nome da pasta"), "a/b");
    await user.click(screen.getByRole("button", { name: "Criar" }));
    expect(screen.getByText("O nome não pode conter a barra (/).")).toBeInTheDocument();
    expect(server.callsTo("POST /api/folders")).toHaveLength(0);
  });

  it("depois de um erro, abrir o diálogo outra vez não mostra o erro antigo", async () => {
    mockApi({
      ...SESSION,
      "GET /api/folders/:id/contents": () => json(ROOT),
      "POST /api/folders": () => apiError(409, "name_taken", "Já existe uma pasta com esse nome neste local."),
    });
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Nova pasta" }));
    await user.type(screen.getByLabelText("Nome da pasta"), "Fotos");
    await user.click(screen.getByRole("button", { name: "Criar" }));
    await screen.findByText("Já existe uma pasta com esse nome neste local.");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.click(screen.getByRole("button", { name: "Nova pasta" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/pages/FolderPage.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  10 failed (10)).

Criar `src/web/components/icons.tsx`:

```tsx
const BASE = "h-5 w-5 shrink-0";

export function FolderIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`${BASE} text-indigo-500`} fill="currentColor">
      <path d="M3 6a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.5.7L11 6h4a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
    </svg>
  );
}

export function FileIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`${BASE} text-slate-400`} fill="currentColor">
      <path d="M5 3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.4a2 2 0 0 0-.6-1.4l-3.4-3.4A2 2 0 0 0 11.6 3H5z" />
    </svg>
  );
}
```

Criar `src/web/components/ItemRows.tsx`:

```tsx
import type { ReactNode } from "react";
import { Link } from "react-router";
import { formatBytes, formatDate } from "../../shared/format";
import type { FileItem, FolderItem } from "../../shared/types";
import { FileIcon, FolderIcon } from "./icons";

interface ItemRowProps {
  icon: ReactNode;
  name: ReactNode;
  size: string;
  date: string;
  /** O menu de ações da linha. */
  actions?: ReactNode;
}

function ItemRow({ icon, name, size, date, actions }: ItemRowProps) {
  return (
    <li className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50">
      {icon}
      <span className="min-w-0 flex-1">{name}</span>
      <span className="hidden w-24 shrink-0 text-right text-sm text-slate-500 sm:block">{size}</span>
      <span className="hidden w-24 shrink-0 text-right text-sm text-slate-500 sm:block">{date}</span>
      <span className="w-9 shrink-0">{actions}</span>
    </li>
  );
}

export function FolderRow({ folder }: { folder: FolderItem }) {
  return (
    <ItemRow
      icon={<FolderIcon />}
      name={
        <Link to={`/pasta/${folder.id}`} title={folder.name} className="block truncate font-medium hover:underline">
          {folder.name}
        </Link>
      }
      size="—"
      date={formatDate(folder.createdAt)}
    />
  );
}

export function FileRow({ file }: { file: FileItem }) {
  return (
    <ItemRow
      icon={<FileIcon />}
      name={
        <span title={file.name} className="block truncate">
          {file.name}
        </span>
      }
      size={formatBytes(file.size)}
      date={formatDate(file.createdAt)}
    />
  );
}
```

Criar `src/web/pages/FolderPage.tsx`:

```tsx
import { useState } from "react";
import { Link, useParams } from "react-router";
import { ApiRequestError, errorMessage } from "../api";
import { Breadcrumb } from "../components/Breadcrumb";
import { Button } from "../components/Button";
import { FileRow, FolderRow } from "../components/ItemRows";
import { Message } from "../components/Message";
import { NameDialog } from "../components/NameDialog";
import { useContents, useCreateFolder } from "../space";
import { ROOT_LABEL } from "../tree";

/** "Meu espaço": o conteúdo de uma pasta (a raiz em `/`, as outras em `/pasta/:folderId`). */
export default function FolderPage() {
  const folderId = useParams().folderId ?? null;
  const contents = useContents(folderId);
  const createFolder = useCreateFolder();
  const [creating, setCreating] = useState(false);

  if (contents.isPending) return <p className="text-slate-500">A carregar…</p>;
  if (contents.isError) {
    const gone = contents.error instanceof ApiRequestError && contents.error.code === "folder_not_found";
    return (
      <div className="max-w-md space-y-4">
        <Message kind="error">{gone ? "Esta pasta não existe ou foi eliminada." : errorMessage(contents.error)}</Message>
        {gone ? (
          <Link to="/" className="text-sm font-medium text-indigo-600 hover:underline">
            Ir para {ROOT_LABEL}
          </Link>
        ) : (
          <Button variant="secondary" onClick={() => void contents.refetch()}>
            Tentar novamente
          </Button>
        )}
      </div>
    );
  }

  const { folder, breadcrumb, folders, files } = contents.data;

  function closeCreate() {
    setCreating(false);
    createFolder.reset();
  }

  return (
    <div>
      <Breadcrumb items={breadcrumb} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight break-words">{folder?.name ?? ROOT_LABEL}</h1>
        <Button variant="secondary" onClick={() => setCreating(true)}>
          Nova pasta
        </Button>
      </div>

      {folders.length + files.length === 0 ? (
        <p className="mt-10 text-center text-slate-500">Esta pasta está vazia.</p>
      ) : (
        <ul className="mt-6 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {folders.map((item) => (
            <FolderRow key={item.id} folder={item} />
          ))}
          {files.map((item) => (
            <FileRow key={item.id} file={item} />
          ))}
        </ul>
      )}

      {creating && (
        <NameDialog
          title="Nova pasta"
          label="Nome da pasta"
          confirmLabel="Criar"
          pending={createFolder.isPending}
          error={createFolder.error ? errorMessage(createFolder.error) : null}
          onSubmit={(name) => createFolder.mutate({ name, parentId: folderId }, { onSuccess: closeCreate })}
          onClose={closeCreate}
        />
      )}
    </div>
  );
}
```

Substituir o conteúdo de `src/web/App.tsx`:

```tsx
import { Navigate, Route, Routes } from "react-router";
import AppLayout from "./components/AppLayout";
import AccountPage from "./pages/AccountPage";
import FolderPage from "./pages/FolderPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/registo" element={<RegisterPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<FolderPage />} />
        <Route path="pasta/:folderId" element={<FolderPage />} />
        <Route path="conta" element={<AccountPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
```

Apagar o ficheiro (o marcador de posição «Meu espaço» do Plano 1):

```bash
git rm src/web/pages/HomePage.tsx
```

Run: `npx vitest run -c vitest.web.config.ts src/web/pages/FolderPage.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  10 passed (10)`.

- [ ] **Step 2: Layout: tentar de novo, erro ao sair e «Meu espaço» ativo nas pastas (testes primeiro)**

Pendentes do Plano 1: o estado de erro do layout não deixava tentar de novo, «Sair» falhava em silêncio e a rede em baixo aparecia como "Failed to fetch". O «Meu espaço» da barra lateral passa também a ficar ativo dentro de `/pasta/...`.

Criar `src/web/components/AppLayout.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NETWORK_ERROR_MESSAGE } from "../api";
import { apiError, json, ME, mockApi, noContent } from "../test/mock-api";
import { renderApp } from "../test/render";

const EMPTY = { folder: null, breadcrumb: [], folders: [], files: [] };
const CONTENTS = { "GET /api/folders/:id/contents": () => json(EMPTY) };

describe("AppLayout", () => {
  it("sem sessão (401) vai para o login", async () => {
    mockApi({ "GET /api/auth/me": () => apiError(401, "unauthorized", "Sessão inválida ou expirada.") });
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
  });

  it("com o servidor em baixo mostra o erro e deixa tentar de novo", async () => {
    let calls = 0;
    mockApi({
      ...CONTENTS,
      "GET /api/auth/me": () => (++calls === 1 ? apiError(502, "unknown_error", "Erro do servidor.") : json({ user: ME })),
    });
    renderApp("/");
    expect(await screen.findByRole("alert")).toHaveTextContent("Erro do servidor.");
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByRole("navigation", { name: "Principal" })).toBeInTheDocument();
  });

  it("sem rede mostra a mensagem de ligação em português", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderApp("/");
    expect(await screen.findByRole("alert")).toHaveTextContent(NETWORK_ERROR_MESSAGE);
  });

  it("mostra o email, o espaço usado e «Meu espaço» ativo também dentro de uma pasta", async () => {
    mockApi({
      ...CONTENTS,
      "GET /api/auth/me": () => json({ user: { ...ME, usedBytes: 536_870_912 } }),
    });
    renderApp("/pasta/f1");
    expect(await screen.findByText("ana@example.com")).toBeInTheDocument();
    expect(screen.getByText("512 MB de 1 GB")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Meu espaço" }).className).toContain("bg-indigo-50");
    expect(screen.getByRole("link", { name: "Conta" }).className).not.toContain("bg-indigo-50");
  });

  it("«Sair» termina a sessão e volta ao login", async () => {
    let signedIn = true;
    mockApi({
      ...CONTENTS,
      "GET /api/auth/me": () => (signedIn ? json({ user: ME }) : apiError(401, "unauthorized", "Sessão inválida ou expirada.")),
      "POST /api/auth/logout": () => {
        signedIn = false;
        return noContent();
      },
    });
    renderApp("/");
    await userEvent.click(await screen.findByRole("button", { name: "Sair" }));
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
  });

  it("se «Sair» falhar, mostra o erro e a sessão continua", async () => {
    mockApi({
      ...CONTENTS,
      "GET /api/auth/me": () => json({ user: ME }),
      "POST /api/auth/logout": () => apiError(500, "internal_error", "Erro interno do servidor."),
    });
    renderApp("/");
    await userEvent.click(await screen.findByRole("button", { name: "Sair" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Erro interno do servidor.");
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/AppLayout.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  4 failed | 2 passed (6)).

Substituir o conteúdo de `src/web/components/AppLayout.tsx`:

```tsx
import { Navigate, NavLink, Outlet, useLocation } from "react-router";
import { errorMessage } from "../api";
import { useLogout, useMe } from "../auth";
import { Button } from "./Button";
import { Message } from "./Message";
import { UsageBar } from "./UsageBar";

function navClass({ isActive }: { isActive: boolean }): string {
  return `block rounded-lg px-3 py-2 text-sm font-medium ${
    isActive ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-100"
  }`;
}

/** Layout das páginas autenticadas: barra lateral com navegação, uso de espaço e saída. */
export default function AppLayout() {
  const me = useMe();
  const logout = useLogout();
  const { pathname } = useLocation();

  if (me.isPending) return <p className="p-8 text-slate-500">A carregar…</p>;
  if (me.isError) {
    return (
      <div className="max-w-md space-y-4 p-8">
        <Message kind="error">{errorMessage(me.error)}</Message>
        <Button variant="secondary" onClick={() => void me.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }
  if (!me.data) return <Navigate to="/login" replace />;
  const user = me.data;

  return (
    <div className="min-h-screen md:flex">
      <aside className="flex shrink-0 flex-col gap-6 border-b border-slate-200 bg-white p-4 md:min-h-screen md:w-64 md:border-r md:border-b-0">
        <div className="text-xl font-bold tracking-tight text-indigo-600">SpaceWork</div>
        <nav className="flex gap-1 md:flex-col" aria-label="Principal">
          {/* "Meu espaço" também fica ativo dentro das pastas (/pasta/...). */}
          <NavLink to="/" end className={({ isActive }) => navClass({ isActive: isActive || pathname.startsWith("/pasta/") })}>
            Meu espaço
          </NavLink>
          <NavLink to="/conta" className={navClass}>
            Conta
          </NavLink>
        </nav>
        <div className="space-y-4 md:mt-auto">
          <UsageBar usedBytes={user.usedBytes} quotaBytes={user.quotaBytes} />
          <div className="truncate text-xs text-slate-500" title={user.email}>
            {user.email}
          </div>
          {logout.isError && <Message kind="error">{errorMessage(logout.error)}</Message>}
          <Button
            variant="secondary"
            className="w-full"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            Sair
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/AppLayout.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  6 passed (6)`.

- [ ] **Step 3: Verificação e commit**

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  14 passed (14)`, `Tests  82 passed (82)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npm run build`
Expected: `✓ built in ...` duas vezes (Worker e cliente).

Commit:

```bash
git add src
git commit -m "Acrescenta a página Meu espaço com listagem, caminho e nova pasta, e melhora o layout" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Ações das linhas: renomear, mover, excluir e descarregar

**Files:**
- Create: `src/web/components/MoveDialog.tsx`, `src/web/components/FolderActions.tsx`, `src/web/components/FileActions.tsx` e o `.test.tsx` de cada um
- Modify: `src/web/components/ItemRows.tsx`, `src/web/pages/FolderPage.test.tsx`

**Interfaces:**
- Consumes: `useUpdateFolder`, `useDeleteFolder`, `useUpdateFile`, `useDeleteFile`, `useTree` (Task 3), `folderOptions`/`subtreeIds` (Task 3),
  `NameDialog`, `ConfirmDialog`, `RowMenu`, `Modal` (Task 5), `FolderRow`/`FileRow` com a ranhura `actions` (Task 6).
- Produces: `MoveDialog({ title, currentFolderId, movingFolderId?, pending, error, onSubmit(folderId | null), onClose })`;
  `FolderActions({ folder })` e `FileActions({ file })` (o menu «⋮» da linha, com os diálogos); as linhas passam a ter o menu.

- [ ] **Step 1: `MoveDialog` (teste primeiro)**

O destino escolhe-se num `<select>` com as pastas recuadas pelo nível. Ficam desativados: a pasta onde o item já está e, ao mover uma pasta, ela própria e todas as suas descendentes (o servidor também o recusa com `invalid_move`, mas assim o utilizador nem tenta).

Criar `src/web/components/MoveDialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FolderItem } from "../../shared/types";
import { apiError, json, mockApi } from "../test/mock-api";
import { queryWrapper, testQueryClient } from "../test/render";
import { MoveDialog } from "./MoveDialog";

const folder = (id: string, name: string, parentId: string | null): FolderItem => ({ id, name, parentId, createdAt: 0 });

// Docs; Fotos > Férias > Praia
const TREE = [folder("docs", "Docs", null), folder("fotos", "Fotos", null), folder("ferias", "Férias", "fotos"), folder("praia", "Praia", "ferias")];

function setup(props: Partial<Parameters<typeof MoveDialog>[0]> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const Wrapper = queryWrapper(testQueryClient());
  render(
    <Wrapper>
      <MoveDialog
        title="Mover"
        currentFolderId={null}
        pending={false}
        error={null}
        onSubmit={onSubmit}
        onClose={onClose}
        {...props}
      />
    </Wrapper>,
  );
  return { onSubmit, onClose, user: userEvent.setup() };
}

const optionTexts = () => screen.getAllByRole("option").map((option) => (option.textContent ?? "").replace(/\u00a0/g, "·"));

describe("MoveDialog", () => {
  it("lista a raiz e as pastas recuadas, com a pasta atual desativada", async () => {
    mockApi({ "GET /api/folders/tree": () => json({ folders: TREE }) });
    setup({ currentFolderId: "docs" });
    await screen.findByRole("combobox", { name: "Pasta de destino" });
    expect(optionTexts()).toEqual([
      "Escolha a pasta de destino…",
      "Meu espaço",
      "··Docs (pasta atual)",
      "··Fotos",
      "····Férias",
      "······Praia",
    ]);
    expect(screen.getByRole("option", { name: /Docs/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: /Fotos/ })).toBeEnabled();
  });

  it("ao mover uma pasta, ela própria e as suas descendentes ficam desativadas (e a raiz, onde ela já está)", async () => {
    mockApi({ "GET /api/folders/tree": () => json({ folders: TREE }) });
    setup({ currentFolderId: null, movingFolderId: "fotos" });
    await screen.findByRole("combobox", { name: "Pasta de destino" });
    const disabled = screen.getAllByRole("option").filter((option) => (option as HTMLOptionElement).disabled);
    expect(disabled.map((option) => option.textContent?.trim())).toEqual([
      "Escolha a pasta de destino…",
      "Meu espaço (pasta atual)",
      "Fotos",
      "Férias",
      "Praia",
    ]);
    expect(screen.getByRole("option", { name: "Docs" })).toBeEnabled();
  });

  it("só deixa mover depois de escolher, e entrega o id (ou null para a raiz)", async () => {
    mockApi({ "GET /api/folders/tree": () => json({ folders: TREE }) });
    const { onSubmit, user } = setup({ currentFolderId: "docs" });
    await screen.findByRole("combobox", { name: "Pasta de destino" });
    expect(screen.getByRole("button", { name: "Mover" })).toBeDisabled();

    await user.selectOptions(screen.getByRole("combobox"), "ferias");
    await user.click(screen.getByRole("button", { name: "Mover" }));
    expect(onSubmit).toHaveBeenLastCalledWith("ferias");

    await user.selectOptions(screen.getByRole("combobox"), "root");
    await user.click(screen.getByRole("button", { name: "Mover" }));
    expect(onSubmit).toHaveBeenLastCalledWith(null);
  });

  it("mostra o erro do servidor", async () => {
    mockApi({ "GET /api/folders/tree": () => json({ folders: TREE }) });
    setup({ error: "Já existe uma pasta com esse nome neste local." });
    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe uma pasta com esse nome neste local.");
  });

  it("se a lista de pastas falhar, mostra o erro e deixa tentar de novo", async () => {
    let calls = 0;
    mockApi({
      "GET /api/folders/tree": () => (++calls === 1 ? apiError(500, "internal_error", "Erro interno do servidor.") : json({ folders: TREE })),
    });
    const { user } = setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("Erro interno do servidor.");
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByRole("combobox", { name: "Pasta de destino" })).toBeInTheDocument();
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/MoveDialog.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/components/MoveDialog.tsx`:

```tsx
import { useMemo, useState, type FormEvent } from "react";
import { errorMessage } from "../api";
import { useTree } from "../space";
import { folderOptions, subtreeIds } from "../tree";
import { Button } from "./Button";
import { Message } from "./Message";
import { Modal } from "./Modal";

interface MoveDialogProps {
  title: string;
  /** Onde o item está agora (`null` = raiz): não é um destino válido. */
  currentFolderId: string | null;
  /** Ao mover uma pasta: ela própria e as suas descendentes também não podem ser o destino. */
  movingFolderId?: string;
  pending: boolean;
  /** Erro do servidor. */
  error: string | null;
  /** Recebe o destino; `null` = raiz. */
  onSubmit: (folderId: string | null) => void;
  onClose: () => void;
}

const ROOT_VALUE = "root";

/** Escolha da pasta de destino num `<select>` com as pastas recuadas pelo nível; os destinos inválidos ficam desativados. */
export function MoveDialog({ title, currentFolderId, movingFolderId, pending, error, onSubmit, onClose }: MoveDialogProps) {
  const tree = useTree();
  const [target, setTarget] = useState("");
  const options = useMemo(() => folderOptions(tree.data ?? []), [tree.data]);
  const blocked = useMemo(
    () => (movingFolderId && tree.data ? subtreeIds(tree.data, movingFolderId) : new Set<string>()),
    [movingFolderId, tree.data],
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (target !== "") onSubmit(target === ROOT_VALUE ? null : target);
  }

  return (
    <Modal title={title} onClose={onClose}>
      {tree.isPending ? (
        <p className="text-sm text-slate-500">A carregar pastas…</p>
      ) : tree.isError ? (
        <div className="space-y-3">
          <Message kind="error">{errorMessage(tree.error)}</Message>
          <Button variant="secondary" onClick={() => void tree.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Pasta de destino</span>
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            >
              <option value="" disabled>
                Escolha a pasta de destino…
              </option>
              {options.map((option) => {
                const here = option.id === currentFolderId;
                const disabled = here || (option.id !== null && blocked.has(option.id));
                return (
                  <option key={option.id ?? ROOT_VALUE} value={option.id ?? ROOT_VALUE} disabled={disabled}>
                    {"\u00a0\u00a0".repeat(option.depth)}
                    {option.name}
                    {here ? " (pasta atual)" : ""}
                  </option>
                );
              })}
            </select>
          </label>
          {error && <Message kind="error">{error}</Message>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || target === ""}>
              {pending ? "A mover…" : "Mover"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/MoveDialog.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  5 passed (5)`.

- [ ] **Step 2: `FolderActions` (teste primeiro)**

Criar `src/web/components/FolderActions.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FolderItem } from "../../shared/types";
import { apiError, json, mockApi, noContent } from "../test/mock-api";
import { queryWrapper, testQueryClient } from "../test/render";
import { FolderActions } from "./FolderActions";

const FOLDER: FolderItem = { id: "f1", name: "Fotos", parentId: null, createdAt: 0 };
const TREE = [
  FOLDER,
  { id: "f2", name: "Docs", parentId: null, createdAt: 0 },
  { id: "f3", name: "Férias", parentId: "f1", createdAt: 0 },
];

async function openMenu(item: string) {
  const user = userEvent.setup();
  const Wrapper = queryWrapper(testQueryClient());
  render(
    <Wrapper>
      <FolderActions folder={FOLDER} />
    </Wrapper>,
  );
  await user.click(screen.getByRole("button", { name: "Ações para a pasta Fotos" }));
  await user.click(screen.getByRole("menuitem", { name: item }));
  return user;
}

describe("FolderActions", () => {
  it("renomear: envia o novo nome e fecha o diálogo", async () => {
    const server = mockApi({
      "PATCH /api/folders/:id": () => json({ folder: { ...FOLDER, name: "Álbuns" } }),
    });
    const user = await openMenu("Renomear");
    expect(screen.getByLabelText("Nome da pasta")).toHaveValue("Fotos");
    await user.clear(screen.getByLabelText("Nome da pasta"));
    await user.type(screen.getByLabelText("Nome da pasta"), "Álbuns");
    await user.click(screen.getByRole("button", { name: "Renomear" }));

    await screen.findByRole("button", { name: "Ações para a pasta Fotos" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.callsTo("PATCH /api/folders/:id")[0]).toMatchObject({ params: { id: "f1" }, body: { name: "Álbuns" } });
  });

  it("renomear para um nome que já existe mostra o erro e o diálogo fica aberto", async () => {
    mockApi({
      "PATCH /api/folders/:id": () => apiError(409, "name_taken", "Já existe uma pasta com esse nome neste local."),
    });
    const user = await openMenu("Renomear");
    await user.type(screen.getByLabelText("Nome da pasta"), "x");
    await user.click(screen.getByRole("button", { name: "Renomear" }));
    expect(await screen.findByText("Já existe uma pasta com esse nome neste local.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Renomear pasta" })).toBeInTheDocument();
  });

  it("mover: o diálogo não deixa escolher a própria pasta nem as suas subpastas e envia o destino", async () => {
    const server = mockApi({
      "GET /api/folders/tree": () => json({ folders: TREE }),
      "PATCH /api/folders/:id": () => json({ folder: { ...FOLDER, parentId: "f2" } }),
    });
    const user = await openMenu("Mover…");
    await screen.findByRole("combobox", { name: "Pasta de destino" });
    expect(screen.getByRole("option", { name: /Fotos/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: /Férias/ })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox"), "f2");
    await user.click(screen.getByRole("button", { name: "Mover" }));

    await screen.findByRole("button", { name: "Ações para a pasta Fotos" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.callsTo("PATCH /api/folders/:id")[0].body).toEqual({ parentId: "f2" });
  });

  it("excluir: confirma e apaga a pasta", async () => {
    const server = mockApi({ "DELETE /api/folders/:id": () => noContent() });
    const user = await openMenu("Excluir");
    expect(screen.getByRole("dialog", { name: "Excluir pasta" })).toHaveTextContent("Só é possível se estiver vazia.");
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    await screen.findByRole("button", { name: "Ações para a pasta Fotos" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.callsTo("DELETE /api/folders/:id")[0].params.id).toBe("f1");
  });

  it("excluir uma pasta com conteúdo mostra o erro do servidor e o diálogo fica aberto", async () => {
    mockApi({
      "DELETE /api/folders/:id": () =>
        apiError(409, "folder_not_empty", "A pasta não está vazia. Mova ou exclua primeiro o conteúdo."),
    });
    const user = await openMenu("Excluir");
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A pasta não está vazia.");
    expect(screen.getByRole("dialog", { name: "Excluir pasta" })).toBeInTheDocument();
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/FolderActions.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/components/FolderActions.tsx`:

```tsx
import { useState } from "react";
import type { FolderItem } from "../../shared/types";
import { errorMessage } from "../api";
import { useDeleteFolder, useUpdateFolder } from "../space";
import { ConfirmDialog } from "./ConfirmDialog";
import { MoveDialog } from "./MoveDialog";
import { NameDialog } from "./NameDialog";
import { RowMenu, type MenuAction } from "./RowMenu";

type Dialog = "rename" | "move" | "delete";

/** O menu «⋮» de uma pasta e os diálogos das suas ações (renomear, mover e excluir). */
export function FolderActions({ folder }: { folder: FolderItem }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const update = useUpdateFolder();
  const remove = useDeleteFolder();

  function close() {
    setDialog(null);
    update.reset();
    remove.reset();
  }

  const actions: MenuAction[] = [
    { label: "Renomear", onSelect: () => setDialog("rename") },
    { label: "Mover…", onSelect: () => setDialog("move") },
    { label: "Excluir", danger: true, onSelect: () => setDialog("delete") },
  ];
  const updateError = update.error ? errorMessage(update.error) : null;

  return (
    <>
      <RowMenu label={`Ações para a pasta ${folder.name}`} actions={actions} />
      {dialog === "rename" && (
        <NameDialog
          title="Renomear pasta"
          label="Nome da pasta"
          initialValue={folder.name}
          confirmLabel="Renomear"
          pending={update.isPending}
          error={updateError}
          onSubmit={(name) => update.mutate({ id: folder.id, name }, { onSuccess: close })}
          onClose={close}
        />
      )}
      {dialog === "move" && (
        <MoveDialog
          title={`Mover a pasta ${folder.name}`}
          currentFolderId={folder.parentId}
          movingFolderId={folder.id}
          pending={update.isPending}
          error={updateError}
          onSubmit={(parentId) => update.mutate({ id: folder.id, parentId }, { onSuccess: close })}
          onClose={close}
        />
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title="Excluir pasta"
          message={`Excluir a pasta «${folder.name}»? Só é possível se estiver vazia.`}
          confirmLabel="Excluir"
          pending={remove.isPending}
          error={remove.error ? errorMessage(remove.error) : null}
          onConfirm={() => remove.mutate(folder.id, { onSuccess: close })}
          onClose={close}
        />
      )}
    </>
  );
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/FolderActions.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  5 passed (5)`.

- [ ] **Step 3: `FileActions` (teste primeiro)**

Criar `src/web/components/FileActions.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FileItem } from "../../shared/types";
import { apiError, json, mockApi, noContent } from "../test/mock-api";
import { queryWrapper, testQueryClient } from "../test/render";
import { FileActions } from "./FileActions";

const FILE: FileItem = { id: "a1", name: "relatório.pdf", folderId: "f1", size: 10, mime: "application/pdf", createdAt: 0 };
const TREE = [
  { id: "f1", name: "Fotos", parentId: null, createdAt: 0 },
  { id: "f2", name: "Docs", parentId: null, createdAt: 0 },
];
const MENU = "Ações para o ficheiro relatório.pdf";

function setup() {
  const user = userEvent.setup();
  const Wrapper = queryWrapper(testQueryClient());
  render(
    <Wrapper>
      <FileActions file={FILE} />
    </Wrapper>,
  );
  return user;
}

async function choose(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(screen.getByRole("button", { name: MENU }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

describe("FileActions", () => {
  it("o menu tem Descarregar (uma ligação para o servidor), Renomear, Mover e Excluir", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: MENU }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Descarregar", "Renomear", "Mover…", "Excluir"]);
    expect(screen.getByRole("menuitem", { name: "Descarregar" })).toHaveAttribute("href", "/api/files/a1/download");
  });

  it("renomear: envia o novo nome", async () => {
    const server = mockApi({ "PATCH /api/files/:id": () => json({ file: { ...FILE, name: "final.pdf" } }) });
    const user = setup();
    await choose(user, "Renomear");
    await user.clear(screen.getByLabelText("Nome do ficheiro"));
    await user.type(screen.getByLabelText("Nome do ficheiro"), "final.pdf");
    await user.click(screen.getByRole("button", { name: "Renomear" }));
    await screen.findByRole("button", { name: MENU });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.callsTo("PATCH /api/files/:id")[0]).toMatchObject({ params: { id: "a1" }, body: { name: "final.pdf" } });
  });

  it("mover: a pasta atual está desativada e o destino vai como `folderId`", async () => {
    const server = mockApi({
      "GET /api/folders/tree": () => json({ folders: TREE }),
      "PATCH /api/files/:id": () => json({ file: { ...FILE, folderId: null } }),
    });
    const user = setup();
    await choose(user, "Mover…");
    await screen.findByRole("combobox", { name: "Pasta de destino" });
    expect(screen.getByRole("option", { name: /Fotos/ })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox"), "root");
    await user.click(screen.getByRole("button", { name: "Mover" }));
    await screen.findByRole("button", { name: MENU });
    expect(server.callsTo("PATCH /api/files/:id")[0].body).toEqual({ folderId: null });
  });

  it("mover para uma pasta onde já há um ficheiro com esse nome mostra o erro", async () => {
    mockApi({
      "GET /api/folders/tree": () => json({ folders: TREE }),
      "PATCH /api/files/:id": () => apiError(409, "name_taken", "Já existe um ficheiro com esse nome neste local (pode ser um envio ainda em curso)."),
    });
    const user = setup();
    await choose(user, "Mover…");
    await user.selectOptions(await screen.findByRole("combobox"), "f2");
    await user.click(screen.getByRole("button", { name: "Mover" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("pode ser um envio ainda em curso");
  });

  it("excluir: pede confirmação, avisa que vai para a lixeira e apaga", async () => {
    const server = mockApi({ "DELETE /api/files/:id": () => noContent() });
    const user = setup();
    await choose(user, "Excluir");
    expect(screen.getByRole("dialog", { name: "Excluir ficheiro" })).toHaveTextContent("Vai para a lixeira.");
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    await screen.findByRole("button", { name: MENU });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.callsTo("DELETE /api/files/:id")[0].params.id).toBe("a1");
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/FileActions.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/components/FileActions.tsx`:

```tsx
import { useState } from "react";
import type { FileItem } from "../../shared/types";
import { errorMessage } from "../api";
import { useDeleteFile, useUpdateFile } from "../space";
import { ConfirmDialog } from "./ConfirmDialog";
import { MoveDialog } from "./MoveDialog";
import { NameDialog } from "./NameDialog";
import { RowMenu, type MenuAction } from "./RowMenu";

type Dialog = "rename" | "move" | "delete";

/** O menu «⋮» de um ficheiro: descarregar e os diálogos de renomear, mover e excluir. */
export function FileActions({ file }: { file: FileItem }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const update = useUpdateFile();
  const remove = useDeleteFile();

  function close() {
    setDialog(null);
    update.reset();
    remove.reset();
  }

  const actions: MenuAction[] = [
    { label: "Descarregar", href: `/api/files/${encodeURIComponent(file.id)}/download` },
    { label: "Renomear", onSelect: () => setDialog("rename") },
    { label: "Mover…", onSelect: () => setDialog("move") },
    { label: "Excluir", danger: true, onSelect: () => setDialog("delete") },
  ];
  const updateError = update.error ? errorMessage(update.error) : null;

  return (
    <>
      <RowMenu label={`Ações para o ficheiro ${file.name}`} actions={actions} />
      {dialog === "rename" && (
        <NameDialog
          title="Renomear ficheiro"
          label="Nome do ficheiro"
          initialValue={file.name}
          confirmLabel="Renomear"
          pending={update.isPending}
          error={updateError}
          onSubmit={(name) => update.mutate({ id: file.id, name }, { onSuccess: close })}
          onClose={close}
        />
      )}
      {dialog === "move" && (
        <MoveDialog
          title={`Mover o ficheiro ${file.name}`}
          currentFolderId={file.folderId}
          pending={update.isPending}
          error={updateError}
          onSubmit={(folderId) => update.mutate({ id: file.id, folderId }, { onSuccess: close })}
          onClose={close}
        />
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title="Excluir ficheiro"
          message={`Excluir o ficheiro «${file.name}»? Vai para a lixeira.`}
          confirmLabel="Excluir"
          pending={remove.isPending}
          error={remove.error ? errorMessage(remove.error) : null}
          onConfirm={() => remove.mutate(file.id, { onSuccess: close })}
          onClose={close}
        />
      )}
    </>
  );
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/FileActions.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  5 passed (5)`.

- [ ] **Step 4: Pôr os menus nas linhas (teste de integração primeiro)**

Em `src/web/pages/FolderPage.test.tsx`, substituir o bloco de `import` no topo do ficheiro (todas as linhas de `import`, até à linha em branco) por:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FolderContents } from "../../shared/types";
import { apiError, json, ME, mockApi, noContent, SESSION } from "../test/mock-api";
import { renderApp } from "../test/render";
```

Acrescentar ao fim de `src/web/pages/FolderPage.test.tsx`:

```tsx
describe("FolderPage: ações das linhas", () => {
  it("renomear uma pasta atualiza a lista", async () => {
    let name = "Fotos";
    mockApi({
      ...SESSION,
      "GET /api/folders/:id/contents": () => json({ ...ROOT, folders: [{ ...ROOT.folders[0], name }] }),
      "PATCH /api/folders/:id": ({ body }) => {
        name = (body as { name: string }).name;
        return json({ folder: { ...ROOT.folders[0], name } });
      },
    });
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Ações para a pasta Fotos" }));
    await user.click(screen.getByRole("menuitem", { name: "Renomear" }));
    await user.clear(screen.getByLabelText("Nome da pasta"));
    await user.type(screen.getByLabelText("Nome da pasta"), "Álbuns");
    await user.click(screen.getByRole("button", { name: "Renomear" }));
    expect(await screen.findByRole("link", { name: "Álbuns" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Fotos" })).not.toBeInTheDocument();
  });

  it("excluir um ficheiro tira-o da lista e atualiza o espaço usado", async () => {
    let deleted = false;
    mockApi({
      ...SESSION,
      "GET /api/auth/me": () => json({ user: { ...ME, usedBytes: deleted ? 0 : 1536 } }),
      "GET /api/folders/:id/contents": () => json(deleted ? { ...ROOT, files: [] } : ROOT),
      "DELETE /api/files/:id": () => {
        deleted = true;
        return noContent();
      },
    });
    const user = userEvent.setup();
    renderApp("/");
    expect(await screen.findByText("1,5 KB de 1 GB")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Ações para o ficheiro relatório.pdf" }));
    await user.click(screen.getByRole("menuitem", { name: "Excluir" }));
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(screen.queryByText("relatório.pdf")).not.toBeInTheDocument());
    expect(await screen.findByText("0 B de 1 GB")).toBeInTheDocument();
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/pages/FolderPage.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  2 failed | 10 passed (12)).

Em `src/web/components/ItemRows.tsx`, substituir o bloco de `import` no topo do ficheiro (todas as linhas de `import`, até à linha em branco) por:

```tsx
import type { ReactNode } from "react";
import { Link } from "react-router";
import { formatBytes, formatDate } from "../../shared/format";
import type { FileItem, FolderItem } from "../../shared/types";
import { FileActions } from "./FileActions";
import { FolderActions } from "./FolderActions";
import { FileIcon, FolderIcon } from "./icons";
```

Em `src/web/components/ItemRows.tsx`, em `FolderRow`, trocar:

```tsx
      date={formatDate(folder.createdAt)}
    />
```

por:

```tsx
      date={formatDate(folder.createdAt)}
      actions={<FolderActions folder={folder} />}
    />
```

Em `FileRow`, trocar:

```tsx
      date={formatDate(file.createdAt)}
    />
```

por:

```tsx
      date={formatDate(file.createdAt)}
      actions={<FileActions file={file} />}
    />
```

Run: `npx vitest run -c vitest.web.config.ts src/web/pages/FolderPage.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  12 passed (12)`.

- [ ] **Step 5: Verificação e commit**

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  17 passed (17)`, `Tests  99 passed (99)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src
git commit -m "Acrescenta as ações de renomear, mover, excluir e descarregar às linhas" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Envio de ficheiros na interface (botão e arrastar-e-largar) e pré-visualização

**Files:**
- Create: `src/web/dropped-files.ts`, `src/web/uploads-context.tsx`, `src/web/components/UploadPanel.tsx`, `src/web/components/PreviewDialog.tsx` e o `.test.ts(x)` de cada um
- Modify: `src/web/pages/FolderPage.tsx`, `src/web/pages/FolderPage.test.tsx`, `src/web/components/ItemRows.tsx`, `src/web/components/FileActions.tsx`, `src/web/components/FileActions.test.tsx`, `src/web/components/AppLayout.tsx`, `src/web/test/mock-api.ts`

**Interfaces:**
- Consumes: `UploadManager`/`UploadItem` (Task 4), `useConfig`/`useRefreshSpace` (Task 3), `previewContentType` (Task 1), `Modal`/`Message`/`Button` (Tasks 5 e Plano 1),
  `FileActions`/`ItemRows` (Tasks 6 e 7), `stubXhr` (Task 4).
- Produces: `filesFromDrop(dataTransfer) → { files, skippedFolders }`; `UploadsProvider` e `useUploads() → { items, add(files, folderId | null), cancel(id), clearFinished() }`;
  `UploadPanel` (painel fixo com os envios); `PreviewDialog({ file, onClose })` (imagem em `<img>`, PDF em `<iframe>`);
  `FileActions({ file, onPreview? })` com «Pré-visualizar» quando `onPreview` existe; a página tem «Carregar ficheiros» e aceita ficheiros largados.

- [ ] **Step 1: `filesFromDrop` (teste primeiro)**

Criar `src/web/dropped-files.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filesFromDrop } from "./dropped-files";

const file = (name: string) => new File(["x"], name);

/** Um item do arrastar-e-largar: ficheiro, pasta ou texto. */
const item = (kind: "file" | "string", options: { file?: File; directory?: boolean } = {}) => ({
  kind,
  getAsFile: () => options.file ?? null,
  webkitGetAsEntry: () => ({ isDirectory: options.directory === true }),
});

const drop = (items: ReturnType<typeof item>[]) => ({ items }) as unknown as DataTransfer;

describe("filesFromDrop", () => {
  it("devolve os ficheiros e conta as pastas que ficam de fora", () => {
    const a = file("a.txt");
    const b = file("b.txt");
    const result = filesFromDrop(
      drop([item("file", { file: a }), item("file", { directory: true }), item("file", { file: b })]),
    );
    expect(result).toEqual({ files: [a, b], skippedFolders: 1 });
  });

  it("ignora o que não é um ficheiro (texto arrastado)", () => {
    expect(filesFromDrop(drop([item("string")]))).toEqual({ files: [], skippedFolders: 0 });
  });

  it("serve num browser sem `webkitGetAsEntry`", () => {
    const a = file("a.txt");
    const bare = { kind: "file", getAsFile: () => a };
    expect(filesFromDrop({ items: [bare] } as unknown as DataTransfer)).toEqual({ files: [a], skippedFolders: 0 });
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/dropped-files.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/dropped-files.ts`:

```ts
export interface DroppedFiles {
  files: File[];
  /** Quantas pastas vieram no que se largou (não se enviam pastas, só ficheiros). */
  skippedFolders: number;
}

/** Separa os ficheiros das pastas num arrastar-e-largar (uma pasta, como `File`, não se consegue ler). */
export function filesFromDrop(data: DataTransfer): DroppedFiles {
  const files: File[] = [];
  let skippedFolders = 0;
  for (const item of [...data.items]) {
    if (item.kind !== "file") continue;
    // `webkitGetAsEntry` existe em todos os browsers atuais (apesar do nome) e distingue uma pasta de um ficheiro.
    if (item.webkitGetAsEntry?.()?.isDirectory) {
      skippedFolders++;
      continue;
    }
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return { files, skippedFolders };
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/dropped-files.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  3 passed (3)`.

- [ ] **Step 2: `UploadsProvider` e `useUploads` (teste primeiro)**

A fila fica num *provider* na área autenticada, por isso um envio continua se o utilizador mudar de pasta. Quando um envio termina atualiza listagens e quota; enquanto houver envios, o browser avisa antes de fechar o separador.

Criar `src/web/uploads-context.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { useMe } from "./auth";
import { useConfig } from "./space";
import { useUploads, UploadsProvider } from "./uploads-context";
import { stubXhr } from "./test/fake-xhr";
import { json, ME, mockApi } from "./test/mock-api";
import { queryWrapper, testQueryClient } from "./test/render";

const FILE_ITEM = { id: "f1", name: "a.txt", folderId: null, size: 3, mime: "text/plain", createdAt: 1 };

function setup(maxUploadBytes = 1000) {
  const Xhr = stubXhr();
  let usedBytes = 0;
  const server = mockApi({
    "GET /api/config": () => json({ maxUploadBytes }),
    "GET /api/auth/me": () => json({ user: { ...ME, usedBytes } }),
  });
  const Query = queryWrapper(testQueryClient());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Query>
      <UploadsProvider>{children}</UploadsProvider>
    </Query>
  );
  const hook = renderHook(() => ({ uploads: useUploads(), me: useMe(), config: useConfig() }), { wrapper });
  return { hook, server, Xhr, setUsed: (bytes: number) => (usedBytes = bytes) };
}

const isBlocked = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe("UploadsProvider", () => {
  it("envia, mostra o estado e, quando termina, atualiza o espaço usado", async () => {
    const { hook, Xhr, setUsed } = setup();
    await waitFor(() => expect(hook.result.current.me.data?.usedBytes).toBe(0));

    act(() => hook.result.current.uploads.add([new File(["abc"], "a.txt")], "pasta-1"));
    expect(Xhr.instances[0].url).toBe("/api/files?name=a.txt&folder=pasta-1");
    expect(hook.result.current.uploads.items[0]).toMatchObject({ name: "a.txt", status: "uploading" });

    setUsed(3);
    act(() => Xhr.instances[0].respond(201, { file: FILE_ITEM }));
    await waitFor(() => expect(hook.result.current.uploads.items[0].status).toBe("done"));
    await waitFor(() => expect(hook.result.current.me.data?.usedBytes).toBe(3));
  });

  it("recusa logo um ficheiro acima do limite do servidor (GET /api/config), sem o enviar", async () => {
    const { hook, Xhr } = setup(2);
    await waitFor(() => expect(hook.result.current.config.data).toEqual({ maxUploadBytes: 2 }));

    act(() => hook.result.current.uploads.add([new File(["abc"], "grande.txt")], null));

    expect(hook.result.current.uploads.items[0]).toMatchObject({
      status: "error",
      message: "O ficheiro excede o limite de 2 B.",
    });
    expect(Xhr.instances).toHaveLength(0);
  });

  it("avisa antes de fechar o separador enquanto há envios, e só então", async () => {
    const { hook, Xhr } = setup();
    expect(isBlocked()).toBe(false);
    act(() => hook.result.current.uploads.add([new File(["abc"], "a.txt")], null));
    await waitFor(() => expect(isBlocked()).toBe(true));
    act(() => Xhr.instances[0].respond(201, { file: FILE_ITEM }));
    await waitFor(() => expect(isBlocked()).toBe(false));
  });

  it("`useUploads` fora do provider é um erro claro", () => {
    expect(() => renderHook(() => useUploads())).toThrow("UploadsProvider");
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/uploads-context.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/uploads-context.tsx`:

```tsx
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useConfig, useRefreshSpace } from "./space";
import { UploadManager, type UploadItem } from "./uploads";

interface UploadsApi {
  items: readonly UploadItem[];
  /** Põe ficheiros na fila para a pasta indicada (`null` = raiz). */
  add: (files: File[], folderId: string | null) => void;
  cancel: (id: string) => void;
  clearFinished: () => void;
}

const UploadsContext = createContext<UploadsApi | null>(null);

/**
 * Dá a toda a área autenticada a mesma fila de envios, por isso um envio continua quando se muda de pasta. Atualiza
 * as listagens e a quota sempre que um envio termina, e avisa antes de fechar o separador enquanto há envios.
 */
export function UploadsProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const refresh = useRefreshSpace();
  // A fila é criada uma só vez: lê estes valores, sempre os mais recentes, quando precisa deles.
  const latest = useRef({ maxUploadBytes: Infinity, refresh });
  useEffect(() => {
    latest.current = { maxUploadBytes: config.data?.maxUploadBytes ?? Infinity, refresh };
  });
  const [manager] = useState(
    () =>
      new UploadManager({
        maxUploadBytes: () => latest.current.maxUploadBytes,
        onSettled: () => void latest.current.refresh(),
      }),
  );
  const items = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const busy = items.some((item) => item.status === "queued" || item.status === "uploading");

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const api = useMemo(
    () => ({ items, add: manager.add, cancel: manager.cancel, clearFinished: manager.clearFinished }),
    [items, manager],
  );
  return <UploadsContext.Provider value={api}>{children}</UploadsContext.Provider>;
}

export function useUploads(): UploadsApi {
  const api = useContext(UploadsContext);
  if (!api) throw new Error("useUploads só funciona dentro de um UploadsProvider.");
  return api;
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/uploads-context.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  4 passed (4)`.

- [ ] **Step 3: `UploadPanel` (teste primeiro)**

Criar `src/web/components/UploadPanel.test.tsx`:

```tsx
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { UploadsProvider, useUploads } from "../uploads-context";
import { stubXhr } from "../test/fake-xhr";
import { apiError, json, mockApi } from "../test/mock-api";
import { queryWrapper, testQueryClient } from "../test/render";
import { UploadPanel } from "./UploadPanel";

const FILE_ITEM = { id: "f1", name: "a.txt", folderId: null, size: 10, mime: "text/plain", createdAt: 1 };

function Adder({ names }: { names: string[] }) {
  const { add } = useUploads();
  return <button onClick={() => add(names.map((name) => new File(["x".repeat(10)], name)), null)}>Adicionar</button>;
}

function setup(names: string[]) {
  const Xhr = stubXhr();
  mockApi({ "GET /api/config": () => json({ maxUploadBytes: 1000 }), "GET /api/auth/me": () => apiError(401, "unauthorized", "x") });
  const Query = queryWrapper(testQueryClient());
  render(
    <Query>
      <UploadsProvider>
        <Adder names={names} />
        <UploadPanel />
      </UploadsProvider>
    </Query>,
  );
  return { Xhr, user: userEvent.setup() };
}

describe("UploadPanel", () => {
  it("não aparece quando não há envios", () => {
    setup([]);
    expect(screen.queryByRole("region", { name: "Envios" })).not.toBeInTheDocument();
  });

  it("mostra o progresso de um envio e depois «Concluído»", async () => {
    const { Xhr, user } = setup(["a.txt"]);
    await user.click(screen.getByRole("button", { name: "Adicionar" }));
    const panel = screen.getByRole("region", { name: "Envios" });
    expect(within(panel).getByText("A enviar 1 ficheiro…")).toBeInTheDocument();

    act(() => Xhr.instances[0].progress(5, 10));
    expect(within(panel).getByRole("progressbar", { name: "Envio de a.txt" })).toHaveAttribute("aria-valuenow", "50");

    act(() => Xhr.instances[0].respond(201, { file: FILE_ITEM }));
    expect(await within(panel).findByText("Concluído")).toBeInTheDocument();
    expect(within(panel).getByText("Envios terminados")).toBeInTheDocument();
  });

  it("os ficheiros a mais ficam «Em espera» e dá para cancelar", async () => {
    const { Xhr, user } = setup(["a", "b", "c", "d"]);
    await user.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(Xhr.instances).toHaveLength(3);
    expect(screen.getByText("Em espera")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancelar o envio de d" }));
    expect(screen.queryByText("Em espera")).not.toBeInTheDocument();
    expect(screen.getByText("A enviar 3 ficheiros…")).toBeInTheDocument();
  });

  it("mostra o erro de um envio e «Limpar» tira os terminados", async () => {
    const { Xhr, user } = setup(["a.txt"]);
    await user.click(screen.getByRole("button", { name: "Adicionar" }));
    act(() =>
      Xhr.instances[0].respond(409, { error: "name_taken", message: "Já existe um ficheiro com esse nome neste local." }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe um ficheiro com esse nome neste local.");
    await user.click(screen.getByRole("button", { name: "Limpar" }));
    expect(screen.queryByRole("region", { name: "Envios" })).not.toBeInTheDocument();
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/UploadPanel.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/components/UploadPanel.tsx`:

```tsx
import { useUploads } from "../uploads-context";
import type { UploadItem } from "../uploads";

function UploadRow({ item, onCancel }: { item: UploadItem; onCancel: () => void }) {
  const percent = item.size > 0 ? Math.min(100, Math.round((item.loaded / item.size) * 100)) : 0;
  const running = item.status === "queued" || item.status === "uploading";
  return (
    <li className="px-4 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate" title={item.name}>
          {item.name}
        </span>
        {running && (
          <button
            type="button"
            aria-label={`Cancelar o envio de ${item.name}`}
            onClick={onCancel}
            className="shrink-0 rounded px-1 text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        )}
      </div>
      {item.status === "queued" && <p className="text-xs text-slate-500">Em espera</p>}
      {item.status === "uploading" && (
        <div
          role="progressbar"
          aria-label={`Envio de ${item.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200"
        >
          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${percent}%` }} />
        </div>
      )}
      {item.status === "done" && <p className="text-xs text-emerald-700">Concluído</p>}
      {item.status === "error" && (
        <p role="alert" className="text-xs text-red-700">
          {item.message}
        </p>
      )}
    </li>
  );
}

/** Painel fixo no canto com os envios (em espera, a decorrer, concluídos ou com erro). Não aparece sem envios. */
export function UploadPanel() {
  const { items, cancel, clearFinished } = useUploads();
  if (items.length === 0) return null;
  const running = items.filter((item) => item.status === "queued" || item.status === "uploading").length;
  const title = running > 0 ? `A enviar ${running} ${running === 1 ? "ficheiro" : "ficheiros"}…` : "Envios terminados";

  return (
    <section
      aria-label="Envios"
      className="fixed right-4 bottom-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-lg"
    >
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {running < items.length && (
          <button type="button" onClick={clearFinished} className="text-xs font-medium text-indigo-600 hover:underline">
            Limpar
          </button>
        )}
      </header>
      <ul className="max-h-64 divide-y divide-slate-100 overflow-auto">
        {items.map((item) => (
          <UploadRow key={item.id} item={item} onCancel={() => cancel(item.id)} />
        ))}
      </ul>
    </section>
  );
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/UploadPanel.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  4 passed (4)`.

- [ ] **Step 4: `PreviewDialog` (teste primeiro)**

Criar `src/web/components/PreviewDialog.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FileItem } from "../../shared/types";
import { PreviewDialog } from "./PreviewDialog";

const file = (name: string): FileItem => ({ id: "a 1", name, folderId: null, size: 10, mime: "x/y", createdAt: 0 });

describe("PreviewDialog", () => {
  it("mostra uma imagem com o nome como texto alternativo", () => {
    render(<PreviewDialog file={file("foto.PNG")} onClose={() => undefined} />);
    expect(screen.getByRole("dialog", { name: "foto.PNG" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "foto.PNG" })).toHaveAttribute("src", "/api/files/a%201/preview");
  });

  it("mostra um PDF numa moldura", () => {
    render(<PreviewDialog file={file("relatório.pdf")} onClose={() => undefined} />);
    expect(screen.getByTitle("Pré-visualização de relatório.pdf")).toHaveAttribute("src", "/api/files/a%201/preview");
  });

  it("oferece sempre Descarregar e Fechar", async () => {
    const onClose = vi.fn();
    render(<PreviewDialog file={file("foto.jpg")} onClose={onClose} />);
    expect(screen.getByRole("link", { name: "Descarregar" })).toHaveAttribute("href", "/api/files/a%201/download");
    await userEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("se a imagem não carregar, diz isso em vez de mostrar uma imagem partida", () => {
    render(<PreviewDialog file={file("foto.png")} onClose={() => undefined} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar a pré-visualização.");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("um tipo sem pré-visualização (nunca deveria chegar aqui) dá um aviso", () => {
    render(<PreviewDialog file={file("notas.txt")} onClose={() => undefined} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Este tipo de ficheiro não tem pré-visualização.");
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/PreviewDialog.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/components/PreviewDialog.tsx`:

```tsx
import { useState } from "react";
import { previewContentType } from "../../shared/preview";
import type { FileItem } from "../../shared/types";
import { Button } from "./Button";
import { Message } from "./Message";
import { Modal } from "./Modal";

/**
 * Pré-visualização de uma imagem (`<img>`) ou de um PDF (`<iframe>`), servida por `/api/files/:id/preview`, que só aceita
 * estes tipos. Só se abre ao clicar (não há miniaturas: a API responde com `no-store`, por isso cada miniatura seria um
 * pedido novo a cada listagem).
 */
export function PreviewDialog({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  const type = previewContentType(file.name);
  const id = encodeURIComponent(file.id);

  return (
    <Modal title={file.name} onClose={onClose} wide>
      {type === null || failed ? (
        <Message kind="error">
          {type === null ? "Este tipo de ficheiro não tem pré-visualização." : "Não foi possível carregar a pré-visualização."}
        </Message>
      ) : type.startsWith("image/") ? (
        <img
          src={`/api/files/${id}/preview`}
          alt={file.name}
          onError={() => setFailed(true)}
          className="mx-auto max-h-[70vh] max-w-full object-contain"
        />
      ) : (
        <iframe
          src={`/api/files/${id}/preview`}
          title={`Pré-visualização de ${file.name}`}
          className="h-[70vh] w-full rounded-lg border border-slate-200"
        />
      )}
      <div className="mt-4 flex justify-end gap-2">
        <a
          href={`/api/files/${id}/download`}
          className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Descarregar
        </a>
        <Button onClick={onClose}>Fechar</Button>
      </div>
    </Modal>
  );
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/PreviewDialog.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  5 passed (5)`.

- [ ] **Step 5: Ligar tudo à página (testes de integração primeiro)**

A página ganha «Carregar ficheiros» e a zona de largar; o nome de um ficheiro com pré-visualização passa a ser um botão que a abre; o layout monta o `UploadsProvider` e o painel. Não há miniaturas na lista: a API responde com `no-store`, por isso cada miniatura seria um pedido novo a cada listagem.

Em `src/web/test/mock-api.ts`, trocar:

```ts
export const SESSION = { "GET /api/auth/me": () => json({ user: ME }) };
```

por:

```ts
export const SESSION = {
  "GET /api/auth/me": () => json({ user: ME }),
  "GET /api/config": () => json({ maxUploadBytes: 104_857_600 }),
};
```

Em `src/web/components/FileActions.test.tsx`, substituir o bloco de `import` no topo do ficheiro (todas as linhas de `import`, até à linha em branco) por:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FileItem } from "../../shared/types";
import { apiError, json, mockApi, noContent } from "../test/mock-api";
import { queryWrapper, testQueryClient } from "../test/render";
import { FileActions } from "./FileActions";
```

Acrescentar ao fim de `src/web/components/FileActions.test.tsx`:

```tsx
describe("FileActions: pré-visualizar", () => {
  it("«Pré-visualizar» só aparece quando a linha o pede, e é a primeira ação", async () => {
    const onPreview = vi.fn();
    const Wrapper = queryWrapper(testQueryClient());
    render(
      <Wrapper>
        <FileActions file={FILE} onPreview={onPreview} />
      </Wrapper>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: MENU }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Pré-visualizar",
      "Descarregar",
      "Renomear",
      "Mover…",
      "Excluir",
    ]);
    await user.click(screen.getByRole("menuitem", { name: "Pré-visualizar" }));
    expect(onPreview).toHaveBeenCalledTimes(1);
  });
});
```

Em `src/web/pages/FolderPage.test.tsx`, substituir o bloco de `import` no topo do ficheiro (todas as linhas de `import`, até à linha em branco) por:

```tsx
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FolderContents } from "../../shared/types";
import { CONFIG_KEY } from "../space";
import { stubXhr } from "../test/fake-xhr";
import { apiError, json, ME, mockApi, noContent, SESSION } from "../test/mock-api";
import { renderApp } from "../test/render";
```

Em `src/web/pages/FolderPage.test.tsx`, a pasta vazia passa a explicar como enviar ficheiros: trocar:

```tsx
expect(screen.getByText("Esta pasta está vazia.")).toBeInTheDocument();
```

por:

```tsx
expect(
      screen.getByText("Esta pasta está vazia. Arraste ficheiros para aqui ou use «Carregar ficheiros»."),
    ).toBeInTheDocument();
```

Acrescentar ao fim de `src/web/pages/FolderPage.test.tsx`:

```tsx
describe("FolderPage: envio e pré-visualização", () => {
  const NEW_FILE = { id: "n1", name: "nota.txt", folderId: "f1", size: 10, mime: "text/plain", createdAt: CREATED };

  function serve(overrides: Parameters<typeof mockApi>[0] = {}) {
    let uploaded = false;
    const server = mockApi({
      ...SESSION,
      "GET /api/folders/:id/contents": () => json(uploaded ? { ...FOTOS, files: [NEW_FILE] } : FOTOS),
      ...overrides,
    });
    return { server, markUploaded: () => (uploaded = true) };
  }

  it("«Carregar ficheiros» envia para a pasta atual, mostra o progresso e a lista atualiza-se no fim", async () => {
    const Xhr = stubXhr();
    const { markUploaded } = serve();
    const user = userEvent.setup();
    renderApp("/pasta/f1");
    await screen.findByRole("heading", { name: "Fotos" });

    await user.upload(screen.getByLabelText("Escolher ficheiros"), new File(["0123456789"], "nota.txt", { type: "text/plain" }));
    expect(Xhr.instances[0].url).toBe("/api/files?name=nota.txt&folder=f1");
    act(() => Xhr.instances[0].progress(5, 10));
    expect(await screen.findByRole("progressbar", { name: "Envio de nota.txt" })).toHaveAttribute("aria-valuenow", "50");

    markUploaded();
    act(() => Xhr.instances[0].respond(201, { file: NEW_FILE }));
    expect(await screen.findByText("Concluído")).toBeInTheDocument();
    expect(await screen.findByText("nota.txt", { selector: "span" })).toBeInTheDocument();
  });

  it("arrastar e largar ficheiros envia-os para a pasta atual", async () => {
    const Xhr = stubXhr();
    serve();
    renderApp("/pasta/f1");
    const heading = await screen.findByRole("heading", { name: "Fotos" });
    const dropped = new File(["x"], "solta.png");
    const dataTransfer = {
      types: ["Files"],
      items: [{ kind: "file", getAsFile: () => dropped, webkitGetAsEntry: () => ({ isDirectory: false }) }],
    };

    fireEvent.dragEnter(heading, { dataTransfer });
    fireEvent.drop(heading, { dataTransfer });

    expect(Xhr.instances[0].url).toBe("/api/files?name=solta.png&folder=f1");
  });

  it("arrastar uma pasta avisa que as pastas não se enviam", async () => {
    const Xhr = stubXhr();
    serve();
    renderApp("/pasta/f1");
    const heading = await screen.findByRole("heading", { name: "Fotos" });
    const dataTransfer = {
      types: ["Files"],
      items: [{ kind: "file", getAsFile: () => new File([""], "Pasta"), webkitGetAsEntry: () => ({ isDirectory: true }) }],
    };

    fireEvent.drop(heading, { dataTransfer });

    expect(screen.getByText("As pastas não se enviam: arraste os ficheiros.")).toBeInTheDocument();
    expect(Xhr.instances).toHaveLength(0);
  });

  it("um ficheiro acima do limite do servidor nem é enviado", async () => {
    const Xhr = stubXhr();
    serve({ "GET /api/config": () => json({ maxUploadBytes: 5 }) });
    const user = userEvent.setup();
    const { client } = renderApp("/pasta/f1");
    await screen.findByRole("heading", { name: "Fotos" });
    await waitFor(() => expect(client.getQueryData(CONFIG_KEY)).toEqual({ maxUploadBytes: 5 }));

    await user.upload(screen.getByLabelText("Escolher ficheiros"), new File(["0123456789"], "grande.bin"));

    expect(await screen.findByText("O ficheiro excede o limite de 5 B.")).toBeInTheDocument();
    expect(Xhr.instances).toHaveLength(0);
  });

  it("clicar no nome de uma imagem abre a pré-visualização; um ficheiro sem pré-visualização não é clicável", async () => {
    serve({
      "GET /api/folders/:id/contents": () =>
        json({
          ...FOTOS,
          files: [
            { ...NEW_FILE, id: "i1", name: "foto.png" },
            { ...NEW_FILE, id: "t1", name: "notas.txt" },
          ],
        }),
    });
    const user = userEvent.setup();
    renderApp("/pasta/f1");
    await user.click(await screen.findByRole("button", { name: "foto.png" }));
    expect(screen.getByRole("dialog", { name: "foto.png" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "foto.png" })).toHaveAttribute("src", "/api/files/i1/preview");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "notas.txt" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ações para o ficheiro notas.txt" }));
    expect(screen.queryByRole("menuitem", { name: "Pré-visualizar" })).not.toBeInTheDocument();
  });

  it("«Pré-visualizar» também está no menu das imagens e dos PDF", async () => {
    serve({
      "GET /api/folders/:id/contents": () => json({ ...FOTOS, files: [{ ...NEW_FILE, id: "p1", name: "relatório.pdf" }] }),
    });
    const user = userEvent.setup();
    renderApp("/pasta/f1");
    await user.click(await screen.findByRole("button", { name: "Ações para o ficheiro relatório.pdf" }));
    await user.click(screen.getByRole("menuitem", { name: "Pré-visualizar" }));
    expect(screen.getByTitle("Pré-visualização de relatório.pdf")).toHaveAttribute("src", "/api/files/p1/preview");
  });
});
```

Run:

```bash
npx vitest run -c vitest.web.config.ts src/web/pages/FolderPage.test.tsx src/web/components/FileActions.test.tsx
```
Expected: FAIL (Test Files  2 failed (2); Tests  8 failed | 16 passed (24)).

Em `src/web/components/FileActions.tsx`, trocar:

```tsx
export function FileActions({ file }: { file: FileItem }) {
```

por:

```tsx
export function FileActions({ file, onPreview }: { file: FileItem; onPreview?: () => void }) {
```

No mesmo ficheiro, trocar:

```tsx
  const actions: MenuAction[] = [
    { label: "Descarregar",
```

por:

```tsx
  const actions: MenuAction[] = [
    ...(onPreview ? [{ label: "Pré-visualizar", onSelect: onPreview }] : []),
    { label: "Descarregar",
```

Em `src/web/components/ItemRows.tsx`, substituir o bloco de `import` no topo do ficheiro (todas as linhas de `import`, até à linha em branco) por:

```tsx
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { formatBytes, formatDate } from "../../shared/format";
import { previewContentType } from "../../shared/preview";
import type { FileItem, FolderItem } from "../../shared/types";
import { FileActions } from "./FileActions";
import { FolderActions } from "./FolderActions";
import { FileIcon, FolderIcon } from "./icons";
import { PreviewDialog } from "./PreviewDialog";
```

Em `src/web/components/ItemRows.tsx`, trocar a função `FileRow` inteira:

```tsx
export function FileRow({ file }: { file: FileItem }) {
  return (
    <ItemRow
      icon={<FileIcon />}
      name={
        <span title={file.name} className="block truncate">
          {file.name}
        </span>
      }
      size={formatBytes(file.size)}
      date={formatDate(file.createdAt)}
      actions={<FileActions file={file} />}
    />
  );
}
```

por:

```tsx
export function FileRow({ file }: { file: FileItem }) {
  const [previewing, setPreviewing] = useState(false);
  const canPreview = previewContentType(file.name) !== null;
  const openPreview = () => setPreviewing(true);
  return (
    <ItemRow
      icon={<FileIcon />}
      name={
        canPreview ? (
          <button type="button" title={file.name} onClick={openPreview} className="block w-full truncate text-left hover:underline">
            {file.name}
          </button>
        ) : (
          <span title={file.name} className="block truncate">
            {file.name}
          </span>
        )
      }
      size={formatBytes(file.size)}
      date={formatDate(file.createdAt)}
      actions={
        <>
          <FileActions file={file} onPreview={canPreview ? openPreview : undefined} />
          {previewing && <PreviewDialog file={file} onClose={() => setPreviewing(false)} />}
        </>
      }
    />
  );
}
```

Substituir o conteúdo de `src/web/pages/FolderPage.tsx`:

```tsx
import { useRef, useState, type DragEvent } from "react";
import { Link, useParams } from "react-router";
import { ApiRequestError, errorMessage } from "../api";
import { Breadcrumb } from "../components/Breadcrumb";
import { Button } from "../components/Button";
import { FileRow, FolderRow } from "../components/ItemRows";
import { Message } from "../components/Message";
import { NameDialog } from "../components/NameDialog";
import { filesFromDrop } from "../dropped-files";
import { useContents, useCreateFolder } from "../space";
import { ROOT_LABEL } from "../tree";
import { useUploads } from "../uploads-context";

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

/** "Meu espaço": o conteúdo de uma pasta (a raiz em `/`, as outras em `/pasta/:folderId`). */
export default function FolderPage() {
  const folderId = useParams().folderId ?? null;
  const contents = useContents(folderId);
  const createFolder = useCreateFolder();
  const uploads = useUploads();
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // `dragenter`/`dragleave` disparam também ao passar por cima dos filhos: conta-se a profundidade.
  const dragDepth = useRef(0);

  if (contents.isPending) return <p className="text-slate-500">A carregar…</p>;
  if (contents.isError) {
    const gone = contents.error instanceof ApiRequestError && contents.error.code === "folder_not_found";
    return (
      <div className="max-w-md space-y-4">
        <Message kind="error">{gone ? "Esta pasta não existe ou foi eliminada." : errorMessage(contents.error)}</Message>
        {gone ? (
          <Link to="/" className="text-sm font-medium text-indigo-600 hover:underline">
            Ir para {ROOT_LABEL}
          </Link>
        ) : (
          <Button variant="secondary" onClick={() => void contents.refetch()}>
            Tentar novamente
          </Button>
        )}
      </div>
    );
  }

  const { folder, breadcrumb, folders, files } = contents.data;

  function closeCreate() {
    setCreating(false);
    createFolder.reset();
  }

  function addFiles(chosen: File[]) {
    if (chosen.length > 0) uploads.add(chosen, folderId);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const dropped = filesFromDrop(event.dataTransfer);
    setNotice(dropped.skippedFolders > 0 ? "As pastas não se enviam: arraste os ficheiros." : null);
    addFiles(dropped.files);
  }

  return (
    <div
      className={`min-h-[60vh] rounded-xl ${dragging ? "bg-indigo-50/60 outline-2 outline-dashed outline-indigo-400" : ""}`}
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (hasFiles(event)) event.preventDefault();
      }}
      onDragLeave={() => {
        if (dragDepth.current > 0 && --dragDepth.current === 0) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <Breadcrumb items={breadcrumb} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight break-words">{folder?.name ?? ROOT_LABEL}</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setCreating(true)}>
            Nova pasta
          </Button>
          <Button onClick={() => fileInput.current?.click()}>Carregar ficheiros</Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            aria-label="Escolher ficheiros"
            onChange={(event) => {
              addFiles([...(event.target.files ?? [])]);
              event.target.value = ""; // para poder escolher o mesmo ficheiro outra vez
            }}
          />
        </div>
      </div>

      {notice && (
        <div className="mt-4">
          <Message kind="error">{notice}</Message>
        </div>
      )}

      {folders.length + files.length === 0 ? (
        <p className="mt-10 text-center text-slate-500">
          Esta pasta está vazia. Arraste ficheiros para aqui ou use «Carregar ficheiros».
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {folders.map((item) => (
            <FolderRow key={item.id} folder={item} />
          ))}
          {files.map((item) => (
            <FileRow key={item.id} file={item} />
          ))}
        </ul>
      )}

      {creating && (
        <NameDialog
          title="Nova pasta"
          label="Nome da pasta"
          confirmLabel="Criar"
          pending={createFolder.isPending}
          error={createFolder.error ? errorMessage(createFolder.error) : null}
          onSubmit={(name) => createFolder.mutate({ name, parentId: folderId }, { onSuccess: closeCreate })}
          onClose={closeCreate}
        />
      )}
    </div>
  );
}
```

Em `src/web/components/AppLayout.tsx`, substituir o bloco de `import` no topo do ficheiro (todas as linhas de `import`, até à linha em branco) por:

```tsx
import { Navigate, NavLink, Outlet, useLocation } from "react-router";
import { errorMessage } from "../api";
import { useLogout, useMe } from "../auth";
import { UploadsProvider } from "../uploads-context";
import { Button } from "./Button";
import { Message } from "./Message";
import { UploadPanel } from "./UploadPanel";
import { UsageBar } from "./UsageBar";
```

Em `src/web/components/AppLayout.tsx`, trocar:

```tsx
      <main className="min-w-0 flex-1 p-6 md:p-8">
        <Outlet />
      </main>
```

por:

```tsx
      <main className="min-w-0 flex-1 p-6 md:p-8">
        <UploadsProvider>
          <Outlet />
          <UploadPanel />
        </UploadsProvider>
      </main>
```

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  21 passed (21)`, `Tests  137 passed (137)`.

- [ ] **Step 6: Verificação e commit**

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  21 passed (21)`, `Tests  137 passed (137)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npm run build`
Expected: `✓ built in ...` duas vezes (Worker e cliente).

Commit:

```bash
git add src
git commit -m "Acrescenta o envio de ficheiros (botão e arrastar-e-largar) e a pré-visualização" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Documentação e verificação final do Plano 2B

**Files:**
- Modify: `README.md`, `docs/superpowers/plans/README.md`

**Interfaces:**
- Sem código novo: documenta os comandos de teste, `GET /api/config` e a interface no README; regista o Plano 2B no índice dos planos; verificação final.

- [ ] **Step 1: Documentar no README**

Em `README.md`, na tabela de comandos, trocar a linha do `npm test`:

```markdown
| `npm test` | Testes (Vitest no runtime do Workers, com D1 e R2 locais) |
```

por:

```markdown
| `npm test` | Todos os testes (`test:worker` e `test:web`) |
| `npm run test:worker` | Testes da API (Vitest no runtime do Workers, com D1 e R2 locais) |
| `npm run test:web` | Testes da interface (Vitest em jsdom, com o Testing Library) |
```

Na árvore de pastas, trocar:

```markdown
test/          testes
```

por:

```markdown
test/          testes do Worker (os da interface ficam ao lado do código, em src/web/**/*.test.tsx)
```

Na secção da API, trocar:

```markdown
`parentId` (pastas) e `folderId` (ficheiros) aceitam `null` ou `"root"` para a raiz; no upload, omitir `folder` também significa a raiz.
```

por:

```markdown
`parentId` (pastas) e `folderId` (ficheiros) aceitam `null` ou `"root"` para a raiz; no upload, omitir `folder` também significa a raiz. As pastas têm no máximo 100 níveis (senão 400 `folder_too_deep`).
```

No fim da tabela da API, trocar a última linha e acrescentar a secção da interface:

```markdown
| `DELETE /api/files/:id` | Manda o ficheiro para a lixeira |
```

por:

```markdown
| `DELETE /api/files/:id` | Manda o ficheiro para a lixeira |
| `GET /api/config` | Limites do servidor para o browser: `{ maxUploadBytes }` |

## Interface

Depois do login, «Meu espaço» (`/`, e `/pasta/:id` dentro de uma pasta) mostra o caminho, as pastas e os ficheiros. Tem «Nova pasta», «Carregar ficheiros» (ou arrastar ficheiros para a página) e, em cada linha, o menu «⋮» com pré-visualizar (imagens e PDF), descarregar, renomear, mover e excluir. Os envios correm até 3 em paralelo, com progresso, e continuam se mudar de pasta; um ficheiro acima de `maxUploadBytes` nem sai do browser. Não há miniaturas (a API responde com `no-store`, por isso cada miniatura seria um pedido novo a cada listagem). Até ao Plano 3 não há ecrã da lixeira: os ficheiros excluídos continuam a ocupar quota.
```

- [ ] **Step 2: Registar o Plano 2B no índice dos planos**

Em `docs/superpowers/plans/README.md`, na tabela, trocar a linha do Plano 2B:

```markdown
| 2B | [Interface "Meu espaço"](2026-10-03-02b-interface-meu-espaco.md) | Lista, caminho (*breadcrumb*), nova pasta, upload com progresso (3 em paralelo), menu de ações, mover, pré-visualização de imagens e PDF; API: `GET /api/config`, limite de 100 níveis nas pastas | Escrito, por executar |
```

por:

```markdown
| 2B | [Interface "Meu espaço"](2026-10-03-02b-interface-meu-espaco.md) | Lista, caminho (*breadcrumb*), nova pasta, upload com progresso (3 em paralelo), menu de ações, mover, pré-visualização de imagens e PDF; API: `GET /api/config`, limite de 100 níveis nas pastas | Concluído |
```

Na secção "Pendentes herdados", trocar todo o bloco do Plano 2B:

```markdown
**Plano 2B (interface "Meu espaço")**
- Herdado do Plano 1 (frontend): tratamento central do 401 (invalidar `ME_KEY`), mensagem de falha de rede em português (hoje aparece "Failed to fetch"), "Sair" com feedback de erro, botão de repetir no estado de erro do layout, testes do contrato `apiFetch`/`useMe`, invalidar `ME_KEY` depois de uploads e exclusões, substituir o marcador de posição da `HomePage`.
- Novo (revisão final do 2A): expor `maxUploadBytes` (em `/api/auth/me` ou num `GET /api/config`) e validar o tamanho no cliente antes do XHR: um corpo acima do limite da Cloudflare recebe da *edge* um 413 que não é JSON.
- Novo: construir o URL do upload com `URLSearchParams`/`encodeURIComponent` (o Hono decodifica `+` como espaço).
- Novo: mover `PREVIEW_TYPES`/`previewContentType` para `src/shared`, para o menu só mostrar "Pré-visualizar" quando o servidor a aceita.
- Novo: exportar uma união `ApiErrorCode` em `src/shared/types.ts` e mapeá-la para mensagens em português.
- Novo: invalidar `ME_KEY` e as consultas de `contents` e `tree` depois de cada mutação.
- Novo: evitar miniaturas via `/preview` (o `no-store` impede a cache).
- Novo: um 409 `name_taken` pode vir de um upload `pending` invisível: a mensagem deve sugerir isso.
- Novo: no diálogo "Mover", desativar a própria pasta e as suas descendentes.

- Novo (re-revisão final do 2A): `test/names.test.ts` tem caracteres invisíveis literais (U+0301, NBSP, BOM, bidi U+202E, ZWJ) em vez de escapes `\u…`: trocar por escapes (o GitHub mostra um aviso de Unicode bidirecional) e manter as guardas.
- Novo: `POST /api/folders` não limita a profundidade. As consultas recursivas ficam limitadas a 1000 níveis, mas mover para uma zona mais funda dá `invalid_move` com uma mensagem enganadora: limitar a profundidade ao criar/mover (por exemplo 100) e dizer isso na mensagem.
```

por:

```markdown
**Plano 2B (interface "Meu espaço"): resolvido no Plano 2B**
- Resolvido: tratamento central do 401 (`setUnauthorizedHandler`: `["me"]` passa a `null` e o layout vai para o login), falha de rede em português, «Sair» com erro, botão de repetir no erro do layout, testes de `apiFetch`/`useMe`, e `["me"]`, as listagens (`["folder", …]`) e a árvore (`["tree"]`) invalidados depois de cada mutação e de cada envio.
- Resolvido: `GET /api/config` (`maxUploadBytes`) e validação do tamanho no cliente antes do XHR; URL do upload com `URLSearchParams`; `previewContentType` em `src/shared` (o menu só mostra «Pré-visualizar» quando o servidor a aceita); sem miniaturas; o 409 `name_taken` de ficheiros diz que pode ser um envio em curso; o diálogo «Mover» desativa a pasta atual e, ao mover uma pasta, ela e as descendentes; `test/names.test.ts` com escapes `\u…`; profundidade máxima de 100 níveis nas pastas (`400 folder_too_deep`; ao mover conta a subárvore).
- Decidido não fazer: a união `ApiErrorCode` e o mapa de mensagens. O servidor já responde em português e a interface só mostra `message`; exportar a união quando a interface precisar de decidir por código.
- Fica para o Plano 5 (Playwright, browser real): no diálogo de pré-visualização de um PDF, o leitor do Chrome fica com o foco depois de carregar e o Esc não fecha o diálogo (o botão «Fechar», o clique no fundo e o Tab funcionam; tentou-se devolver o foco ao botão no `onLoad`, mas o leitor volta a tomá-lo meio segundo depois); confirmar também o arrastar-e-largar e o envio com `Content-Length` num browser real.
- Fica para o Plano 3: o ecrã da lixeira. Até lá, «Excluir» num ficheiro só o manda para a lixeira e o espaço não é libertado.
```

- [ ] **Step 3: Verificação final**

Run: `npx vitest run`
Expected: `Test Files  24 passed (24)`, `Tests  208 passed (208)`.

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  21 passed (21)`, `Tests  137 passed (137)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npm run build`
Expected: `✓ built in ...` duas vezes (Worker e cliente).

- [ ] **Step 4: Verificação manual no browser**

Os testes de interface correm em jsdom, que não faz envios nem arrastar-e-largar reais. Antes de dar o plano por concluído, abrir a aplicação num browser e passar por esta lista (o controlador faz isto com o browser integrado; **não** usar a senha do master real):

1. Numa pasta de trabalho limpa: `rm -rf .wrangler`, `npm run db:migrate:local`, e criar um utilizador de teste com o `seed:master` (`MASTER_EMAIL=master@example.test` e uma senha inventada na hora, só em variáveis de ambiente) e `--local`. Arrancar com `npm run dev` (`http://localhost:5173`).
2. Entrar. «Meu espaço» mostra a pasta vazia com a dica de como enviar ficheiros.
3. «Nova pasta» (com acentos) cria-a; um nome repetido mostra o erro no diálogo e o diálogo fica aberto.
4. Enviar vários ficheiros (um `.png`, um `.pdf` e um nome com `+`, `&` e acentos): aparecem no painel «Envios», com progresso, ficam «Concluído», a lista e a barra de espaço atualizam-se e o nome com `+` chega intacto.
5. Um ficheiro acima de 100 MB nem é enviado e o painel diz porquê.
6. Clicar no nome do `.png` e do `.pdf` abre a pré-visualização; `Esc` fecha a do `.png`.
7. No menu «⋮»: mover um ficheiro para a pasta, abrir a pasta (o caminho mostra «Meu espaço / pasta»), excluir a pasta com conteúdo (erro «A pasta não está vazia») e excluir um ficheiro.
8. Com a sessão terminada por baixo da interface (por exemplo `fetch('/api/auth/logout', { method: 'POST' })` na consola), qualquer ação leva ao ecrã de entrada.
9. Parar o `npm run dev` e apagar `.wrangler`.

- [ ] **Step 5: Commit**

Commit:

```bash
git add README.md docs
git commit -m "Documenta a interface, os comandos de teste e regista o Plano 2B" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Auto-revisão do plano contra a especificação

| Requisito | Onde |
|---|---|
| Spec §8: cabeçalho com caminho (*breadcrumb*), «Nova pasta» e «Carregar», lista de pastas e ficheiros | Tasks 5 (Breadcrumb) e 6 |
| Spec §8: menu por item (pré-visualizar, descarregar, renomear, mover, excluir) | Tasks 5 (RowMenu), 7 e 8 |
| Spec §8: «Mover» abre um diálogo com a árvore de pastas | Tasks 3 (`tree.ts`) e 7 (`MoveDialog`, a árvore recuada num `<select>`) |
| Spec §8: upload por arrastar e largar e por seleção, 3 em paralelo, progresso por ficheiro com `XMLHttpRequest` | Tasks 4 e 8 |
| Spec §8: barra lateral com a barra de uso | Task 3 (as mutações invalidam o utilizador) e `AppLayout` (Task 6) |
| Spec §4: pré-visualização só de imagens e PDF | Tasks 1 (`previewContentType` partilhado) e 8 |
| Pendente do Plano 1: 401 central, falha de rede em português, «Sair» com erro, repetir no erro do layout, testes de `apiFetch`/`useMe`, `ME_KEY` invalidado | Tasks 2, 3 e 6 |
| Pendente do 2A: `maxUploadBytes` no cliente, URL do upload com `URLSearchParams`, `previewContentType` partilhado, sem miniaturas, 409 `name_taken` explicado, «Mover» a desativar a própria pasta e as descendentes, invalidar `me`/`contents`/`tree` | Tasks 1, 3, 4, 7 e 8 |
| Pendente do 2A: escapes `\u…` em `test/names.test.ts`; limite de profundidade das pastas | Task 1 |

**Fora deste plano:** a pesquisa por nome, a partilha por link, o ecrã da lixeira (Plano 3); o painel de administração (Plano 4); o deploy e os testes de ponta a ponta com Playwright (Plano 5). Até ao Plano 3, «Excluir» num ficheiro só o manda para a lixeira e o espaço não é libertado.

**Totais de testes (medidos na execução deste plano numa pasta limpa):** Worker: Test Files 24 passed (24); Tests 208 passed (208). Interface: Test Files 21 passed (21); Tests 137 passed (137).

## Notas da execução

- **Sem `ApiErrorCode`:** a união de códigos de erro e o seu mapa de mensagens, que o índice dos planos previa, não foram feitos: o servidor já responde em português e a interface só mostra a `message`. Exportar a união quando a interface precisar de decidir por código.
- **PDF e o foco:** no diálogo de pré-visualização de um PDF, o leitor do Chrome fica com o foco depois de carregar e o `Esc` deixa de chegar ao diálogo (o botão «Fechar», o clique no fundo e o Tab funcionam). Tentou-se devolver o foco ao botão no `onLoad` do `<iframe>`, mas o leitor volta a tomá-lo cerca de meio segundo depois. Fica para o Plano 5 (Playwright).
- **Corrigido na execução (o código do repositório prevalece sobre os blocos deste plano):** as revisões das tarefas acharam quatro defeitos que o plano não tinha; cada um foi corrigido com um teste de regressão escrito primeiro. Por isso os totais intermédios de testes das Tasks 5 a 8 ficam 1 a 4 acima do que cada passo indica (os totais finais, na secção acima, já são os reais) e há blocos de código que diferem do plano:
  - **Task 4, `src/web/uploads.ts` (`finish`):** um `onSettled` que lançasse impedia o `pump()` e a fila ficava parada. Agora o `onSettled` corre num `try/catch` (o erro é engolido de propósito) e o `pump()` num `finally`; teste novo em `uploads.test.ts`.
  - **Task 5, `src/web/components/Modal.tsx`:** o foco não voltava a quem abriu o diálogo quando um filho tinha `autoFocus` (`NameDialog`: «Nova pasta», «Renomear»), porque o elemento era lido no `useEffect`, depois do `autoFocus`. Agora é guardado no primeiro render (`useState(() => document.activeElement)`); teste novo em `NameDialog.test.tsx`.
  - **Task 8, `src/web/uploads.ts` (`cancelAll`), `src/web/uploads-context.tsx` e `src/web/components/AppLayout.tsx`:** a fila de envios sobrevivia ao `UploadsProvider` (fim de sessão, 401, erro ao ler o utilizador) e continuava a enviar; depois de um logout, os ficheiros em espera podiam subir para o espaço de outro utilizador que entrasse no mesmo separador. Agora o `UploadManager` tem `cancelAll()`, o provider chama-o ao desmontar, e o `AppLayout` só mostra o ecrã de erro de `["me"]` quando ainda não há dados (um refetch falhado em segundo plano deixa de desmontar a aplicação); testes novos em `uploads.test.ts`, `uploads-context.test.tsx` e `AppLayout.test.tsx`.
- **Ronda final (revisão do ramo todo):** corrigiu, num só passo, o que a revisão final achou: um refetch falhado em segundo plano deixava de trocar a lista (e os diálogos abertos) pelo ecrã de erro (`FolderPage` e `MoveDialog`); o teste de envio da página passou a provar que a lista se atualiza; a página é remontada por pasta (`key` em `App.tsx`); os nomes dos envios passam por `validateName` antes de entrar na fila; uma guarda ao nível da janela impede o browser de abrir um ficheiro largado fora da zona; e o `UploadsProvider` tem `key={user.id}` (uma troca de utilizador no mesmo separador cancela a fila). Os espaços não separáveis do `MoveDialog` passaram a escapes `\u00a0`. Os totais finais são Worker 24 ficheiros / 208 testes e interface 21 ficheiros / 137 testes. Os pendentes que ficaram de fora (acessibilidade fina, cargas fora do `apiFetch`, vários testes) estão no índice dos planos, nas secções do Plano 3 e do Plano 5.
- **Verificação manual:** a lista da Task 9 foi percorrida num browser real durante a escrita deste plano (criar pastas com acentos, enviar `.png`, `.pdf` e um nome com `+ & é`, ficheiro acima do limite, pré-visualizar imagem e PDF, mover, excluir pasta com conteúdo, sessão terminada por baixo da interface).
