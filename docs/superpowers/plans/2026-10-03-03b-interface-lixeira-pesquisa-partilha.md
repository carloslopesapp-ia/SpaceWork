# SpaceWork — Plano 3B: interface da lixeira, da pesquisa e da partilha (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ecrãs à API do Plano 3A: o ecrã `/lixeira` (restaurar, eliminar de vez, esvaziar), a pesquisa por nome com o caminho de cada resultado, o diálogo «Partilhar…» (criar links com validade, copiar, revogar) e a página pública `/s/:token`. Fecha também os pendentes da interface do Plano 2B que o 3B herdou (envios, «Sair», menus de ações).

**Architecture:** Três ficheiros de hooks novos sobre o TanStack Query (`search.ts`, `trash.ts`, `shares.ts`), que seguem o padrão de `space.ts`: `useRefreshSpace` passa a invalidar também a lixeira e as pesquisas, por isso nenhuma mutação existente tem de saber delas. A caixa de pesquisa fica na barra lateral de todas as páginas e os resultados numa página própria (`/pesquisa?q=`), que reutiliza as linhas de «Meu espaço» (e portanto todas as ações). A lixeira e o diálogo de partilha são páginas e componentes novos; `/s/:token` fica fora do `AppLayout` (não pede a sessão). O estado da fila de envios divide-se em três contextos (ações, «ocupado» e lista) e o refresh depois dos envios passa a ser um por intervalo. Nenhuma rota da API muda.

**Tech Stack:** o dos planos anteriores (React 19, React Router 8, TanStack Query 5, Tailwind 4, Vitest `^4.1` com Testing Library); nenhuma dependência nova.

**Spec:** [docs/superpowers/specs/2026-10-03-spacework-design.md](../specs/2026-10-03-spacework-design.md) (secção 5, restaurar, eliminar definitivamente, pesquisa e partilha por link; secção 6, rotas; secção 8, interface). Índice dos planos: [README.md](README.md). Este plano trata também dos pendentes do Plano 3 que são da interface (secção «Pendentes herdados» do índice).

## Global Constraints

Valores da especificação e dos planos anteriores; todas as tarefas os cumprem implicitamente.

- Interface em português europeu; as mensagens de erro da API já vêm em português e a interface mostra o `message` tal como vem. A interface só decide por código onde há uma razão: `name_taken` no restauro (a mensagem da API fala de um envio em curso, o que ali não faz sentido) e `share_not_found` na página pública (sem «Tentar novamente»).
- A pesquisa usa os mesmos limites da API: `SEARCH_MIN_LENGTH` (2) e `SEARCH_MAX_LENGTH` (100) de `src/shared/names.ts`; a API devolve no máximo 50 resultados. A lixeira lista no máximo 200 ficheiros (`total` conta todos) e esvazia-se por blocos: `DELETE /api/trash` repete-se até `remaining` ser 0 ou `purged` ser 0.
- O link completo de uma partilha só existe na resposta da criação (`token` de `POST /api/files/:id/shares`) e só vive no estado do diálogo aberto: nunca se escreve em armazenamento do browser nem no endereço de uma página da aplicação.
- A página pública `/s/:token` não pede a sessão e não carrega recursos de outras origens; o descarregamento é a ligação `/api/public/shares/:token/download` (a API responde com `Content-Disposition: attachment`).
- Rotas da interface: `/pesquisa?q=`, `/lixeira` e `/s/:token` (as duas primeiras dentro do `AppLayout`).
- Um diálogo que lança um pedido que não se desfaz nem se cancela (eliminar de vez, esvaziar a lixeira, excluir, terminar a sessão, criar um link) ignora o Esc e o clique no fundo, e tem «Cancelar» ou «Fechar» desativado, enquanto o pedido decorre: fechá-lo faria a página esquecer uma ação que continua a correr. O foco nunca fica fora de um diálogo aberto (o `Modal` devolve-lho se o elemento focado desaparecer).
- O fim de sessão (terminar a sessão ou um 401) é `forgetAccount`: cancela o pedido da sessão em curso, tira as outras consultas, esvazia a cache das mutações (guarda senhas e tokens) e põe a sessão a `null`. O token de uma partilha também não fica na cache das mutações depois de o diálogo se fechar (`gcTime: 0`).
- Os testes da interface correm em jsdom (`npx vitest run -c vitest.web.config.ts`) e mostram só o resumo do Vitest: qualquer outra saída (avisos de `act`, `console.error`) é um defeito do teste a corrigir. Um teste que espera por um temporizador usa relógios reais com um intervalo curto, nunca `vi.useFakeTimers` (o `waitFor` do Testing Library não avança temporizadores falsos no Vitest).
- IDs `crypto.randomUUID()`; datas em milissegundos Unix. Vitest `^4.1`.
- **Nenhum `git push` sem confirmação explícita do utilizador.**

## Ambiente

- Node 24 e npm 11; todos os comandos correm na raiz do repositório (`~/Developer/SpaceWork`, fora do iCloud). Ramo de trabalho: `plano-3b-interface-lixeira-partilha`.
- Commits: mensagem curta em português; cada commit termina com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (nos comandos abaixo, é o segundo `-m`). Escrever **exatamente** esse trailer, "Claude Sonnet 5.5", mesmo que o modelo que executa seja outro.
- A Task 1 toca no Worker (`npx vitest run`); as restantes são da interface (`npx vitest run -c vitest.web.config.ts`).
- O guião de verificação manual (Task 8) usa uma conta **fictícia** numa base local limpa. Nunca se usam as credenciais do utilizador master, nem se escrevem em ficheiros.

## Estrutura de ficheiros deste plano

```
src/shared/names.ts                         + SEARCH_MIN_LENGTH, SEARCH_MAX_LENGTH
src/shared/format.ts                        formatDate à prova de valores inválidos
src/web/space.ts                            + TRASH_KEY, SEARCH_KEY; useRefreshSpace invalida-as; useSpaceMutation exportado
src/web/search.ts                           describeSearch, useSearch
src/web/trash.ts                            useTrash, useRestoreFile, usePurgeFile, useEmptyTrash
src/web/shares.ts                           useShares, useCreateShare, useRevokeShare, usePublicShare, shareUrl, shareDownloadUrl
src/web/auth.ts                             forgetAccount (fim de sessão sem clear()); useLogout usa-o
src/web/query-client.ts                     o tratamento do 401 usa forgetAccount
src/web/uploads-context.tsx                 três contextos (ações, ocupado, lista) e um refresh por intervalo
src/web/components/Location.tsx             «Em Meu espaço / Pasta»
src/web/components/SearchBox.tsx            caixa de pesquisa da barra lateral
src/web/components/ShareDialog.tsx          o diálogo «Partilhar…»
src/web/components/useDialog.ts             estado comum dos menus de ações
src/web/components/Modal.tsx                devolve o foco ao diálogo se o elemento focado desaparece
src/web/components/ConfirmDialog.tsx        pendingLabel; não se fecha enquanto a ação decorre
src/web/components/AppLayout.tsx            pesquisa, «Lixeira» e «Sair» com confirmação; o provider dos envios envolve a barra lateral
src/web/pages/SearchPage.tsx                /pesquisa
src/web/pages/TrashPage.tsx                 /lixeira
src/web/pages/SharePage.tsx                 /s/:token
src/web/shell.test.ts                       index.html e CSS sem recursos de terceiros
```

---


### Task 1: Limites da pesquisa partilhados, `formatDate` à prova de valores inválidos e testes dos hooks que faltavam

**Files:**
- Modify: `src/shared/names.ts`, `src/shared/format.ts`, `src/worker/routes/search.ts`
- Modify: `test/search.test.ts`, `test/format.test.ts`, `src/web/space.test.tsx`

**Interfaces:**
- Consumes: `normalizeName`, `searchKey` (`src/shared/names.ts`), `formatDate` (`src/shared/format.ts`), `mockApi`, `queryWrapper` (Plano 2B).
- Produces: `SEARCH_MIN_LENGTH` (2) e `SEARCH_MAX_LENGTH` (100) em `src/shared/names.ts`, que o Worker e a caixa de pesquisa (Task 3) usam;
  `formatDate` devolve `"—"` para um valor que não é uma data (as Tasks 3 e 4 mostram datas da API).

- [ ] **Step 1: Os limites da pesquisa numa só constante (teste primeiro)**

O Worker tem o 2 e o 100 escritos em `routes/search.ts`; a caixa de pesquisa precisa dos mesmos valores para não pedir à API o que ela vai recusar. Passam para `src/shared/names.ts` (sem imports, serve o Worker e o browser). O teste novo fixa os limites **inclusive** (o 2 e o 100 passam; o 1 e o 101 não), que era um dos testes pequenos em falta da pesquisa.

Em `test/search.test.ts`, nos `import`, trocar:

```ts
import type { SearchResult } from "../src/shared/types";
```

por:

```ts
import { SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH } from "../src/shared/names";
import type { SearchResult } from "../src/shared/types";
```

Acrescentar ao fim de `test/search.test.ts`:

```ts
describe("GET /api/search: limites do comprimento", () => {
  it("aceita pesquisas com SEARCH_MIN_LENGTH e SEARCH_MAX_LENGTH caracteres e recusa uma a menos e uma a mais", async () => {
    const { cookie } = await registerUser("ana@example.com");
    expect((await search(cookie, "a".repeat(SEARCH_MIN_LENGTH))).status).toBe(200);
    expect((await search(cookie, "a".repeat(SEARCH_MIN_LENGTH - 1))).status).toBe(400);
    expect((await search(cookie, "a".repeat(SEARCH_MAX_LENGTH))).status).toBe(200);
    expect((await search(cookie, "a".repeat(SEARCH_MAX_LENGTH + 1))).status).toBe(400);
  });
});
```

Run: `npx vitest run test/search.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  1 failed | 8 passed (9)).

Em `src/shared/names.ts`, trocar:

```ts
export const NAME_MAX_LENGTH = 255;
```

por:

```ts
export const NAME_MAX_LENGTH = 255;

/**
 * Comprimento de uma pesquisa por nome. O mínimo conta caracteres (pontos de código) depois de tirar espaços e acentos; o máximo
 * conta unidades UTF-16 do texto normalizado (NFC, sem espaços nas pontas). A API e a caixa de pesquisa usam os mesmos limites.
 */
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;
```

Em `src/worker/routes/search.ts`, nos `import`, trocar:

```ts
import { normalizeName, searchKey } from "../../shared/names";
```

por:

```ts
import { normalizeName, SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH, searchKey } from "../../shared/names";
```

No mesmo ficheiro, apagar as duas constantes locais (passaram para `src/shared/names.ts`). Trocar:

```ts
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 50;
```

por:

```ts
const MAX_RESULTS = 50;
```

Em `src/worker/routes/search.ts`, trocar todas as ocorrências (2) de `MAX_QUERY_LENGTH` por `SEARCH_MAX_LENGTH`.

Em `src/worker/routes/search.ts`, trocar todas as ocorrências (2) de `MIN_QUERY_LENGTH` por `SEARCH_MIN_LENGTH`.

Run: `npx vitest run test/search.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  9 passed (9)`.

- [ ] **Step 2: `formatDate` com um valor inválido (teste primeiro)**

`Intl.DateTimeFormat.format(NaN)` lança `RangeError`: um `deletedAt` ou um `expiresAt` estragado derrubava a lista inteira em vez de mostrar um traço. O que a API devolve nunca é inválido, mas a interface passa a mostrar muitas datas (lixeira, partilhas) e uma linha má não deve partir o ecrã.

Em `test/format.test.ts`, trocar:

```ts
    expect(formatDate(new Date(2027, 0, 5, 23, 59).getTime())).toBe("05/01/2027");
  });
});
```

por:

```ts
    expect(formatDate(new Date(2027, 0, 5, 23, 59).getTime())).toBe("05/01/2027");
  });

  it("mostra um traço quando o valor não é uma data (NaN, infinito ou fora do intervalo do JavaScript)", () => {
    expect(formatDate(Number.NaN)).toBe("—");
    expect(formatDate(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatDate(8.64e15 + 1)).toBe("—");
  });
});
```

Run: `npx vitest run test/format.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  1 failed | 5 passed (6)).

Em `src/shared/format.ts`, trocar:

```ts
/** Data legível (ex.: "03/10/2026") a partir de milissegundos Unix, no fuso do utilizador. */
export function formatDate(timestamp: number): string {
  return dateFormat.format(timestamp);
}
```

por:

```ts
/** Data legível (ex.: "03/10/2026") a partir de milissegundos Unix, no fuso do utilizador; "—" se o valor não for uma data. */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
}
```

Run: `npx vitest run test/format.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  6 passed (6)`.

- [ ] **Step 3: Testes dos hooks `useDeleteFolder` e `useUpdateFile`**

Pendente do Plano 2B: estes dois hooks só eram exercitados por testes de páginas. Os testes descrevem comportamento que já existe, por isso passam logo; fixam o id codificado no URL, o corpo (só o que mudou, com `null` a querer dizer a raiz) e o refresh da listagem.

Em `src/web/space.test.tsx`, nos `import`, trocar:

```tsx
import { useConfig, useContents, useCreateFolder, useDeleteFile, useTree, useUpdateFolder } from "./space";
```

por:

```tsx
import {
  useConfig,
  useContents,
  useCreateFolder,
  useDeleteFile,
  useDeleteFolder,
  useTree,
  useUpdateFile,
  useUpdateFolder,
} from "./space";
```

No fim do `describe("mutações")`, trocar:

```tsx
    expect(server.calls[0]).toMatchObject({ method: "DELETE", path: "/api/files/a%20b" });
  });
});
```

por:

```tsx
    expect(server.calls[0]).toMatchObject({ method: "DELETE", path: "/api/files/a%20b" });
  });

  it("excluir uma pasta usa DELETE e o id codificado, e atualiza a listagem", async () => {
    const server = mockApi({
      "GET /api/folders/:id/contents": () => json(EMPTY),
      "DELETE /api/folders/:id": () => noContent(),
    });
    const wrapper = queryWrapper(testQueryClient());
    const contents = renderHook(() => useContents(null), { wrapper });
    const remove = renderHook(() => useDeleteFolder(), { wrapper });
    await waitFor(() => expect(contents.result.current.isSuccess).toBe(true));

    await act(() => remove.result.current.mutateAsync("a b"));

    expect(server.callsTo("DELETE /api/folders/:id")[0]).toMatchObject({ method: "DELETE", path: "/api/folders/a%20b" });
    await waitFor(() => expect(server.callsTo("GET /api/folders/:id/contents")).toHaveLength(2));
  });

  it("atualizar um ficheiro envia só o que mudou (o nome ou a pasta, com `null` a querer dizer a raiz) para o id codificado", async () => {
    const file = { id: "a b", name: "novo.txt", folderId: null, size: 1, mime: "text/plain", createdAt: 1 };
    const server = mockApi({ "PATCH /api/files/:id": () => json({ file }) });
    const { result } = renderHook(() => useUpdateFile(), { wrapper: queryWrapper(testQueryClient()) });

    await act(() => result.current.mutateAsync({ id: "a b", name: "novo.txt" }));
    await act(() => result.current.mutateAsync({ id: "a b", folderId: null }));

    const [rename, move] = server.callsTo("PATCH /api/files/:id");
    expect(rename).toMatchObject({ path: "/api/files/a%20b", body: { name: "novo.txt" } });
    expect(move.body).toEqual({ folderId: null });
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/space.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  7 passed (7)`.

- [ ] **Step 4: Verificação e commit**

Run: `npx vitest run`
Expected: `Test Files  31 passed (31)`, `Tests  271 passed (271)`.

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  21 passed (21)`, `Tests  139 passed (139)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src test
git commit -m "Partilha os limites da pesquisa, protege o formatDate de valores inválidos e testa os hooks das pastas e dos ficheiros" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Camada de dados: pesquisa, lixeira e partilha

**Files:**
- Create: `src/web/search.ts`, `src/web/trash.ts`, `src/web/shares.ts`
- Create: `src/web/search.test.tsx`, `src/web/trash.test.tsx`, `src/web/shares.test.tsx`
- Modify: `src/web/space.ts`

**Interfaces:**
- Consumes: `apiFetch`, `ApiRequestError` (`src/web/api.ts`), `useSpaceMutation`/`useRefreshSpace` (`src/web/space.ts`), `normalizeName`, `searchKey`, `SEARCH_MIN_LENGTH`, `SEARCH_MAX_LENGTH` (Task 1),
  os tipos `SearchResult`, `TrashContents`, `ShareItem`, `PublicShare` (`src/shared/types.ts`), `mockApi`, `queryWrapper` (Plano 2B).
- Produces: em `space.ts`, `TRASH_KEY`, `SEARCH_KEY` e `useSpaceMutation` exportados, e `useRefreshSpace` a invalidar também a lixeira e as pesquisas;
  `describeSearch(raw): { term, problem }` e `useSearch(raw)` (`search.ts`); `useTrash()`, `useRestoreFile()`, `usePurgeFile()` e `useEmptyTrash()` com `purged` (`trash.ts`);
  `useShares(fileId)`, `useCreateShare(fileId)` (variável: `expiresAt | null`; devolve `{ share, token }`), `useRevokeShare(fileId)`, `usePublicShare(token)`, `shareUrl(token)` e `shareDownloadUrl(token)` (`shares.ts`).

- [ ] **Step 1: A lixeira e as pesquisas passam a atualizar-se com o resto (teste primeiro)**

Hoje `useRefreshSpace` invalida as listagens, a árvore e a quota. Excluir um ficheiro põe-no na lixeira, e restaurar ou renomear muda os resultados de uma pesquisa: as duas chaves entram na mesma função, por isso nenhuma mutação existente tem de saber delas. As chaves ficam em `space.ts` (que não importa `trash.ts` nem `search.ts`, para os módulos não se importarem em círculo). O teste novo (excluir um ficheiro atualiza a lixeira) está em `trash.test.tsx`, que se escreve já com os hooks da lixeira.

Criar `src/web/trash.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TrashContents, TrashItem } from "../shared/types";
import { useMe } from "./auth";
import { useContents, useDeleteFile } from "./space";
import { apiError, json, ME, mockApi, noContent } from "./test/mock-api";
import { queryWrapper, testQueryClient } from "./test/render";
import { useEmptyTrash, usePurgeFile, useRestoreFile, useTrash } from "./trash";

const ITEM: TrashItem = {
  id: "a b",
  name: "velho.txt",
  size: 10,
  mime: "text/plain",
  folderId: null,
  path: [],
  deletedAt: 1,
  purgeAt: 2,
};
const TRASH: TrashContents = { items: [ITEM], total: 1, retentionDays: 30 };
const EMPTY = { folder: null, breadcrumb: [], folders: [], files: [] };

/** O que uma mutação da lixeira tem de atualizar: a própria lixeira, a listagem das pastas e a quota. */
function serveTrash(extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    "GET /api/trash": () => json(TRASH),
    "GET /api/folders/:id/contents": () => json(EMPTY),
    "GET /api/auth/me": () => json({ user: ME }),
    ...extra,
  });
}

function renderWith<T>(hook: () => T) {
  return renderHook(() => ({ trash: useTrash(), contents: useContents(null), me: useMe(), action: hook() }), {
    wrapper: queryWrapper(testQueryClient()),
  });
}

async function loaded(result: { current: { trash: { isSuccess: boolean }; contents: { isSuccess: boolean }; me: { isSuccess: boolean } } }) {
  await waitFor(() => {
    expect(result.current.trash.isSuccess).toBe(true);
    expect(result.current.contents.isSuccess).toBe(true);
    expect(result.current.me.isSuccess).toBe(true);
  });
}

describe("useTrash", () => {
  it("devolve a lixeira", async () => {
    serveTrash();
    const { result } = renderHook(() => useTrash(), { wrapper: queryWrapper(testQueryClient()) });
    await waitFor(() => expect(result.current.data).toEqual(TRASH));
  });
});

describe("useRestoreFile", () => {
  it("usa POST com o id codificado e atualiza a lixeira, a listagem e a quota", async () => {
    const server = serveTrash({
      "POST /api/trash/:id/restore": () => json({ file: { id: "a b", name: "velho.txt", folderId: null, size: 10, mime: "text/plain", createdAt: 1 } }),
    });
    const { result } = renderWith(useRestoreFile);
    await loaded(result);

    await act(() => result.current.action.mutateAsync("a b"));

    expect(server.callsTo("POST /api/trash/:id/restore")[0]).toMatchObject({ method: "POST", path: "/api/trash/a%20b/restore" });
    await waitFor(() => {
      expect(server.callsTo("GET /api/trash")).toHaveLength(2);
      expect(server.callsTo("GET /api/folders/:id/contents")).toHaveLength(2);
      expect(server.callsTo("GET /api/auth/me")).toHaveLength(2);
    });
  });

  it("também atualiza quando o restauro falha (a lixeira pode estar velha)", async () => {
    const server = serveTrash({ "POST /api/trash/:id/restore": () => apiError(404, "file_not_found", "Ficheiro não encontrado na lixeira.") });
    const { result } = renderWith(useRestoreFile);
    await loaded(result);

    await act(() => result.current.action.mutateAsync("a b").catch(() => undefined));

    await waitFor(() => expect(result.current.action.error?.message).toBe("Ficheiro não encontrado na lixeira."));
    await waitFor(() => expect(server.callsTo("GET /api/trash")).toHaveLength(2));
  });
});

describe("usePurgeFile", () => {
  it("usa DELETE com o id codificado e atualiza a lixeira e a quota", async () => {
    const server = serveTrash({ "DELETE /api/trash/:id": () => noContent() });
    const { result } = renderWith(usePurgeFile);
    await loaded(result);

    await act(() => result.current.action.mutateAsync("a b"));

    expect(server.callsTo("DELETE /api/trash/:id")[0]).toMatchObject({ method: "DELETE", path: "/api/trash/a%20b" });
    await waitFor(() => {
      expect(server.callsTo("GET /api/trash")).toHaveLength(2);
      expect(server.callsTo("GET /api/auth/me")).toHaveLength(2);
    });
  });
});

describe("excluir um ficheiro", () => {
  it("atualiza também a lixeira, que passa a ter o ficheiro", async () => {
    const server = serveTrash({ "DELETE /api/files/:id": () => noContent() });
    const { result } = renderWith(useDeleteFile);
    await loaded(result);

    await act(() => result.current.action.mutateAsync("a1"));

    await waitFor(() => expect(server.callsTo("GET /api/trash")).toHaveLength(2));
  });
});

describe("useEmptyTrash", () => {
  it("repete o pedido até não ficar nada, vai dando o progresso e no fim atualiza a lixeira e a quota", async () => {
    let round = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const server = serveTrash({
      "DELETE /api/trash": async () => {
        round++;
        if (round === 1) return json({ purged: 50, remaining: 70 });
        if (round === 2) {
          await gate; // dá tempo a ver o progresso entre o 1.º e o 2.º bloco
          return json({ purged: 50, remaining: 20 });
        }
        return json({ purged: 20, remaining: 0 });
      },
    });
    const { result } = renderWith(useEmptyTrash);
    await loaded(result);

    let finished!: Promise<unknown>;
    act(() => {
      finished = result.current.action.mutateAsync();
    });
    await waitFor(() => expect(result.current.action.purged).toBe(50));
    expect(server.callsTo("DELETE /api/trash")).toHaveLength(2);

    release();
    await act(() => finished);

    expect(result.current.action.data).toEqual({ purged: 120, remaining: 0 });
    expect(result.current.action.purged).toBe(120);
    expect(server.callsTo("DELETE /api/trash")).toHaveLength(3);
    await waitFor(() => {
      expect(server.callsTo("GET /api/trash")).toHaveLength(2);
      expect(server.callsTo("GET /api/auth/me")).toHaveLength(2);
    });
  });

  it("pára quando um pedido não elimina nada, mesmo que fiquem ficheiros (não repete sem fim)", async () => {
    const server = serveTrash({ "DELETE /api/trash": () => json({ purged: 0, remaining: 5 }) });
    const { result } = renderWith(useEmptyTrash);
    await loaded(result);

    await act(() => result.current.action.mutateAsync());

    expect(server.callsTo("DELETE /api/trash")).toHaveLength(1);
    expect(result.current.action.data).toEqual({ purged: 0, remaining: 5 });
  });

  it("um erro a meio pára o ciclo, fica no resultado e atualiza a lixeira com o que já foi eliminado", async () => {
    let round = 0;
    const server = serveTrash({
      "DELETE /api/trash": () =>
        ++round === 1 ? json({ purged: 50, remaining: 70 }) : apiError(500, "internal_error", "Erro interno do servidor."),
    });
    const { result } = renderWith(useEmptyTrash);
    await loaded(result);

    await act(() => result.current.action.mutateAsync().catch(() => undefined));

    await waitFor(() => expect(result.current.action.error?.message).toBe("Erro interno do servidor."));
    expect(result.current.action.purged).toBe(50);
    expect(server.callsTo("DELETE /api/trash")).toHaveLength(2);
    await waitFor(() => expect(server.callsTo("GET /api/trash")).toHaveLength(2));
  });
});
```

Criar `src/web/search.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SearchResult } from "../shared/types";
import { describeSearch, useSearch } from "./search";
import { useDeleteFile } from "./space";
import { json, mockApi, noContent } from "./test/mock-api";
import { queryWrapper, testQueryClient } from "./test/render";

const FOUND: SearchResult[] = [
  {
    kind: "file",
    path: [{ id: "f1", name: "Fotos" }],
    file: { id: "a1", name: "praia.png", folderId: "f1", size: 10, mime: "image/png", createdAt: 1 },
  },
];

describe("describeSearch", () => {
  it("tira os espaços das pontas e aceita 2 caracteres ou mais", () => {
    expect(describeSearch("  Relatório ")).toEqual({ term: "Relatório", problem: null });
    expect(describeSearch("ab").problem).toBeNull();
  });

  it("pede pelo menos 2 caracteres, depois de tirar os espaços e os acentos (como a API)", () => {
    for (const raw of ["", " a ", "́"]) {
      expect(describeSearch(raw).problem, JSON.stringify(raw)).toBe("Escreva pelo menos 2 caracteres.");
    }
  });

  it("recusa mais de 100 caracteres, mas aceita exatamente 100", () => {
    expect(describeSearch("x".repeat(100)).problem).toBeNull();
    expect(describeSearch("x".repeat(101)).problem).toBe("A pesquisa não pode ter mais de 100 caracteres.");
  });
});

describe("useSearch", () => {
  it("pede à API o texto sem espaços (com o URL codificado) e devolve os resultados", async () => {
    const server = mockApi({ "GET /api/search": () => json({ results: FOUND }) });
    const { result } = renderHook(() => useSearch("  praia & sol "), { wrapper: queryWrapper(testQueryClient()) });
    await waitFor(() => expect(result.current.data).toEqual(FOUND));
    expect(server.calls[0].query.get("q")).toBe("praia & sol");
  });

  it("não pede nada à API enquanto o texto não é válido", async () => {
    const server = mockApi({ "GET /api/search": () => json({ results: FOUND }) });
    const { result } = renderHook(() => useSearch("a"), { wrapper: queryWrapper(testQueryClient()) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
    expect(server.calls).toHaveLength(0);
  });

  it("depois de uma alteração ao espaço volta a pedir os resultados", async () => {
    const server = mockApi({
      "GET /api/search": () => json({ results: FOUND }),
      "DELETE /api/files/:id": () => noContent(),
    });
    const wrapper = queryWrapper(testQueryClient());
    const search = renderHook(() => useSearch("praia"), { wrapper });
    const remove = renderHook(() => useDeleteFile(), { wrapper });
    await waitFor(() => expect(search.result.current.isSuccess).toBe(true));

    await act(() => remove.result.current.mutateAsync("a1"));

    await waitFor(() => expect(server.callsTo("GET /api/search")).toHaveLength(2));
  });
});
```

Criar `src/web/shares.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ShareItem } from "../shared/types";
import { shareDownloadUrl, shareUrl, useCreateShare, usePublicShare, useRevokeShare, useShares } from "./shares";
import { apiError, json, mockApi, noContent } from "./test/mock-api";
import { queryWrapper, testQueryClient } from "./test/render";

const SHARE: ShareItem = { id: "s1", fileId: "a b", createdAt: 1, expiresAt: null };

describe("useShares", () => {
  it("lista os links do ficheiro (o id vai codificado no URL)", async () => {
    const server = mockApi({ "GET /api/files/:id/shares": () => json({ shares: [SHARE] }) });
    const { result } = renderHook(() => useShares("a b"), { wrapper: queryWrapper(testQueryClient()) });
    await waitFor(() => expect(result.current.data).toEqual([SHARE]));
    expect(server.calls[0].path).toBe("/api/files/a%20b/shares");
  });
});

describe("useCreateShare", () => {
  it("sem validade envia um corpo vazio e com validade envia `expiresAt`; devolve o token e atualiza a lista", async () => {
    const server = mockApi({
      "GET /api/files/:id/shares": () => json({ shares: [] }),
      "POST /api/files/:id/shares": () => json({ share: SHARE, token: "tok" }, 201),
    });
    const wrapper = queryWrapper(testQueryClient());
    const list = renderHook(() => useShares("a b"), { wrapper });
    const create = renderHook(() => useCreateShare("a b"), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));

    let created: { share: ShareItem; token: string } | undefined;
    await act(async () => {
      created = await create.result.current.mutateAsync(null);
      await create.result.current.mutateAsync(1_800_000_000_000);
    });

    expect(created).toEqual({ share: SHARE, token: "tok" });
    const [forever, until] = server.callsTo("POST /api/files/:id/shares");
    expect(forever).toMatchObject({ path: "/api/files/a%20b/shares", body: {} });
    expect(until.body).toEqual({ expiresAt: 1_800_000_000_000 });
    await waitFor(() => expect(server.callsTo("GET /api/files/:id/shares").length).toBeGreaterThanOrEqual(2));
  });

  it("um erro (por exemplo, links a mais) fica no resultado da mutação", async () => {
    mockApi({ "POST /api/files/:id/shares": () => apiError(409, "too_many_shares", "Este ficheiro já tem 20 links ativos.") });
    const { result } = renderHook(() => useCreateShare("a"), { wrapper: queryWrapper(testQueryClient()) });
    await act(() => result.current.mutateAsync(null).catch(() => undefined));
    await waitFor(() => expect(result.current.error).toMatchObject({ code: "too_many_shares" }));
  });

  it("o token não fica na cache das mutações quando deixa de haver quem a observe", async () => {
    mockApi({ "POST /api/files/:id/shares": () => json({ share: SHARE, token: "tok" }, 201) });
    const client = testQueryClient();
    const create = renderHook(() => useCreateShare("a"), { wrapper: queryWrapper(client) });
    await act(() => create.result.current.mutateAsync(null));
    expect(client.getMutationCache().getAll()).toHaveLength(1);

    create.unmount();

    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
  });
});

describe("useRevokeShare", () => {
  it("usa DELETE com o id da partilha e atualiza a lista de links", async () => {
    const server = mockApi({
      "GET /api/files/:id/shares": () => json({ shares: [SHARE] }),
      "DELETE /api/shares/:id": () => noContent(),
    });
    const wrapper = queryWrapper(testQueryClient());
    const list = renderHook(() => useShares("a b"), { wrapper });
    const revoke = renderHook(() => useRevokeShare("a b"), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));

    await act(() => revoke.result.current.mutateAsync("s 1"));

    expect(server.callsTo("DELETE /api/shares/:id")[0]).toMatchObject({ method: "DELETE", path: "/api/shares/s%201" });
    await waitFor(() => expect(server.callsTo("GET /api/files/:id/shares")).toHaveLength(2));
  });
});

describe("usePublicShare", () => {
  it("pede o nome e o tamanho pelo token (sem sessão)", async () => {
    const server = mockApi({ "GET /api/public/shares/:token": () => json({ name: "relatório.pdf", size: 1536 }) });
    const { result } = renderHook(() => usePublicShare("t/k"), { wrapper: queryWrapper(testQueryClient()) });
    await waitFor(() => expect(result.current.data).toEqual({ name: "relatório.pdf", size: 1536 }));
    expect(server.calls[0].path).toBe("/api/public/shares/t%2Fk");
  });

  it("um link inválido dá o erro `share_not_found`", async () => {
    mockApi({ "GET /api/public/shares/:token": () => apiError(404, "share_not_found", "Este link não existe ou já não está disponível.") });
    const { result } = renderHook(() => usePublicShare("x"), { wrapper: queryWrapper(testQueryClient()) });
    await waitFor(() => expect(result.current.error).toMatchObject({ status: 404, code: "share_not_found" }));
  });
});

describe("endereços de um link", () => {
  it("a página pública fica na origem da aplicação e o descarregamento na API pública", () => {
    expect(shareUrl("abc_-")).toBe(`${window.location.origin}/s/abc_-`);
    expect(shareDownloadUrl("abc_-")).toBe("/api/public/shares/abc_-/download");
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/trash.test.tsx src/web/search.test.tsx src/web/shares.test.tsx`
Expected: FAIL (Test Files  3 failed (3); Tests  no tests).

- [ ] **Step 2: Implementar `space.ts`, `search.ts`, `trash.ts` e `shares.ts`**

`useCreateShare` leva `gcTime: 0`: o token do link só pode viver enquanto o diálogo está aberto, e sem isso a cache das mutações guardava-o cinco minutos depois de o diálogo se fechar (o teste «o token não fica na cache das mutações…» de `shares.test.tsx` verifica-o).

Em `src/web/space.ts`, trocar:

```ts
export const TREE_KEY = ["tree"] as const;
export const CONFIG_KEY = ["config"] as const;
```

por:

```ts
export const TREE_KEY = ["tree"] as const;
export const CONFIG_KEY = ["config"] as const;
export const TRASH_KEY = ["trash"] as const;
export const SEARCH_KEY = ["search"] as const;
```

No mesmo ficheiro, trocar:

```ts
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
function useSpaceMutation
```

por:

```ts
/**
 * Depois de qualquer alteração ao espaço: as pastas listadas, a árvore do diálogo "Mover", a quota usada (barra lateral),
 * a lixeira e os resultados das pesquisas ficam desatualizados. Devolve a função que as invalida.
 */
export function useRefreshSpace() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [FOLDER] }),
      queryClient.invalidateQueries({ queryKey: TREE_KEY }),
      queryClient.invalidateQueries({ queryKey: ME_KEY }),
      queryClient.invalidateQueries({ queryKey: TRASH_KEY }),
      queryClient.invalidateQueries({ queryKey: SEARCH_KEY }),
    ]);
}

/** Mutação que atualiza o resto da interface quando termina, com êxito ou não (um erro pode vir de dados já velhos). */
export function useSpaceMutation
```

Criar `src/web/search.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { normalizeName, SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH, searchKey } from "../shared/names";
import type { SearchResult } from "../shared/types";
import { apiFetch } from "./api";
import { SEARCH_KEY } from "./space";

export interface SearchTerm {
  /** O que se pesquisa, sem espaços nas pontas. */
  term: string;
  /** Porque é que ainda não se pode pesquisar (em português), ou `null` se já se pode. */
  problem: string | null;
}

/** Aplica ao que o utilizador escreveu as mesmas regras da API, para não lhe pedir o que ela vai recusar. */
export function describeSearch(raw: string): SearchTerm {
  const term = normalizeName(raw);
  if (term.length > SEARCH_MAX_LENGTH) {
    return { term, problem: `A pesquisa não pode ter mais de ${SEARCH_MAX_LENGTH} caracteres.` };
  }
  if ([...searchKey(term)].length < SEARCH_MIN_LENGTH) {
    return { term, problem: `Escreva pelo menos ${SEARCH_MIN_LENGTH} caracteres.` };
  }
  return { term, problem: null };
}

/** Os resultados de uma pesquisa por nome; só pede à API quando o texto é válido (ver `describeSearch`). */
export function useSearch(raw: string) {
  const { term, problem } = describeSearch(raw);
  return useQuery({
    queryKey: [...SEARCH_KEY, term],
    queryFn: async () =>
      (await apiFetch<{ results: SearchResult[] }>(`/api/search?${new URLSearchParams({ q: term })}`)).results,
    enabled: problem === null,
  });
}
```

Criar `src/web/trash.ts`:

```ts
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { FileItem, TrashContents } from "../shared/types";
import { apiFetch } from "./api";
import { TRASH_KEY, useRefreshSpace, useSpaceMutation } from "./space";

/** A lixeira: no máximo os 200 ficheiros mais recentes; `total` conta todos. */
export function useTrash() {
  return useQuery({ queryKey: TRASH_KEY, queryFn: () => apiFetch<TrashContents>("/api/trash") });
}

/** Restaura um ficheiro (o servidor acrescenta " (restaurado)" ao nome se já existir um igual no destino). */
export function useRestoreFile() {
  return useSpaceMutation((id: string) =>
    apiFetch<{ file: FileItem }>(`/api/trash/${encodeURIComponent(id)}/restore`, { method: "POST" }),
  );
}

/** Elimina um ficheiro de vez (devolve o espaço). */
export function usePurgeFile() {
  return useSpaceMutation((id: string) => apiFetch(`/api/trash/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

export interface EmptyTrashResult {
  purged: number;
  /** Ficheiros que ficaram: só é maior do que 0 se o servidor deixou de conseguir eliminar. */
  remaining: number;
}

/**
 * Esvazia a lixeira. O servidor elimina um bloco de cada vez (`DELETE /api/trash` responde `{ purged, remaining }`):
 * repete-se até não ficar nenhum ou até um pedido não eliminar nada (outro pedido mexeu na lixeira, ou algo falha).
 * `purged` é o que já foi eliminado, para mostrar o progresso.
 */
export function useEmptyTrash() {
  const refresh = useRefreshSpace();
  const [purged, setPurged] = useState(0);
  const mutation = useMutation({
    mutationFn: async (): Promise<EmptyTrashResult> => {
      let total = 0;
      setPurged(0);
      for (;;) {
        const step = await apiFetch<EmptyTrashResult>("/api/trash", { method: "DELETE" });
        total += step.purged;
        setPurged(total);
        if (step.remaining === 0 || step.purged === 0) return { purged: total, remaining: step.remaining };
      }
    },
    onSettled: () => refresh(),
  });
  return { ...mutation, purged };
}
```

Criar `src/web/shares.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicShare, ShareItem } from "../shared/types";
import { apiFetch } from "./api";

const sharesKey = (fileId: string) => ["shares", fileId] as const;

/** Os links ativos de um ficheiro (nunca incluem o token: só se vê na criação). */
export function useShares(fileId: string) {
  return useQuery({
    queryKey: sharesKey(fileId),
    queryFn: async () =>
      (await apiFetch<{ shares: ShareItem[] }>(`/api/files/${encodeURIComponent(fileId)}/shares`)).shares,
  });
}

/** Cria um link; a variável é o fim da validade em milissegundos Unix (`null` = sem validade). O `token` só vem nesta resposta. */
export function useCreateShare(fileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // O token só vive enquanto o diálogo está aberto: sem `gcTime`, a cache das mutações guardava-o 5 minutos.
    gcTime: 0,
    mutationFn: (expiresAt: number | null) =>
      apiFetch<{ share: ShareItem; token: string }>(`/api/files/${encodeURIComponent(fileId)}/shares`, {
        method: "POST",
        json: expiresAt === null ? {} : { expiresAt },
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: sharesKey(fileId) }),
  });
}

/** Revoga um link (a variável é o id da partilha): deixa de funcionar logo. */
export function useRevokeShare(fileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => apiFetch(`/api/shares/${encodeURIComponent(shareId)}`, { method: "DELETE" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: sharesKey(fileId) }),
  });
}

/** O que a página pública de um link mostra (o nome e o tamanho do ficheiro). Um link inválido é 404 `share_not_found`. */
export function usePublicShare(token: string) {
  return useQuery({
    queryKey: ["public-share", token],
    queryFn: () => apiFetch<PublicShare>(`/api/public/shares/${encodeURIComponent(token)}`),
  });
}

/** O endereço da página pública de um link, para o dono o enviar a quem quer. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/s/${encodeURIComponent(token)}`;
}

/** O endereço do descarregamento de um link. */
export function shareDownloadUrl(token: string): string {
  return `/api/public/shares/${encodeURIComponent(token)}/download`;
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/trash.test.tsx src/web/search.test.tsx src/web/shares.test.tsx`
Expected: `Test Files  3 passed (3)`, `Tests  22 passed (22)`.

- [ ] **Step 3: Verificação e commit**

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  24 passed (24)`, `Tests  161 passed (161)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src
git commit -m "Acrescenta os hooks da pesquisa, da lixeira e da partilha e atualiza a lixeira e as pesquisas com o resto" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pesquisa: caixa na barra lateral, página `/pesquisa` e o caminho de cada resultado

**Files:**
- Create: `src/web/components/Location.tsx`, `src/web/components/Location.test.tsx`, `src/web/components/SearchBox.tsx`
- Create: `src/web/pages/SearchPage.tsx`, `src/web/pages/SearchPage.test.tsx`
- Modify: `src/web/components/ItemRows.tsx`, `src/web/components/AppLayout.tsx`, `src/web/App.tsx`

**Interfaces:**
- Consumes: `describeSearch`, `useSearch` (Task 2), `SEARCH_MAX_LENGTH` (Task 1), `FolderRow`/`FileRow`/`ItemRow` (Plano 2B), `Breadcrumb`'s `ROOT_LABEL`, `mockApi`/`SESSION`/`renderApp`.
- Produces: `Location({ path, prefix? })` (a Task 4 usa-o na lixeira); `FolderRow({ folder, path? })` e `FileRow({ file, path? })` mostram por baixo do nome a pasta onde o item está quando recebem `path`;
  `SearchBox` (na barra lateral de todas as páginas autenticadas) e `SEARCH_PATH` (`"/pesquisa"`); a rota `/pesquisa?q=...` (`SearchPage`).

- [ ] **Step 1: `Location`: a pasta onde um item está (teste primeiro)**

Um resultado de pesquisa só serve se se vir onde está. `Location` mostra «Em Meu espaço / Documentos / Contas» com uma ligação para a última pasta do caminho (ou para a raiz). A lixeira (Task 4) usa o mesmo componente com outro prefixo.

Criar `src/web/components/Location.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Location } from "./Location";

function show(path: Parameters<typeof Location>[0]["path"], prefix?: string) {
  render(
    <MemoryRouter>
      <Location path={path} prefix={prefix} />
    </MemoryRouter>,
  );
  return screen.getByRole("link");
}

describe("Location", () => {
  it("na raiz diz «Em Meu espaço» e liga à raiz", () => {
    const link = show([]);
    expect(link).toHaveTextContent("Em Meu espaço");
    expect(link).toHaveAttribute("href", "/");
  });

  it("numa pasta mostra o caminho todo e liga à última pasta", () => {
    const link = show([
      { id: "d1", name: "Documentos" },
      { id: "c1", name: "Contas 2026" },
    ]);
    expect(link).toHaveTextContent("Em Meu espaço / Documentos / Contas 2026");
    expect(link).toHaveAttribute("href", "/pasta/c1");
  });

  it("o prefixo pode ser outro", () => {
    expect(show([{ id: "d1", name: "Documentos" }], "Estava em")).toHaveTextContent("Estava em Meu espaço / Documentos");
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/Location.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/components/Location.tsx`:

```tsx
import { Link } from "react-router";
import type { BreadcrumbItem } from "../../shared/types";
import { ROOT_LABEL } from "../tree";

/** Onde um item está (`path` é o caminho da pasta que o contém; vazio = a raiz), com uma ligação para essa pasta. */
export function Location({ path, prefix = "Em" }: { path: BreadcrumbItem[]; prefix?: string }) {
  const target = path.length === 0 ? "/" : `/pasta/${path[path.length - 1].id}`;
  const label = [ROOT_LABEL, ...path.map((item) => item.name)].join(" / ");
  return (
    <Link to={target} title={label} className="block truncate text-xs text-slate-500 hover:underline">
      {prefix} {label}
    </Link>
  );
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/Location.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  3 passed (3)`.

- [ ] **Step 2: Página da pesquisa e caixa de pesquisa (testes primeiro)**

A pesquisa é uma página própria (`/pesquisa?q=...`) e não uma lista dentro de «Meu espaço»: a caixa está na barra lateral de todas as páginas autenticadas e o endereço da pesquisa pode ser copiado e voltar-se a ele com o botão «Voltar». Pesquisa-se ao carregar em Enter (ou em «Pesquisar»), não a cada tecla: não enche o histórico nem gasta leituras da D1 por cada letra. Os resultados reutilizam as linhas de «Meu espaço», por isso todas as ações (renomear, mover, excluir, partilhar) funcionam neles, e depois de cada uma a pesquisa atualiza-se (Task 2). Duas decisões de acessibilidade: o campo nunca é remontado (acompanha o texto pesquisado ajustando o estado durante a renderização, e não com uma `key`, que lhe tirava o foco a cada pesquisa), e o estado da pesquisa («A pesquisar…», «3 resultados», «Nenhum resultado…») é uma só linha `role="status"` sempre montada: o foco fica na caixa e os leitores de ecrã só anunciam o que muda dentro de uma região viva.

Criar `src/web/pages/SearchPage.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SearchResult } from "../../shared/types";
import { apiError, json, mockApi, noContent, SESSION } from "../test/mock-api";
import { renderApp } from "../test/render";

const EMPTY = { folder: null, breadcrumb: [], folders: [], files: [] };
const FILE_IN_FOTOS: SearchResult = {
  kind: "file",
  path: [{ id: "f1", name: "Fotos" }],
  file: { id: "a1", name: "praia.png", folderId: "f1", size: 1536, mime: "image/png", createdAt: 0 },
};
const FOLDER_IN_ROOT: SearchResult = {
  kind: "folder",
  path: [],
  folder: { id: "f9", name: "Praias do Sul", parentId: null, createdAt: 0 },
};
const NOTES_DEEP: SearchResult = {
  kind: "file",
  path: [
    { id: "d1", name: "Documentos" },
    { id: "c1", name: "Contas" },
  ],
  file: { id: "a2", name: "notas da praia.txt", folderId: "c1", size: 10, mime: "text/plain", createdAt: 0 },
};

function serve(results: SearchResult[] = [FILE_IN_FOTOS, FOLDER_IN_ROOT, NOTES_DEEP], extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    ...SESSION,
    "GET /api/folders/:id/contents": () => json(EMPTY),
    "GET /api/search": () => json({ results }),
    ...extra,
  });
}

const box = () => screen.getByRole("searchbox", { name: "Pesquisar por nome" });

describe("pesquisa", () => {
  it("escrever na caixa e carregar em Enter mostra os resultados, cada um com a pasta onde está", async () => {
    const server = serve();
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByRole("heading", { name: "Meu espaço" });

    const input = box();
    await user.type(input, "  praia {Enter}");

    expect(await screen.findByRole("heading", { name: "Resultados para «praia»" })).toBeInTheDocument();
    expect(server.calls.find((call) => call.path === "/api/search")?.query.get("q")).toBe("praia");
    expect(screen.getByText("3 resultados")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByRole("link", { name: "Em Meu espaço / Fotos" })).toHaveAttribute("href", "/pasta/f1");
    expect(within(rows[1]).getByRole("link", { name: "Praias do Sul" })).toHaveAttribute("href", "/pasta/f9");
    expect(within(rows[1]).getByRole("link", { name: "Em Meu espaço" })).toHaveAttribute("href", "/");
    expect(within(rows[2]).getByRole("link", { name: "Em Meu espaço / Documentos / Contas" })).toHaveAttribute("href", "/pasta/c1");
    expect(box()).toHaveValue("praia");
    expect(box()).toBe(input); // o campo não foi remontado...
    expect(input).toHaveFocus(); // ...por isso o teclado continua nele
  });

  it("abrir /pesquisa?q=... diretamente pesquisa e mostra o texto na caixa", async () => {
    serve([FILE_IN_FOTOS]);
    renderApp("/pesquisa?q=praia");
    expect(await screen.findByText("1 resultado")).toBeInTheDocument();
    expect(box()).toHaveValue("praia");
  });

  it("pesquisar outra vez, a partir da página da pesquisa, mantém o campo e o foco", async () => {
    serve();
    const user = userEvent.setup();
    renderApp("/pesquisa?q=praia");
    await screen.findByText("3 resultados");
    const input = box();

    await user.clear(input);
    await user.type(input, "casa{Enter}");

    expect(await screen.findByRole("heading", { name: "Resultados para «casa»" })).toBeInTheDocument();
    expect(box()).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("casa");
  });

  it("um texto curto não pede nada à API e diz o que falta; um vazio pede para escrever", async () => {
    const server = serve();
    const user = userEvent.setup();
    renderApp("/pesquisa?q=a");
    expect(await screen.findByText("Escreva pelo menos 2 caracteres.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pesquisa" })).toBeInTheDocument();
    expect(server.callsTo("GET /api/search")).toHaveLength(0);

    await user.clear(box());
    await user.type(box(), "ab{Enter}");
    expect(await screen.findByRole("heading", { name: "Resultados para «ab»" })).toBeInTheDocument();
  });

  it("sem texto (/pesquisa) pede para escrever o que procura; Enter com a caixa vazia não faz nada", async () => {
    const server = serve();
    const user = userEvent.setup();
    renderApp("/pesquisa");
    expect(await screen.findByText("Escreva o que procura na caixa de pesquisa.")).toBeInTheDocument();
    await user.type(box(), "   {Enter}");
    expect(screen.getByText("Escreva o que procura na caixa de pesquisa.")).toBeInTheDocument();
    expect(server.callsTo("GET /api/search")).toHaveLength(0);
  });

  it("sem resultados diz isso", async () => {
    serve([]);
    renderApp("/pesquisa?q=xyz");
    expect(await screen.findByText("Nenhum resultado para «xyz».")).toBeInTheDocument();
  });

  it("com 50 resultados avisa que podem existir mais", async () => {
    const many = Array.from({ length: 50 }, (_unused, index): SearchResult => ({
      kind: "file",
      path: [],
      file: { id: `a${index}`, name: `relatorio-${index}.txt`, folderId: null, size: 1, mime: "text/plain", createdAt: 0 },
    }));
    serve(many);
    renderApp("/pesquisa?q=relatorio");
    expect(await screen.findByText("Mostram-se os primeiros 50 resultados. Escreva mais para os afinar.")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(50);
  });

  it("um erro do servidor mostra a mensagem e deixa tentar de novo", async () => {
    let calls = 0;
    serve([], {
      "GET /api/search": () => (++calls === 1 ? apiError(500, "internal_error", "Erro interno do servidor.") : json({ results: [FILE_IN_FOTOS] })),
    });
    renderApp("/pesquisa?q=praia");
    expect(await screen.findByText("Erro interno do servidor.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("1 resultado")).toBeInTheDocument();
  });

  it("a caixa limpa-se ao sair da página da pesquisa", async () => {
    serve([FILE_IN_FOTOS]);
    const user = userEvent.setup();
    renderApp("/pesquisa?q=praia");
    await screen.findByText("1 resultado");

    await user.click(within(screen.getByRole("navigation", { name: "Principal" })).getByRole("link", { name: "Meu espaço" }));

    expect(await screen.findByRole("heading", { name: "Meu espaço" })).toBeInTheDocument();
    expect(box()).toHaveValue("");
  });

  it("as ações de um resultado funcionam e a pesquisa atualiza-se: excluir tira-o dos resultados", async () => {
    let deleted = false;
    serve([], {
      "GET /api/search": () => json({ results: deleted ? [FOLDER_IN_ROOT] : [FILE_IN_FOTOS, FOLDER_IN_ROOT] }),
      "DELETE /api/files/:id": () => {
        deleted = true;
        return noContent();
      },
    });
    const user = userEvent.setup();
    renderApp("/pesquisa?q=praia");
    await user.click(await screen.findByRole("button", { name: "Ações para o ficheiro praia.png" }));
    await user.click(screen.getByRole("menuitem", { name: "Excluir" }));
    await user.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() => expect(screen.queryByText("praia.png")).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Praias do Sul" })).toBeInTheDocument();
  });

  it("o estado da pesquisa é anunciado numa só região viva que fica montada de «A pesquisar…» até aos resultados", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    serve([], {
      "GET /api/search": async () => {
        await gate;
        return json({ results: [FILE_IN_FOTOS] });
      },
    });
    renderApp("/pesquisa?q=praia");
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("A pesquisar…"));

    release();

    await waitFor(() => expect(status).toHaveTextContent("1 resultado"));
    expect(screen.getByRole("status")).toBe(status); // o mesmo elemento: os leitores de ecrã anunciam a mudança
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/pages/SearchPage.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  11 failed (11)).

Em `src/web/components/ItemRows.tsx`, substituir o bloco de `import` no topo do ficheiro (todas as linhas de `import`, até à linha em branco) por:

```tsx
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { formatBytes, formatDate } from "../../shared/format";
import { previewContentType } from "../../shared/preview";
import type { BreadcrumbItem, FileItem, FolderItem } from "../../shared/types";
import { FileActions } from "./FileActions";
import { FolderActions } from "./FolderActions";
import { FileIcon, FolderIcon } from "./icons";
import { Location } from "./Location";
import { PreviewDialog } from "./PreviewDialog";
```

Em `src/web/components/ItemRows.tsx`, trocar:

```tsx
  name: ReactNode;
  size: string;
```

por:

```tsx
  name: ReactNode;
  /** Uma linha por baixo do nome, por exemplo a pasta onde o item está. */
  subtitle?: ReactNode;
  size: string;
```

No mesmo ficheiro, trocar:

```tsx
function ItemRow({ icon, name, size, date, actions }: ItemRowProps) {
```

por:

```tsx
function ItemRow({ icon, name, subtitle, size, date, actions }: ItemRowProps) {
```

No mesmo ficheiro, trocar:

```tsx
      <span className="min-w-0 flex-1">{name}</span>
```

por:

```tsx
      <span className="min-w-0 flex-1">
        {name}
        {subtitle}
      </span>
```

No mesmo ficheiro, trocar:

```tsx
export function FolderRow({ folder }: { folder: FolderItem }) {
  return (
    <ItemRow
      icon={<FolderIcon />}
```

por:

```tsx
/** `path`: o caminho da pasta que a contém; só se passa nos resultados da pesquisa (na listagem de uma pasta é óbvio). */
export function FolderRow({ folder, path }: { folder: FolderItem; path?: BreadcrumbItem[] }) {
  return (
    <ItemRow
      icon={<FolderIcon />}
      subtitle={path && <Location path={path} />}
```

No mesmo ficheiro, trocar:

```tsx
export function FileRow({ file }: { file: FileItem }) {
  const [previewing, setPreviewing] = useState(false);
  const canPreview = previewContentType(file.name) !== null;
  const openPreview = () => setPreviewing(true);
  return (
    <ItemRow
      icon={<FileIcon />}
```

por:

```tsx
export function FileRow({ file, path }: { file: FileItem; path?: BreadcrumbItem[] }) {
  const [previewing, setPreviewing] = useState(false);
  const canPreview = previewContentType(file.name) !== null;
  const openPreview = () => setPreviewing(true);
  return (
    <ItemRow
      icon={<FileIcon />}
      subtitle={path && <Location path={path} />}
```

Criar `src/web/components/SearchBox.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { SEARCH_MAX_LENGTH } from "../../shared/names";
import { describeSearch } from "../search";
import { Button } from "./Button";

export const SEARCH_PATH = "/pesquisa";

/**
 * A caixa de pesquisa da barra lateral: Enter (ou «Pesquisar») leva a `/pesquisa?q=...`. Na página da pesquisa mostra o texto
 * pesquisado; quando o texto pesquisado muda (outra pesquisa, o botão «Voltar», sair da página da pesquisa) o campo acompanha-o.
 * O campo nunca é remontado, por isso mantém o foco depois de pesquisar.
 */
export function SearchBox() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const searched = pathname === SEARCH_PATH ? (params.get("q") ?? "") : "";
  const [text, setText] = useState(searched);
  // Acompanha o texto pesquisado ajustando o estado durante a renderização. Uma `key` no formulário fazia o mesmo, mas remontava o
  // campo e tirava-lhe o foco a cada pesquisa.
  const [followed, setFollowed] = useState(searched);
  if (followed !== searched) {
    setFollowed(searched);
    setText(searched);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const { term } = describeSearch(text);
    if (term !== "") navigate(`${SEARCH_PATH}?${new URLSearchParams({ q: term })}`);
  }

  return (
    <form role="search" onSubmit={onSubmit} className="flex gap-2">
      <input
        type="search"
        aria-label="Pesquisar por nome"
        placeholder="Pesquisar…"
        maxLength={SEARCH_MAX_LENGTH}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
      />
      <Button type="submit" variant="secondary" className="px-3">
        Pesquisar
      </Button>
    </form>
  );
}
```

Criar `src/web/pages/SearchPage.tsx`:

```tsx
import { useSearchParams } from "react-router";
import { errorMessage } from "../api";
import { Button } from "../components/Button";
import { FileRow, FolderRow } from "../components/ItemRows";
import { Message } from "../components/Message";
import { describeSearch, useSearch } from "../search";

/** O servidor devolve no máximo 50 resultados. */
const MAX_RESULTS = 50;

/** Os resultados de uma pesquisa por nome (`/pesquisa?q=...`): pastas e ficheiros, cada um com a pasta onde está. */
export default function SearchPage() {
  const [params] = useSearchParams();
  const raw = params.get("q") ?? "";
  const { term, problem } = describeSearch(raw);
  const search = useSearch(raw);
  const results = problem === null ? search.data : undefined;

  // Uma só linha de estado, sempre montada e com `role="status"`: o foco fica na caixa de pesquisa e os leitores de ecrã só anunciam
  // o que muda dentro de uma região viva (uma linha nova a cada estado não seria anunciada).
  let status = "";
  if (term === "") status = "Escreva o que procura na caixa de pesquisa.";
  else if (problem !== null) status = problem;
  else if (results !== undefined) {
    if (results.length === 0) status = `Nenhum resultado para «${term}».`;
    else if (results.length >= MAX_RESULTS) status = `Mostram-se os primeiros ${MAX_RESULTS} resultados. Escreva mais para os afinar.`;
    else status = `${results.length} ${results.length === 1 ? "resultado" : "resultados"}`;
  } else if (search.isPending) status = "A pesquisar…";

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight break-words">
        {problem === null ? `Resultados para «${term}»` : "Pesquisa"}
      </h1>
      <p role="status" className="mt-4 text-sm text-slate-600">
        {status}
      </p>
      {problem === null && search.isError && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Message kind="error">{errorMessage(search.error)}</Message>
          <Button variant="secondary" onClick={() => void search.refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {results !== undefined && results.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {results.map((result) =>
            result.kind === "folder" ? (
              <FolderRow key={`folder-${result.folder.id}`} folder={result.folder} path={result.path} />
            ) : (
              <FileRow key={`file-${result.file.id}`} file={result.file} path={result.path} />
            ),
          )}
        </ul>
      )}
    </div>
  );
}
```

Em `src/web/App.tsx`, nos `import`, trocar:

```tsx
import RegisterPage from "./pages/RegisterPage";
```

por:

```tsx
import RegisterPage from "./pages/RegisterPage";
import SearchPage from "./pages/SearchPage";
```

Nas rotas, trocar:

```tsx
        <Route path="pasta/:folderId" element={<FolderRoute />} />
```

por:

```tsx
        <Route path="pasta/:folderId" element={<FolderRoute />} />
        <Route path="pesquisa" element={<SearchPage />} />
```

Em `src/web/components/AppLayout.tsx`, nos `import`, trocar:

```tsx
import { Message } from "./Message";
import { UploadPanel } from "./UploadPanel";
```

por:

```tsx
import { Message } from "./Message";
import { SearchBox } from "./SearchBox";
import { UploadPanel } from "./UploadPanel";
```

Na barra lateral, trocar:

```tsx
        <div className="text-xl font-bold tracking-tight text-indigo-600">SpaceWork</div>
        <nav className=
```

por:

```tsx
        <div className="text-xl font-bold tracking-tight text-indigo-600">SpaceWork</div>
        <SearchBox />
        <nav className=
```

Run: `npx vitest run -c vitest.web.config.ts src/web/pages/SearchPage.test.tsx src/web/components/Location.test.tsx`
Expected: `Test Files  2 passed (2)`, `Tests  14 passed (14)`.

- [ ] **Step 3: Verificação e commit**

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  26 passed (26)`, `Tests  175 passed (175)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npm run build`
Expected: `✓ built in ...` duas vezes (Worker e cliente).

Commit:

```bash
git add src
git commit -m "Acrescenta a pesquisa por nome: caixa na barra lateral, página de resultados e o caminho de cada resultado" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Lixeira: ecrã `/lixeira` com restaurar, eliminar de vez e esvaziar

**Files:**
- Create: `src/web/pages/TrashPage.tsx`, `src/web/pages/TrashPage.test.tsx`
- Modify: `src/web/components/ConfirmDialog.tsx`, `src/web/components/ConfirmDialog.test.tsx`, `src/web/components/AppLayout.tsx`, `src/web/App.tsx`

**Interfaces:**
- Consumes: `useTrash`, `useRestoreFile`, `usePurgeFile`, `useEmptyTrash` (Task 2), `Location` (Task 3), `ConfirmDialog`, `ApiRequestError`, `formatBytes`, `formatDate`.
- Produces: a rota `/lixeira` (`TrashPage`) e a ligação «Lixeira» na barra lateral; `ConfirmDialog` com a propriedade opcional `pendingLabel` (por defeito «A excluir…») e que não se fecha, nem por Esc ou clique no fundo, enquanto `pending`.

- [ ] **Step 1: `ConfirmDialog`: texto de «a decorrer» configurável e sem fechar enquanto a ação decorre (testes primeiro)**

Pendente do Plano 2B: o botão dizia sempre «A excluir…». Na lixeira a ação é «A eliminar…». A propriedade é opcional e o valor por defeito é o de hoje, por isso nada mais muda. Além disso, enquanto o pedido decorre o diálogo não se pode fechar: se se fechasse (Esc, clique no fundo ou «Cancelar»), a página esquecia que havia uma ação a correr (o `reset()` da mutação só a desliga do componente) e voltava a ativar os botões da lista, enquanto o pedido, que não se cancela, continuava (um segundo «Esvaziar lixeira» em paralelo, ou restaurar um ficheiro que o ciclo está a eliminar). Por isso `ConfirmDialog` ignora o Esc e o fundo e desativa «Cancelar» enquanto `pending`: vale para a lixeira, para excluir um ficheiro ou uma pasta e para «Sair».

Em `src/web/components/ConfirmDialog.test.tsx`, nos `import`, trocar:

```tsx
import { render, screen } from "@testing-library/react";
```

por:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
```

No fim do `describe`, trocar:

```tsx
    expect(screen.getByRole("button", { name: "A excluir…" })).toBeDisabled();
  });
});
```

por:

```tsx
    expect(screen.getByRole("button", { name: "A excluir…" })).toBeDisabled();
  });

  it("o texto do botão enquanto a ação decorre pode ser outro", () => {
    setup({ pending: true, pendingLabel: "A eliminar…" });
    expect(screen.getByRole("button", { name: "A eliminar…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "A excluir…" })).not.toBeInTheDocument();
  });

  it("enquanto a ação decorre, «Cancelar» está desativado (não a pode parar)", () => {
    setup({ pending: true });
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  });

  it("enquanto a ação decorre, Esc e o fundo não fecham o diálogo", () => {
    const { onClose } = setup({ pending: true });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.mouseDown(screen.getByTestId("modal-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("quando não decorre nada, Esc fecha o diálogo", () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/ConfirmDialog.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  3 failed | 4 passed (7)).

Em `src/web/components/ConfirmDialog.tsx`, trocar:

```tsx
  confirmLabel: string;
  pending: boolean;
```

por:

```tsx
  confirmLabel: string;
  /** O texto do botão enquanto a ação decorre. */
  pendingLabel?: string;
  pending: boolean;
```

No mesmo ficheiro, trocar:

```tsx
export function ConfirmDialog({ title, message, confirmLabel, pending, error, onConfirm, onClose }: ConfirmDialogProps) {
```

por:

```tsx
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  pendingLabel = "A excluir…",
  pending,
  error,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
```

No mesmo ficheiro, trocar:

```tsx
{pending ? "A excluir…" : confirmLabel}
```

por:

```tsx
{pending ? pendingLabel : confirmLabel}
```

No mesmo ficheiro, o diálogo ignora Esc e o fundo enquanto a ação decorre. Trocar:

```tsx
    <Modal title={title} onClose={onClose}>
```

por:

```tsx
    <Modal title={title} onClose={() => !pending && onClose()}>
```

No mesmo ficheiro, «Cancelar» fica desativado enquanto a ação decorre. Trocar:

```tsx
          <Button variant="secondary" onClick={onClose}>
            Cancelar
```

por:

```tsx
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancelar
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/ConfirmDialog.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  7 passed (7)`.

- [ ] **Step 2: O ecrã da lixeira (testes primeiro)**

O ecrã lista os ficheiros excluídos (no máximo 200, os mais recentes; se há mais, diz quantos faltam ver), cada um com a pasta onde estava, o tamanho, quando foi excluído e quando a limpeza automática o elimina. «Restaurar» devolve-o à pasta de origem (ou à raiz, se a pasta já não existe) e avisa com que nome ficou. «Eliminar de vez» e «Esvaziar lixeira» pedem confirmação; esvaziar repete o pedido por blocos até acabar e mostra «A eliminar… 50 de 120». O 409 do restauro (dez nomes já ocupados) tem uma mensagem própria: a da API fala de «um envio em curso», o que aqui não faz sentido.

Criar `src/web/pages/TrashPage.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { TrashContents, TrashItem } from "../../shared/types";
import { apiError, json, ME, mockApi, noContent, SESSION } from "../test/mock-api";
import { renderApp } from "../test/render";

const DAY = 86_400_000;
const DELETED = new Date(2026, 9, 3, 12).getTime();

const OLD: TrashItem = {
  id: "t1",
  name: "relatório.pdf",
  size: 1536,
  mime: "application/pdf",
  folderId: "f1",
  path: [{ id: "f1", name: "Fotos" }],
  deletedAt: DELETED,
  purgeAt: DELETED + 30 * DAY,
};
const IN_ROOT: TrashItem = { ...OLD, id: "t2", name: "notas.txt", size: 10, mime: "text/plain", folderId: null, path: [] };

const trashOf = (items: TrashItem[], total = items.length): TrashContents => ({ items, total, retentionDays: 30 });

function serve(initial: TrashContents, extra: Parameters<typeof mockApi>[0] = {}) {
  let current = initial;
  const server = mockApi({
    ...SESSION,
    "GET /api/folders/:id/contents": () => json({ folder: null, breadcrumb: [], folders: [], files: [] }),
    "GET /api/trash": () => json(current),
    ...extra,
  });
  return { server, set: (next: TrashContents) => (current = next), get: () => current };
}

describe("TrashPage: listagem", () => {
  it("mostra cada ficheiro com a pasta onde estava, o tamanho e as datas, e quantos dias a lixeira os guarda", async () => {
    serve(trashOf([OLD, IN_ROOT]));
    renderApp("/lixeira");
    expect(await screen.findByRole("heading", { name: "Lixeira" })).toBeInTheDocument();
    expect(screen.getByText(/ficam aqui 30 dias/)).toBeInTheDocument();
    const first = screen.getByText("relatório.pdf").closest("li")!;
    expect(within(first).getByRole("link", { name: "Estava em Meu espaço / Fotos" })).toHaveAttribute("href", "/pasta/f1");
    expect(within(first).getByText("1,5 KB")).toBeInTheDocument();
    expect(within(first).getByText("Excluído a 03/10/2026 · eliminado de vez a 02/11/2026")).toBeInTheDocument();
    const second = screen.getByText("notas.txt").closest("li")!;
    expect(within(second).getByRole("link", { name: "Estava em Meu espaço" })).toHaveAttribute("href", "/");
  });

  it("«Lixeira» está na barra lateral e fica ativa nesta página", async () => {
    serve(trashOf([]));
    renderApp("/lixeira");
    const link = await screen.findByRole("link", { name: "Lixeira" });
    expect(link).toHaveAttribute("href", "/lixeira");
    expect(link.className).toContain("bg-indigo-50");
  });

  it("vazia diz isso e não deixa esvaziar", async () => {
    serve(trashOf([]));
    renderApp("/lixeira");
    expect(await screen.findByText("A lixeira está vazia.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Esvaziar lixeira" })).toBeDisabled();
  });

  it("com mais ficheiros do que os que a API lista, avisa que só mostra os mais recentes", async () => {
    serve(trashOf([OLD], 250));
    renderApp("/lixeira");
    expect(await screen.findByText("Mostram-se os 1 mais recentes de 250. Os restantes aparecem à medida que eliminar ou restaurar estes.")).toBeInTheDocument();
  });

  it("um erro do servidor mostra a mensagem e deixa tentar de novo", async () => {
    let calls = 0;
    serve(trashOf([]), {
      "GET /api/trash": () => (++calls === 1 ? apiError(500, "internal_error", "Erro interno do servidor.") : json(trashOf([OLD]))),
    });
    renderApp("/lixeira");
    expect(await screen.findByText("Erro interno do servidor.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("relatório.pdf")).toBeInTheDocument();
  });
});

describe("TrashPage: restaurar", () => {
  it("restaura o ficheiro, tira-o da lista e avisa", async () => {
    const state = serve(trashOf([OLD, IN_ROOT]), {
      "POST /api/trash/:id/restore": () => {
        state.set(trashOf([IN_ROOT]));
        return json({ file: { id: "t1", name: "relatório.pdf", folderId: "f1", size: 1536, mime: "application/pdf", createdAt: 1 } });
      },
    });
    const user = userEvent.setup();
    renderApp("/lixeira");
    await user.click(await screen.findByRole("button", { name: "Restaurar relatório.pdf" }));

    expect(await screen.findByText("«relatório.pdf» foi restaurado.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Restaurar relatório.pdf" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Restaurar notas.txt" })).toBeInTheDocument();
    expect(state.server.callsTo("POST /api/trash/:id/restore")[0].params.id).toBe("t1");
  });

  it("se o nome já estava em uso, diz como ficou o ficheiro restaurado", async () => {
    serve(trashOf([OLD]), {
      "POST /api/trash/:id/restore": () =>
        json({ file: { id: "t1", name: "relatório.pdf (restaurado)", folderId: "f1", size: 1536, mime: "application/pdf", createdAt: 1 } }),
    });
    const user = userEvent.setup();
    renderApp("/lixeira");
    await user.click(await screen.findByRole("button", { name: "Restaurar relatório.pdf" }));
    expect(
      await screen.findByText("«relatório.pdf (restaurado)» foi restaurado (já existia um ficheiro chamado «relatório.pdf» no mesmo local)."),
    ).toBeInTheDocument();
  });

  it("o 409 dos nomes todos ocupados tem uma mensagem própria (a da API fala de um envio em curso)", async () => {
    serve(trashOf([OLD]), {
      "POST /api/trash/:id/restore": () => apiError(409, "name_taken", "Já existe um ficheiro com esse nome neste local (pode ser um envio ainda em curso)."),
    });
    const user = userEvent.setup();
    renderApp("/lixeira");
    await user.click(await screen.findByRole("button", { name: "Restaurar relatório.pdf" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("já existem demasiados ficheiros com este nome na pasta");
    expect(alert).not.toHaveTextContent("envio");
    expect(screen.getByText("relatório.pdf")).toBeInTheDocument(); // continua na lixeira
  });

  it("um ficheiro que já não está na lixeira mostra o erro e a lista atualiza-se", async () => {
    const state = serve(trashOf([OLD]), {
      "POST /api/trash/:id/restore": () => {
        state.set(trashOf([]));
        return apiError(404, "file_not_found", "Ficheiro não encontrado na lixeira.");
      },
    });
    const user = userEvent.setup();
    renderApp("/lixeira");
    await user.click(await screen.findByRole("button", { name: "Restaurar relatório.pdf" }));
    expect(await screen.findByText("Ficheiro não encontrado na lixeira.")).toBeInTheDocument();
    expect(await screen.findByText("A lixeira está vazia.")).toBeInTheDocument();
  });
});

describe("TrashPage: eliminar de vez", () => {
  it("pede confirmação, elimina o ficheiro e atualiza o espaço usado", async () => {
    let purged = false;
    const state = serve(trashOf([OLD, IN_ROOT]), {
      "GET /api/auth/me": () => json({ user: { ...ME, usedBytes: purged ? 10 : 1546 } }),
      "DELETE /api/trash/:id": () => {
        purged = true;
        state.set(trashOf([IN_ROOT]));
        return noContent();
      },
    });
    const user = userEvent.setup();
    renderApp("/lixeira");
    expect(await screen.findByText("1,5 KB de 1 GB")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Eliminar de vez relatório.pdf" }));
    const dialog = screen.getByRole("dialog", { name: "Eliminar de vez" });
    expect(dialog).toHaveTextContent("Eliminar «relatório.pdf» de vez? Não se pode desfazer e o espaço é libertado.");
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "Eliminar de vez" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("relatório.pdf")).not.toBeInTheDocument();
    expect(state.server.callsTo("DELETE /api/trash/:id")[0].params.id).toBe("t1");
    expect(await screen.findByText("10 B de 1 GB")).toBeInTheDocument();
  });

  it("Cancelar não elimina nada", async () => {
    const state = serve(trashOf([OLD]), { "DELETE /api/trash/:id": () => noContent() });
    const user = userEvent.setup();
    renderApp("/lixeira");
    await user.click(await screen.findByRole("button", { name: "Eliminar de vez relatório.pdf" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(state.server.callsTo("DELETE /api/trash/:id")).toHaveLength(0);
  });

  it("um erro fica no diálogo, que continua aberto", async () => {
    serve(trashOf([OLD]), {
      "DELETE /api/trash/:id": () => apiError(404, "file_not_found", "Ficheiro não encontrado na lixeira."),
    });
    const user = userEvent.setup();
    renderApp("/lixeira");
    await user.click(await screen.findByRole("button", { name: "Eliminar de vez relatório.pdf" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Eliminar de vez" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ficheiro não encontrado na lixeira.");
    expect(screen.getByRole("dialog", { name: "Eliminar de vez" })).toBeInTheDocument();
  });

  it("enquanto elimina, Esc e o fundo não fecham o diálogo, «Cancelar» está desativado e a lista também", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const state = serve(trashOf([OLD, IN_ROOT]), {
      "DELETE /api/trash/:id": async () => {
        await gate;
        state.set(trashOf([IN_ROOT]));
        return noContent();
      },
    });
    const user = userEvent.setup();
    renderApp("/lixeira");
    await user.click(await screen.findByRole("button", { name: "Eliminar de vez relatório.pdf" }));
    const dialog = screen.getByRole("dialog", { name: "Eliminar de vez" });
    await user.click(within(dialog).getByRole("button", { name: "Eliminar de vez" }));
    await within(dialog).findByRole("button", { name: "A eliminar…" });

    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.mouseDown(screen.getByTestId("modal-backdrop"));

    expect(screen.getByRole("dialog", { name: "Eliminar de vez" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restaurar notas.txt" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(state.server.callsTo("DELETE /api/trash/:id")).toHaveLength(1);
  });
});

describe("TrashPage: esvaziar", () => {
  it("pede confirmação, repete até a lixeira ficar vazia, mostra o progresso e fecha", async () => {
    let round = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const state = serve(trashOf([OLD, IN_ROOT], 120), {
      "DELETE /api/trash": async () => {
        round++;
        if (round === 1) return json({ purged: 50, remaining: 70 });
        if (round === 2) {
          await gate;
          return json({ purged: 50, remaining: 20 });
        }
        state.set(trashOf([]));
        return json({ purged: 20, remaining: 0 });
      },
    });
    const user = userEvent.setup();
    renderApp("/lixeira");
    await user.click(await screen.findByRole("button", { name: "Esvaziar lixeira" }));
    const dialog = screen.getByRole("dialog", { name: "Esvaziar a lixeira" });
    expect(dialog).toHaveTextContent("Eliminar de vez os 120 ficheiros da lixeira? Não se pode desfazer e o espaço é libertado.");

    await user.click(within(dialog).getByRole("button", { name: "Esvaziar lixeira" }));

    expect(await within(dialog).findByText("A eliminar… 50 de 120")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "A eliminar…" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("A lixeira está vazia.")).toBeInTheDocument();
    expect(state.server.callsTo("DELETE /api/trash")).toHaveLength(3);
  });

  it("com um só ficheiro a pergunta fala no singular", async () => {
    serve(trashOf([OLD]));
    const user = userEvent.setup();
    renderApp("/lixeira");
    await user.click(await screen.findByRole("button", { name: "Esvaziar lixeira" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Eliminar de vez o ficheiro da lixeira?");
  });

  it("se o servidor deixa de eliminar, o diálogo fica aberto e diz quantos ficaram", async () => {
    serve(trashOf([OLD]), { "DELETE /api/trash": () => json({ purged: 0, remaining: 3 }) });
    const user = userEvent.setup();
    renderApp("/lixeira");
    await user.click(await screen.findByRole("button", { name: "Esvaziar lixeira" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Esvaziar lixeira" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível eliminar todos os ficheiros: ficaram 3. Tente de novo.");
    expect(screen.getByRole("dialog", { name: "Esvaziar a lixeira" })).toBeInTheDocument();
  });

  it("um erro de rede ou do servidor fica no diálogo", async () => {
    serve(trashOf([OLD]), { "DELETE /api/trash": () => apiError(500, "internal_error", "Erro interno do servidor.") });
    const user = userEvent.setup();
    renderApp("/lixeira");
    await user.click(await screen.findByRole("button", { name: "Esvaziar lixeira" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Esvaziar lixeira" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Erro interno do servidor.");
  });

  it("enquanto esvazia, Esc e o fundo não fecham o diálogo, «Cancelar» está desativado e a lista também", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const state = serve(trashOf([OLD], 1), {
      "DELETE /api/trash": async () => {
        await gate;
        state.set(trashOf([]));
        return json({ purged: 1, remaining: 0 });
      },
    });
    const user = userEvent.setup();
    renderApp("/lixeira");
    await user.click(await screen.findByRole("button", { name: "Esvaziar lixeira" }));
    const dialog = screen.getByRole("dialog", { name: "Esvaziar a lixeira" });
    await user.click(within(dialog).getByRole("button", { name: "Esvaziar lixeira" }));
    await within(dialog).findByText("A eliminar… 0 de 1");

    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.mouseDown(screen.getByTestId("modal-backdrop"));

    expect(screen.getByRole("dialog", { name: "Esvaziar a lixeira" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restaurar relatório.pdf" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("A lixeira está vazia.")).toBeInTheDocument();
    expect(state.server.callsTo("DELETE /api/trash")).toHaveLength(1);
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/pages/TrashPage.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  18 failed (18)).

Criar `src/web/pages/TrashPage.tsx`:

```tsx
import { useState } from "react";
import { formatBytes, formatDate } from "../../shared/format";
import type { TrashItem } from "../../shared/types";
import { ApiRequestError, errorMessage } from "../api";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FileIcon } from "../components/icons";
import { Location } from "../components/Location";
import { Message } from "../components/Message";
import { useEmptyTrash, usePurgeFile, useRestoreFile, useTrash } from "../trash";

const NAME_TAKEN_MESSAGE =
  "Não foi possível restaurar: já existem demasiados ficheiros com este nome na pasta. Renomeie ou elimine alguns e tente de novo.";

function restoreErrorMessage(error: unknown): string {
  // A mensagem da API fala de «um envio em curso», o que aqui não faz sentido: o ficheiro já existia.
  return error instanceof ApiRequestError && error.code === "name_taken" ? NAME_TAKEN_MESSAGE : errorMessage(error);
}

function TrashRow({
  item,
  restoring,
  disabled,
  onRestore,
  onPurge,
}: {
  item: TrashItem;
  restoring: boolean;
  disabled: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2 hover:bg-slate-50">
      <FileIcon />
      <span className="min-w-0 flex-1 basis-48">
        <span title={item.name} className="block truncate">
          {item.name}
        </span>
        <Location path={item.path} prefix="Estava em" />
        <span className="block text-xs text-slate-500">
          Excluído a {formatDate(item.deletedAt)} · eliminado de vez a {formatDate(item.purgeAt)}
        </span>
      </span>
      <span className="hidden w-24 shrink-0 text-right text-sm text-slate-500 sm:block">{formatBytes(item.size)}</span>
      <span className="flex shrink-0 gap-2">
        <Button variant="secondary" className="px-3 py-1.5" disabled={disabled} aria-label={`Restaurar ${item.name}`} onClick={onRestore}>
          {restoring ? "A restaurar…" : "Restaurar"}
        </Button>
        <Button variant="secondary" className="px-3 py-1.5" disabled={disabled} aria-label={`Eliminar de vez ${item.name}`} onClick={onPurge}>
          Eliminar de vez
        </Button>
      </span>
    </li>
  );
}

/** A lixeira: os ficheiros excluídos, que se podem restaurar ou eliminar de vez (um a um ou todos). */
export default function TrashPage() {
  const trash = useTrash();
  const restore = useRestoreFile();
  const purge = usePurgeFile();
  const empty = useEmptyTrash();
  const [purging, setPurging] = useState<TrashItem | null>(null);
  const [emptying, setEmptying] = useState(false);
  const [restored, setRestored] = useState<string | null>(null);

  if (trash.isPending) return <p className="text-slate-500">A carregar…</p>;
  if (trash.isError && trash.data === undefined) {
    return (
      <div className="max-w-md space-y-4">
        <Message kind="error">{errorMessage(trash.error)}</Message>
        <Button variant="secondary" onClick={() => void trash.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const { items, total, retentionDays } = trash.data;
  const busy = restore.isPending || purge.isPending || empty.isPending;

  function startRestore(item: TrashItem) {
    setRestored(null);
    restore.mutate(item.id, {
      onSuccess: ({ file }) =>
        setRestored(
          file.name === item.name
            ? `«${file.name}» foi restaurado.`
            : `«${file.name}» foi restaurado (já existia um ficheiro chamado «${item.name}» no mesmo local).`,
        ),
    });
  }

  function closePurge() {
    setPurging(null);
    purge.reset();
  }

  function closeEmpty() {
    setEmptying(false);
    empty.reset();
  }

  const emptyStuck = empty.data !== undefined && empty.data.remaining > 0;
  let emptyError: string | null = null;
  if (empty.error) emptyError = errorMessage(empty.error);
  else if (emptyStuck) emptyError = `Não foi possível eliminar todos os ficheiros: ficaram ${empty.data!.remaining}. Tente de novo.`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Lixeira</h1>
        <Button variant="danger" disabled={total === 0 || busy} onClick={() => setEmptying(true)}>
          Esvaziar lixeira
        </Button>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Os ficheiros excluídos ficam aqui {retentionDays} dias e depois são eliminados de vez. Até lá continuam a ocupar espaço.
      </p>

      {trash.isError && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Message kind="error">{errorMessage(trash.error)}</Message>
          <Button variant="secondary" onClick={() => void trash.refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {restored && (
        <div className="mt-4">
          <Message kind="success">{restored}</Message>
        </div>
      )}
      {restore.error && (
        <div className="mt-4">
          <Message kind="error">{restoreErrorMessage(restore.error)}</Message>
        </div>
      )}

      {items.length === 0 ? (
        <p className="mt-10 text-center text-slate-500">A lixeira está vazia.</p>
      ) : (
        <>
          {total > items.length && (
            <p className="mt-4 text-sm text-slate-600">
              Mostram-se os {items.length} mais recentes de {total}. Os restantes aparecem à medida que eliminar ou restaurar estes.
            </p>
          )}
          <ul className="mt-6 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {items.map((item) => (
              <TrashRow
                key={item.id}
                item={item}
                restoring={restore.isPending && restore.variables === item.id}
                disabled={busy}
                onRestore={() => startRestore(item)}
                onPurge={() => setPurging(item)}
              />
            ))}
          </ul>
        </>
      )}

      {purging && (
        <ConfirmDialog
          title="Eliminar de vez"
          message={`Eliminar «${purging.name}» de vez? Não se pode desfazer e o espaço é libertado.`}
          confirmLabel="Eliminar de vez"
          pendingLabel="A eliminar…"
          pending={purge.isPending}
          error={purge.error ? errorMessage(purge.error) : null}
          onConfirm={() => purge.mutate(purging.id, { onSuccess: closePurge })}
          onClose={closePurge}
        />
      )}
      {emptying && (
        <ConfirmDialog
          title="Esvaziar a lixeira"
          message={
            empty.isPending
              ? `A eliminar… ${empty.purged} de ${total}`
              : `Eliminar de vez ${total === 1 ? "o ficheiro" : `os ${total} ficheiros`} da lixeira? Não se pode desfazer e o espaço é libertado.`
          }
          confirmLabel="Esvaziar lixeira"
          pendingLabel="A eliminar…"
          pending={empty.isPending}
          error={emptyError}
          onConfirm={() => empty.mutate(undefined, { onSuccess: (result) => result.remaining === 0 && closeEmpty() })}
          onClose={closeEmpty}
        />
      )}
    </div>
  );
}
```

Em `src/web/App.tsx`, nos `import`, trocar:

```tsx
import SearchPage from "./pages/SearchPage";
```

por:

```tsx
import SearchPage from "./pages/SearchPage";
import TrashPage from "./pages/TrashPage";
```

Nas rotas, trocar:

```tsx
        <Route path="pesquisa" element={<SearchPage />} />
```

por:

```tsx
        <Route path="pesquisa" element={<SearchPage />} />
        <Route path="lixeira" element={<TrashPage />} />
```

Em `src/web/components/AppLayout.tsx`, na navegação da barra lateral, trocar:

```tsx
          <NavLink to="/conta" className={navClass}>
```

por:

```tsx
          <NavLink to="/lixeira" className={navClass}>
            Lixeira
          </NavLink>
          <NavLink to="/conta" className={navClass}>
```

Run: `npx vitest run -c vitest.web.config.ts src/web/pages/TrashPage.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  18 passed (18)`.

- [ ] **Step 3: Verificação e commit**

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  27 passed (27)`, `Tests  197 passed (197)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src
git commit -m "Acrescenta o ecrã da lixeira com restaurar, eliminar de vez e esvaziar" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Partilha: o diálogo «Partilhar…» e o código comum dos menus de ações

**Files:**
- Create: `src/web/components/useDialog.ts`, `src/web/components/useDialog.test.ts`, `src/web/components/ShareDialog.tsx`, `src/web/components/ShareDialog.test.tsx`
- Modify: `src/web/components/FileActions.tsx`, `src/web/components/FolderActions.tsx`, `src/web/components/FileActions.test.tsx`
- Modify: `src/web/components/Modal.tsx`, `src/web/components/Modal.test.tsx`

**Interfaces:**
- Consumes: `useShares`, `useCreateShare`, `useRevokeShare`, `shareUrl` (Task 2), `Modal`, `Button`, `Message`, `formatDate`, `errorMessage`.
- Produces: `useDialog<Name>(...mutations)` → `{ dialog, open, close }` (o diálogo aberto de um menu e como o fechar, repondo as mutações); `ShareDialog({ file, onClose })`;
  «Partilhar…» no menu de cada ficheiro (também nos resultados da pesquisa); o `Modal` devolve o foco ao diálogo quando o elemento focado desaparece.

- [ ] **Step 1: `useDialog`: o estado comum dos menus de ações (teste primeiro)**

`FolderActions` e `FileActions` repetiam o mesmo estado (qual é o diálogo aberto) e o mesmo `close()` (fecha e repõe as mutações para um erro antigo não voltar). Com o diálogo «Partilhar…» seriam três cópias; o estado passa para um hook. É um refactor: os testes dos dois menus não mudam e têm de continuar verdes.

Criar `src/web/components/useDialog.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDialog } from "./useDialog";

describe("useDialog", () => {
  it("começa sem diálogo, abre um e fecha-o repondo todas as mutações", () => {
    const first = { reset: vi.fn() };
    const second = { reset: vi.fn() };
    const { result } = renderHook(() => useDialog<"rename" | "delete">(first, second));
    expect(result.current.dialog).toBeNull();

    act(() => result.current.open("rename"));
    expect(result.current.dialog).toBe("rename");
    expect(first.reset).not.toHaveBeenCalled();

    act(() => result.current.close());
    expect(result.current.dialog).toBeNull();
    expect(first.reset).toHaveBeenCalledTimes(1);
    expect(second.reset).toHaveBeenCalledTimes(1);
  });

  it("abrir outro diálogo troca o aberto (nunca há dois)", () => {
    const { result } = renderHook(() => useDialog<"rename" | "delete">());
    act(() => result.current.open("rename"));
    act(() => result.current.open("delete"));
    expect(result.current.dialog).toBe("delete");
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/useDialog.test.ts`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/components/useDialog.ts`:

```ts
import { useState } from "react";

/**
 * O diálogo aberto de um menu de ações (no máximo um por vez) e o modo de o fechar: fecha-o e repõe as mutações do menu,
 * para um erro antigo não reaparecer quando se abre um diálogo outra vez.
 */
export function useDialog<Name extends string>(...mutations: { reset: () => void }[]) {
  const [dialog, setDialog] = useState<Name | null>(null);

  function close() {
    setDialog(null);
    for (const mutation of mutations) mutation.reset();
  }

  return { dialog, open: setDialog, close };
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/useDialog.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  2 passed (2)`.

Em `src/web/components/FolderActions.tsx`, nos `import`, trocar:

```tsx
import { useState } from "react";
import type { FolderItem }
```

por:

```tsx
import type { FolderItem }
```

No mesmo ficheiro, trocar:

```tsx
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
```

por:

```tsx
import { RowMenu, type MenuAction } from "./RowMenu";
import { useDialog } from "./useDialog";

type Dialog = "rename" | "move" | "delete";

/** O menu «⋮» de uma pasta e os diálogos das suas ações (renomear, mover e excluir). */
export function FolderActions({ folder }: { folder: FolderItem }) {
  const update = useUpdateFolder();
  const remove = useDeleteFolder();
  const { dialog, open, close } = useDialog<Dialog>(update, remove);

  const actions: MenuAction[] = [
    { label: "Renomear", onSelect: () => open("rename") },
    { label: "Mover…", onSelect: () => open("move") },
    { label: "Excluir", danger: true, onSelect: () => open("delete") },
  ];
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/FolderActions.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  5 passed (5)`.

- [ ] **Step 2: O foco não pode cair para fora de um diálogo (teste primeiro)**

O diálogo de partilha é o primeiro que altera a sua própria lista sem se fechar: ao revogar um link com o teclado, o botão «Revogar» (focado) desativa-se e a linha desaparece, o foco cai para o `<body>` e o Esc e o Tab, que o `Modal` trata no `onKeyDown` do próprio diálogo, deixam de chegar lá (o Esc já não fecha o diálogo e o Tab sai dele). Por isso, depois de cada renderização, o `Modal` devolve o foco ao diálogo se este saiu de lá. O teste usa um diálogo cujo botão se remove a si próprio; o do diálogo de partilha (revogar com o teclado e carregar em Esc) está no passo seguinte.

Em `src/web/components/Modal.test.tsx`, trocar:

```tsx
async function openModal() {
```

por:

```tsx
function VanishingHarness() {
  const [shown, setShown] = useState(true);
  return (
    <Modal title="Um título" onClose={() => undefined}>
      {shown && <button onClick={() => setShown(false)}>Remover-me</button>}
    </Modal>
  );
}

async function openModal() {
```

No fim do `describe`, trocar:

```tsx
    await user.click(screen.getByTestId("modal-backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
```

por:

```tsx
    await user.click(screen.getByTestId("modal-backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("se o elemento focado desaparece, o foco volta ao diálogo (o Esc e o Tab continuam a funcionar)", async () => {
    const user = userEvent.setup();
    render(<VanishingHarness />);
    await user.click(screen.getByRole("button", { name: "Remover-me" }));
    expect(screen.queryByRole("button", { name: "Remover-me" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Um título" })).toHaveFocus();
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/Modal.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  1 failed | 4 passed (5)).

Em `src/web/components/Modal.tsx`, a seguir ao `useEffect` do `opener`, trocar:

```tsx
    return () => opener?.focus();
  }, [opener]);
```

por:

```tsx
    return () => opener?.focus();
  }, [opener]);

  // Se o elemento focado desaparece (por exemplo, a linha de um link revogado), o foco cai para o <body>, onde o Esc e o Tab já não
  // chegam ao diálogo (tratam-se no `onKeyDown` do próprio diálogo): depois de cada renderização, devolve-se-lhe o foco se o perdeu.
  useEffect(() => {
    const dialog = dialogRef.current!;
    if (!dialog.contains(document.activeElement)) dialog.focus();
  });
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/Modal.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  5 passed (5)`.

- [ ] **Step 3: O diálogo «Partilhar…» (testes primeiro)**

O diálogo cria links (sem validade, 1, 7 ou 30 dias), mostra o link completo **uma só vez** (a API só devolve o token na criação) com «Copiar», lista os links ativos (data de criação e validade, sem endereço) e revoga-os. Se o browser não deixa copiar (ligação não segura ou sem permissão), o texto fica selecionado e a mensagem explica como copiar à mão. Revogar o link que acabou de ser criado também tira o endereço do ecrã (já não funciona), e depois de criar um link o foco vai para o campo do endereço (que se seleciona ao receber o foco: Ctrl+C copia-o logo). Enquanto o link está a ser criado o diálogo não se fecha (Esc, fundo e «Fechar» ignorados): fechar a meio perdia o endereço, que só se vê uma vez, e deixava um link sem endereço a contar para o limite de 20. Os erros da API (por exemplo, `409 too_many_shares`, que já vem em português) aparecem tal como vêm.

Criar `src/web/components/ShareDialog.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FileItem, ShareItem } from "../../shared/types";
import { apiError, json, mockApi, noContent } from "../test/mock-api";
import { queryWrapper, testQueryClient } from "../test/render";
import { ShareDialog } from "./ShareDialog";

const DAY = 86_400_000;
const FILE: FileItem = { id: "a1", name: "relatório.pdf", folderId: null, size: 10, mime: "application/pdf", createdAt: 0 };
const CREATED = new Date(2026, 9, 3, 12).getTime();
const FOREVER: ShareItem = { id: "s1", fileId: "a1", createdAt: CREATED, expiresAt: null };
const UNTIL: ShareItem = { id: "s2", fileId: "a1", createdAt: CREATED, expiresAt: new Date(2026, 10, 2, 12).getTime() };

/** Os links que o servidor falso lista; os testes mudam-no nos handlers de criar e de revogar. */
let listed: ShareItem[] = [];

function setup(shares: ShareItem[] = [], extra: Parameters<typeof mockApi>[0] = {}) {
  listed = shares;
  const server = mockApi({
    "GET /api/files/:id/shares": () => json({ shares: listed }),
    ...extra,
  });
  const onClose = vi.fn();
  const user = userEvent.setup();
  const Wrapper = queryWrapper(testQueryClient());
  render(
    <Wrapper>
      <ShareDialog file={FILE} onClose={onClose} />
    </Wrapper>,
  );
  return { server, onClose, user };
}

describe("ShareDialog", () => {
  it("mostra o nome do ficheiro e avisa que qualquer pessoa com o link pode descarregá-lo", async () => {
    setup();
    expect(await screen.findByRole("dialog", { name: "Partilhar «relatório.pdf»" })).toHaveTextContent(
      "Qualquer pessoa com o link pode descarregar este ficheiro, sem iniciar sessão.",
    );
    expect(await screen.findByText("Ainda não há links ativos.")).toBeInTheDocument();
  });

  it("lista os links ativos com a data de criação e a validade, sem endereço", async () => {
    setup([FOREVER, UNTIL]);
    const list = within(await screen.findByRole("region", { name: "Links ativos" }));
    expect(await list.findByText("Link 1: criado a 03/10/2026, sem validade")).toBeInTheDocument();
    expect(list.getByText("Link 2: criado a 03/10/2026, válido até 02/11/2026")).toBeInTheDocument();
    expect(screen.queryByLabelText("Link de partilha")).not.toBeInTheDocument();
  });

  it("criar um link sem validade envia um corpo vazio e mostra o link completo uma vez, com o aviso", async () => {
    const state = setup([], {
      "POST /api/files/:id/shares": () => {
        listed = [FOREVER];
        return json({ share: FOREVER, token: "tok-123" }, 201);
      },
    });
    await screen.findByText("Ainda não há links ativos.");

    await state.user.click(screen.getByRole("button", { name: "Criar link" }));

    const created = within(await screen.findByRole("region", { name: "Link criado" }));
    expect(created.getByLabelText("Link de partilha")).toHaveValue(`${window.location.origin}/s/tok-123`);
    expect(created.getByText(/não voltará a ser mostrado/)).toBeInTheDocument();
    expect(created.getByText(/sem validade/)).toBeInTheDocument();
    expect(created.getByLabelText("Link de partilha")).toHaveFocus();
    expect(state.server.callsTo("POST /api/files/:id/shares")[0]).toMatchObject({ params: { id: "a1" }, body: {} });
    expect(await screen.findByText("Link 1: criado a 03/10/2026, sem validade")).toBeInTheDocument(); // a lista atualizou-se
  });

  it("com validade de 7 dias envia o instante em que o link expira", async () => {
    const state = setup([], {
      "POST /api/files/:id/shares": () => json({ share: UNTIL, token: "tok-7" }, 201),
    });
    const before = Date.now();
    await state.user.selectOptions(await screen.findByLabelText("Validade do link"), "7 dias");
    await state.user.click(screen.getByRole("button", { name: "Criar link" }));
    await screen.findByRole("region", { name: "Link criado" });
    const after = Date.now();

    const { expiresAt } = state.server.callsTo("POST /api/files/:id/shares")[0].body as { expiresAt: number };
    expect(expiresAt).toBeGreaterThanOrEqual(before + 7 * DAY);
    expect(expiresAt).toBeLessThanOrEqual(after + 7 * DAY);
    expect(screen.getByText(/válido até 02\/11\/2026/)).toBeInTheDocument();
  });

  it("as validades são sem validade, 1, 7 e 30 dias", async () => {
    setup();
    const select = await screen.findByLabelText("Validade do link");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["Sem validade", "1 dia", "7 dias", "30 dias"]);
  });

  it("«Copiar» põe o link na área de transferência e avisa", async () => {
    const state = setup([], { "POST /api/files/:id/shares": () => json({ share: FOREVER, token: "tok-c" }, 201) });
    await state.user.click(await screen.findByRole("button", { name: "Criar link" }));
    await screen.findByRole("region", { name: "Link criado" });

    await state.user.click(screen.getByRole("button", { name: "Copiar" }));

    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/s/tok-c`);
    expect(await screen.findByText("Link copiado.")).toBeInTheDocument();
  });

  it("se não consegue copiar, seleciona o link e explica como copiar à mão", async () => {
    const state = setup([], { "POST /api/files/:id/shares": () => json({ share: FOREVER, token: "tok-f" }, 201) });
    await state.user.click(await screen.findByRole("button", { name: "Criar link" }));
    await screen.findByRole("region", { name: "Link criado" });
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("negado"));

    await state.user.click(screen.getByRole("button", { name: "Copiar" }));

    expect(await screen.findByText(/Não foi possível copiar sozinho/)).toBeInTheDocument();
    const field = screen.getByLabelText("Link de partilha") as HTMLInputElement;
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    expect(field).toHaveFocus();
  });

  it("o erro de links a mais (409) mostra a mensagem da API e não cria nada", async () => {
    const state = setup([], {
      "POST /api/files/:id/shares": () => apiError(409, "too_many_shares", "Este ficheiro já tem 20 links ativos. Revogue algum antes de criar outro."),
    });
    await state.user.click(await screen.findByRole("button", { name: "Criar link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Este ficheiro já tem 20 links ativos.");
    expect(screen.queryByRole("region", { name: "Link criado" })).not.toBeInTheDocument();
  });

  it("revogar tira o link da lista", async () => {
    const state = setup([FOREVER], {
      "DELETE /api/shares/:id": () => {
        listed = [];
        return noContent();
      },
    });
    await state.user.click(await screen.findByRole("button", { name: "Revogar o link 1, criado a 03/10/2026" }));

    expect(await screen.findByText("Ainda não há links ativos.")).toBeInTheDocument();
    expect(state.server.callsTo("DELETE /api/shares/:id")[0].params.id).toBe("s1");
  });

  it("depois de revogar com o teclado o foco continua no diálogo e o Esc fecha-o", async () => {
    const state = setup([FOREVER], {
      "DELETE /api/shares/:id": () => {
        listed = [];
        return noContent();
      },
    });
    const revoke = await screen.findByRole("button", { name: "Revogar o link 1, criado a 03/10/2026" });
    revoke.focus();
    await state.user.keyboard("{Enter}");
    expect(await screen.findByText("Ainda não há links ativos.")).toBeInTheDocument();

    await state.user.keyboard("{Escape}");

    expect(state.onClose).toHaveBeenCalledTimes(1);
  });

  it("enquanto cria o link, Esc, o fundo e «Fechar» não fecham o diálogo (o endereço só aparece uma vez)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const state = setup([], {
      "POST /api/files/:id/shares": async () => {
        await gate;
        listed = [FOREVER];
        return json({ share: FOREVER, token: "tok-p" }, 201);
      },
    });
    await state.user.click(await screen.findByRole("button", { name: "Criar link" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("button", { name: "A criar…" });

    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.mouseDown(screen.getByTestId("modal-backdrop"));

    expect(state.onClose).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Fechar" })).toBeDisabled();
    release();
    const created = within(await screen.findByRole("region", { name: "Link criado" }));
    expect(created.getByLabelText("Link de partilha")).toHaveValue(`${window.location.origin}/s/tok-p`);
    expect(within(dialog).getByRole("button", { name: "Fechar" })).toBeEnabled();
    expect(state.onClose).not.toHaveBeenCalled();
  });

  it("revogar o link que acabou de ser criado esconde o endereço, que já não funciona", async () => {
    const state = setup([], {
      "POST /api/files/:id/shares": () => {
        listed = [FOREVER];
        return json({ share: FOREVER, token: "tok-r" }, 201);
      },
      "DELETE /api/shares/:id": () => {
        listed = [];
        return noContent();
      },
    });
    await state.user.click(await screen.findByRole("button", { name: "Criar link" }));
    await screen.findByRole("region", { name: "Link criado" });

    await state.user.click(await screen.findByRole("button", { name: "Revogar o link 1, criado a 03/10/2026" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "Link criado" })).not.toBeInTheDocument());
    expect(await screen.findByText("Ainda não há links ativos.")).toBeInTheDocument();
  });

  it("revogar outro link não esconde o que acabou de ser criado", async () => {
    const state = setup([UNTIL], {
      "POST /api/files/:id/shares": () => {
        listed = [FOREVER, UNTIL];
        return json({ share: FOREVER, token: "tok-n" }, 201);
      },
      "DELETE /api/shares/:id": () => {
        listed = [FOREVER];
        return noContent();
      },
    });
    await state.user.click(await screen.findByRole("button", { name: "Criar link" }));
    await screen.findByRole("region", { name: "Link criado" });

    await state.user.click(await screen.findByRole("button", { name: "Revogar o link 2, criado a 03/10/2026" }));

    await waitFor(() => expect(state.server.callsTo("DELETE /api/shares/:id")[0].params.id).toBe("s2"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Revogar o link 2/ })).not.toBeInTheDocument());
    expect(screen.getByLabelText("Link de partilha")).toHaveValue(`${window.location.origin}/s/tok-n`);
  });

  it("um erro ao revogar mostra a mensagem e o link continua na lista", async () => {
    const state = setup([FOREVER], {
      "DELETE /api/shares/:id": () => apiError(404, "share_not_found", "Link não encontrado."),
    });
    await state.user.click(await screen.findByRole("button", { name: "Revogar o link 1, criado a 03/10/2026" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Link não encontrado.");
  });

  it("um erro a listar os links deixa tentar de novo", async () => {
    let calls = 0;
    const user = userEvent.setup();
    mockApi({
      "GET /api/files/:id/shares": () => (++calls === 1 ? apiError(500, "internal_error", "Erro interno do servidor.") : json({ shares: [FOREVER] })),
    });
    const Wrapper = queryWrapper(testQueryClient());
    render(
      <Wrapper>
        <ShareDialog file={FILE} onClose={() => undefined} />
      </Wrapper>,
    );
    expect(await screen.findByText("Erro interno do servidor.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Link 1: criado a 03/10/2026, sem validade")).toBeInTheDocument();
  });

  it("«Fechar» e Esc fecham o diálogo", async () => {
    const { onClose, user } = setup();
    await screen.findByText("Ainda não há links ativos.");
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/ShareDialog.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  no tests).

Criar `src/web/components/ShareDialog.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { formatDate } from "../../shared/format";
import type { FileItem } from "../../shared/types";
import { errorMessage } from "../api";
import { shareUrl, useCreateShare, useRevokeShare, useShares } from "../shares";
import { Button } from "./Button";
import { Message } from "./Message";
import { Modal } from "./Modal";

const DAY_MS = 86_400_000;

/** `days: null` = o link não expira. */
const VALIDITIES = [
  { label: "Sem validade", days: null },
  { label: "1 dia", days: 1 },
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
] as const;

interface CreatedLink {
  /** O id da partilha: revogá-la tira o endereço do ecrã (já não funciona). */
  id: string;
  url: string;
  expiresAt: number | null;
}

const validityText = (expiresAt: number | null) => (expiresAt === null ? "sem validade" : `válido até ${formatDate(expiresAt)}`);

/**
 * Os links públicos de um ficheiro: criar (com validade opcional), copiar e revogar. O link completo só se vê logo a seguir a
 * criá-lo (o servidor só guarda o hash do token): fechar o diálogo esquece-o, e os links ativos aparecem sem endereço.
 */
export function ShareDialog({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const shares = useShares(file.id);
  const create = useCreateShare(file.id);
  const revoke = useRevokeShare(file.id);
  const [validity, setValidity] = useState("");
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const [copy, setCopy] = useState<"copied" | "failed" | null>(null);
  const linkField = useRef<HTMLInputElement>(null);

  // Depois de criar o link o foco vai para o campo (que se seleciona ao receber o foco): quem usa o teclado ou um leitor de ecrã
  // fica no endereço, que só se vê uma vez, e Ctrl+C copia-o logo.
  useEffect(() => {
    if (created) linkField.current?.focus();
  }, [created]);

  function createLink() {
    const days = validity === "" ? null : Number(validity);
    setCopy(null);
    create.mutate(days === null ? null : Date.now() + days * DAY_MS, {
      onSuccess: ({ share, token }) => setCreated({ id: share.id, url: shareUrl(token), expiresAt: share.expiresAt }),
    });
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopy("copied");
    } catch {
      // Sem permissão ou sem ligação segura: seleciona o texto para o utilizador o copiar com o teclado.
      linkField.current?.focus();
      linkField.current?.select();
      setCopy("failed");
    }
  }

  return (
    <Modal title={`Partilhar «${file.name}»`} onClose={() => !create.isPending && onClose()}>
      <div className="space-y-5">
        <p className="text-sm text-slate-700">Qualquer pessoa com o link pode descarregar este ficheiro, sem iniciar sessão.</p>

        <section aria-label="Novo link" className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Validade do link</span>
            <select
              value={validity}
              onChange={(event) => setValidity(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            >
              {VALIDITIES.map((option) => (
                <option key={option.label} value={option.days ?? ""}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {create.error && <Message kind="error">{errorMessage(create.error)}</Message>}
          <Button disabled={create.isPending} onClick={createLink}>
            {create.isPending ? "A criar…" : "Criar link"}
          </Button>
        </section>

        {created && (
          <section aria-label="Link criado" className="space-y-2 rounded-lg bg-indigo-50 p-3">
            <p className="text-sm text-slate-700">
              Link criado ({validityText(created.expiresAt)}). Copie-o agora: por segurança, não voltará a ser mostrado.
            </p>
            <div className="flex gap-2">
              <input
                ref={linkField}
                readOnly
                aria-label="Link de partilha"
                value={created.url}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
              <Button variant="secondary" onClick={() => void copyLink(created.url)}>
                Copiar
              </Button>
            </div>
            {copy === "copied" && <Message kind="success">Link copiado.</Message>}
            {copy === "failed" && (
              <Message kind="error">Não foi possível copiar sozinho: o link está selecionado, copie-o com Ctrl+C (⌘C no Mac).</Message>
            )}
          </section>
        )}

        <section aria-label="Links ativos" className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Links ativos</h3>
          {revoke.error && <Message kind="error">{errorMessage(revoke.error)}</Message>}
          {shares.isPending ? (
            <p className="text-sm text-slate-500">A carregar…</p>
          ) : shares.isError && shares.data === undefined ? (
            <div className="space-y-2">
              <Message kind="error">{errorMessage(shares.error)}</Message>
              <Button variant="secondary" onClick={() => void shares.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : shares.data.length === 0 ? (
            <p className="text-sm text-slate-500">Ainda não há links ativos.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {shares.data.map((share, index) => (
                <li key={share.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 text-slate-700">
                    Link {index + 1}: criado a {formatDate(share.createdAt)}, {validityText(share.expiresAt)}
                  </span>
                  <Button
                    variant="secondary"
                    className="shrink-0 px-3 py-1.5"
                    disabled={revoke.isPending}
                    aria-label={`Revogar o link ${index + 1}, criado a ${formatDate(share.createdAt)}`}
                    onClick={() =>
                      revoke.mutate(share.id, {
                        onSuccess: () => setCreated((current) => (current?.id === share.id ? null : current)),
                      })
                    }
                  >
                    Revogar
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500">Revogar um link faz com que deixe de funcionar logo.</p>
        </section>

        <div className="flex justify-end">
          <Button variant="secondary" disabled={create.isPending} onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/ShareDialog.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  16 passed (16)`.

- [ ] **Step 4: «Partilhar…» no menu de cada ficheiro (testes primeiro)**

Em `src/web/components/FileActions.test.tsx`, trocar:

```tsx
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Descarregar", "Renomear", "Mover…", "Excluir"]);
```

por:

```tsx
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Descarregar",
      "Partilhar…",
      "Renomear",
      "Mover…",
      "Excluir",
    ]);
```

No teste «Pré-visualizar», trocar:

```tsx
      "Pré-visualizar",
      "Descarregar",
      "Renomear",
```

por:

```tsx
      "Pré-visualizar",
      "Descarregar",
      "Partilhar…",
      "Renomear",
```

No `describe("FileActions")`, antes do teste «excluir», trocar:

```tsx
  it("excluir: pede confirmação, avisa que vai para a lixeira e apaga", async () => {
```

por:

```tsx
  it("partilhar: abre o diálogo da partilha deste ficheiro e fecha-o com «Fechar»", async () => {
    const server = mockApi({ "GET /api/files/:id/shares": () => json({ shares: [] }) });
    const user = setup();
    await choose(user, "Partilhar…");
    expect(screen.getByRole("dialog", { name: "Partilhar «relatório.pdf»" })).toBeInTheDocument();
    expect(await screen.findByText("Ainda não há links ativos.")).toBeInTheDocument();
    expect(server.callsTo("GET /api/files/:id/shares")[0].params.id).toBe("a1");
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: MENU })).toHaveFocus();
  });

  it("excluir: pede confirmação, avisa que vai para a lixeira e apaga", async () => {
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/FileActions.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  3 failed | 4 passed (7)).

Em `src/web/components/FileActions.tsx`, nos `import`, trocar:

```tsx
import { useState } from "react";
import type { FileItem }
```

por:

```tsx
import type { FileItem }
```

No mesmo ficheiro, trocar:

```tsx
import { RowMenu, type MenuAction } from "./RowMenu";

type Dialog = "rename" | "move" | "delete";

/** O menu «⋮» de um ficheiro: descarregar e os diálogos de renomear, mover e excluir. */
export function FileActions({ file, onPreview }: { file: FileItem; onPreview?: () => void }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const update = useUpdateFile();
  const remove = useDeleteFile();

  function close() {
    setDialog(null);
    update.reset();
    remove.reset();
  }

  const actions: MenuAction[] = [
    ...(onPreview ? [{ label: "Pré-visualizar", onSelect: onPreview }] : []),
    { label: "Descarregar", href: `/api/files/${encodeURIComponent(file.id)}/download` },
    { label: "Renomear", onSelect: () => setDialog("rename") },
    { label: "Mover…", onSelect: () => setDialog("move") },
    { label: "Excluir", danger: true, onSelect: () => setDialog("delete") },
  ];
```

por:

```tsx
import { RowMenu, type MenuAction } from "./RowMenu";
import { ShareDialog } from "./ShareDialog";
import { useDialog } from "./useDialog";

type Dialog = "rename" | "move" | "delete" | "share";

/** O menu «⋮» de um ficheiro: descarregar e os diálogos de partilhar, renomear, mover e excluir. */
export function FileActions({ file, onPreview }: { file: FileItem; onPreview?: () => void }) {
  const update = useUpdateFile();
  const remove = useDeleteFile();
  const { dialog, open, close } = useDialog<Dialog>(update, remove);

  const actions: MenuAction[] = [
    ...(onPreview ? [{ label: "Pré-visualizar", onSelect: onPreview }] : []),
    { label: "Descarregar", href: `/api/files/${encodeURIComponent(file.id)}/download` },
    { label: "Partilhar…", onSelect: () => open("share") },
    { label: "Renomear", onSelect: () => open("rename") },
    { label: "Mover…", onSelect: () => open("move") },
    { label: "Excluir", danger: true, onSelect: () => open("delete") },
  ];
```

No JSX devolvido, antes do diálogo de renomear, trocar:

```tsx
      {dialog === "rename" && (
        <NameDialog
          title="Renomear ficheiro"
```

por:

```tsx
      {dialog === "share" && <ShareDialog file={file} onClose={close} />}
      {dialog === "rename" && (
        <NameDialog
          title="Renomear ficheiro"
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/FileActions.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  7 passed (7)`.

- [ ] **Step 5: Verificação e commit**

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  29 passed (29)`, `Tests  217 passed (217)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src
git commit -m "Acrescenta o diálogo Partilhar com criar, copiar e revogar links, e extrai o estado comum dos menus de ações" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Página pública `/s/:token`

**Files:**
- Create: `src/web/pages/SharePage.tsx`, `src/web/pages/SharePage.test.tsx`, `src/web/shell.test.ts`
- Modify: `src/web/components/Button.tsx`, `src/web/App.tsx`

**Interfaces:**
- Consumes: `usePublicShare`, `shareDownloadUrl` (Task 2), `AuthCard`, `Button`, `Message`, `ApiRequestError`, `formatBytes`.
- Produces: a rota pública `/s/:token` (`SharePage`), fora do `AppLayout` (não pede a sessão); `buttonClass(variant?, className?)` em `Button.tsx`, para ligações com o aspeto de botão.

- [ ] **Step 1: A página pública (testes primeiro)**

Quem recebe um link abre `/s/<token>` sem sessão. A página mostra o nome e o tamanho (`GET /api/public/shares/:token`) e um botão «Descarregar» que é uma ligação para `/api/public/shares/:token/download` (o servidor responde com `Content-Disposition: attachment`). Um link que não existe, foi revogado, expirou ou cujo ficheiro foi excluído dá sempre o mesmo aviso (a API responde igual nos quatro casos) e não oferece «Tentar novamente»; um erro do servidor sim. Fica fora do `AppLayout`: não pede `GET /api/auth/me` nem `GET /api/config`, e não tem barra lateral.

Criar `src/web/pages/SharePage.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { apiError, json, mockApi } from "../test/mock-api";
import { renderApp } from "../test/render";

describe("SharePage (/s/:token)", () => {
  it("mostra o nome e o tamanho do ficheiro e um botão para o descarregar, sem pedir a sessão", async () => {
    const server = mockApi({ "GET /api/public/shares/:token": () => json({ name: "relatório final.pdf", size: 1536 }) });
    renderApp("/s/abc-123_x");

    expect(await screen.findByText("relatório final.pdf")).toBeInTheDocument();
    expect(screen.getByText("1,5 KB")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ficheiro partilhado" })).toBeInTheDocument();
    const download = screen.getByRole("link", { name: "Descarregar" });
    expect(download).toHaveAttribute("href", "/api/public/shares/abc-123_x/download");
    expect(server.calls.map((call) => call.path)).toEqual(["/api/public/shares/abc-123_x"]); // nem `/api/auth/me`, nem `/api/config`
  });

  it("um link que não existe, foi revogado ou expirou mostra o aviso, sem botão e sem tentar de novo", async () => {
    const server = mockApi({
      "GET /api/public/shares/:token": () => apiError(404, "share_not_found", "Este link não existe ou já não está disponível."),
    });
    renderApp("/s/revogado");
    expect(await screen.findByRole("alert")).toHaveTextContent("Este link não existe ou já não está disponível.");
    expect(screen.queryByRole("link", { name: "Descarregar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).not.toBeInTheDocument();
    expect(server.callsTo("GET /api/public/shares/:token")).toHaveLength(1);
  });

  it("um erro do servidor mostra a mensagem e deixa tentar de novo", async () => {
    let calls = 0;
    mockApi({
      "GET /api/public/shares/:token": () => (++calls === 1 ? apiError(500, "internal_error", "Erro interno do servidor.") : json({ name: "a.txt", size: 3 })),
    });
    renderApp("/s/abc");
    expect(await screen.findByText("Erro interno do servidor.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByRole("link", { name: "Descarregar" })).toBeInTheDocument();
  });

  it("a ligação «Entrar no SpaceWork» leva ao login", async () => {
    mockApi({ "GET /api/public/shares/:token": () => json({ name: "a.txt", size: 3 }) });
    renderApp("/s/abc");
    expect(await screen.findByRole("link", { name: "Entrar no SpaceWork" })).toHaveAttribute("href", "/login");
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/pages/SharePage.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  4 failed (4)).

Em `src/web/components/Button.tsx`, trocar:

```tsx
export function Button({ variant = "primary", type = "button", className = "", ...props }: ButtonProps) {
  return <button type={type} className={`${BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}
```

por:

```tsx
/** As classes de um botão, para uma ligação (`<a>`) com o aspeto de botão. */
export function buttonClass(variant: NonNullable<ButtonProps["variant"]> = "primary", className = ""): string {
  return `${BASE} ${VARIANTS[variant]} ${className}`;
}

export function Button({ variant = "primary", type = "button", className = "", ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}
```

Criar `src/web/pages/SharePage.tsx`:

```tsx
import { Link, useParams } from "react-router";
import { formatBytes } from "../../shared/format";
import { ApiRequestError, errorMessage } from "../api";
import { AuthCard } from "../components/AuthCard";
import { Button, buttonClass } from "../components/Button";
import { Message } from "../components/Message";
import { shareDownloadUrl, usePublicShare } from "../shares";

/**
 * A página pública de um link de partilha (`/s/:token`), fora do layout autenticado: não pede a sessão e só mostra o nome e o tamanho do
 * ficheiro com o botão para o descarregar. Um link que nunca existiu, foi revogado ou expirou, ou cujo ficheiro foi excluído, dá o mesmo aviso.
 */
export default function SharePage() {
  const token = useParams().token ?? "";
  const share = usePublicShare(token);
  const gone = share.error instanceof ApiRequestError && share.error.code === "share_not_found";

  let body;
  if (share.isPending) {
    body = <p className="text-sm text-slate-500">A carregar…</p>;
  } else if (share.isError) {
    body = (
      <div className="space-y-4">
        <Message kind="error">{errorMessage(share.error)}</Message>
        {!gone && (
          <Button variant="secondary" className="w-full" onClick={() => void share.refetch()}>
            Tentar novamente
          </Button>
        )}
      </div>
    );
  } else {
    body = (
      <div className="space-y-5">
        <div>
          <p className="font-medium break-words text-slate-900">{share.data.name}</p>
          <p className="mt-1 text-sm text-slate-500">{formatBytes(share.data.size)}</p>
        </div>
        <a href={shareDownloadUrl(token)} className={buttonClass("primary", "w-full")}>
          Descarregar
        </a>
      </div>
    );
  }

  return (
    <AuthCard
      title="Ficheiro partilhado"
      footer={
        <Link to="/login" className="font-medium text-indigo-600 hover:underline">
          Entrar no SpaceWork
        </Link>
      }
    >
      {body}
    </AuthCard>
  );
}
```

Em `src/web/App.tsx`, nos `import`, trocar:

```tsx
import RegisterPage from "./pages/RegisterPage";
import SearchPage from "./pages/SearchPage";
```

por:

```tsx
import RegisterPage from "./pages/RegisterPage";
import SearchPage from "./pages/SearchPage";
import SharePage from "./pages/SharePage";
```

Nas rotas, antes do layout, trocar:

```tsx
      <Route path="/registo" element={<RegisterPage />} />
```

por:

```tsx
      <Route path="/registo" element={<RegisterPage />} />
      <Route path="/s/:token" element={<SharePage />} />
```

Run: `npx vitest run -c vitest.web.config.ts src/web/pages/SharePage.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  4 passed (4)`.

- [ ] **Step 2: Nenhum recurso de terceiros (pendente do Plano 3)**

O endereço de um link traz o token. Se a página carregasse um tipo de letra ou um *script* de outra origem, o browser enviava-lhe o endereço no `Referer` e o terceiro sabia que o link foi aberto. Hoje não carrega nada (e `public/_headers` já manda `Referrer-Policy: same-origin`); o teste fixa isso para uma alteração futura ao `index.html` ou ao CSS não o estragar sem aviso. Passa logo, porque descreve o que já é verdade.

Criar `src/web/shell.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import css from "./index.css?raw";
import html from "../../index.html?raw";
import headers from "../../public/_headers?raw";

// A página pública de um link (`/s/:token`) traz o token no endereço: nada do que o browser carrega para a mostrar pode vir de outra origem
// (um pedido a terceiros revelava o endereço no `Referer` e deixava um terceiro saber que o link foi aberto).
const EXTERNAL = /https?:\/\/|=\s*["']\/\//i;

describe("a casca da aplicação", () => {
  it("index.html e o CSS de entrada não carregam nada de outras origens", () => {
    expect(html, "index.html").not.toMatch(EXTERNAL);
    expect(css, "src/web/index.css").not.toMatch(EXTERNAL);
  });

  it("os cabeçalhos estáticos não deixam o endereço da página sair da origem (Referrer-Policy)", () => {
    expect(headers).toMatch(/^\s*Referrer-Policy:\s*(same-origin|no-referrer)\s*$/m);
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/shell.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  2 passed (2)`.

- [ ] **Step 3: Verificação e commit**

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  31 passed (31)`, `Tests  223 passed (223)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npm run build`
Expected: `✓ built in ...` duas vezes (Worker e cliente).

Commit:

```bash
git add src
git commit -m "Acrescenta a página pública do link de partilha e um teste que garante que a casca não carrega recursos de terceiros" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Envios: contextos separados, um refresh por intervalo e «Sair» com confirmação

**Files:**
- Modify: `src/web/uploads-context.tsx`, `src/web/uploads-context.test.tsx`, `src/web/pages/FolderPage.tsx`, `src/web/pages/FolderPage.test.tsx`
- Modify: `src/web/components/AppLayout.tsx`, `src/web/components/AppLayout.test.tsx`, `src/web/auth.ts`, `src/web/auth.test.tsx`, `src/web/query-client.ts`

**Interfaces:**
- Consumes: `UploadManager` (Plano 2B), `useRefreshSpace` (Task 2 amplia-o), `ConfirmDialog` com `pendingLabel` (Task 4), `useLogout`, `stubXhr`, `mockApi`.
- Produces: `UploadActions`, `useUploadActions()` (as ações, sempre o mesmo objeto), `useUploadsBusy()` (boolean) e `useUploads()` (lista e ações, como antes);
  `UploadsProvider` com a propriedade opcional `refreshWindowMs` (por defeito `REFRESH_WINDOW_MS`, 500 ms) e agora a envolver a barra lateral também; «Sair» pede confirmação quando há envios em curso.

- [ ] **Step 1: Contextos separados e um só refresh por intervalo (testes primeiro)**

Pendentes do Plano 2B. (1) `useUploads()` devolvia um objeto novo a cada passo de progresso, por isso a lista de «Meu espaço» (que só precisa de `add`) re-renderizava a cada tick: o estado passa para três contextos (as ações, que nunca mudam; «há envios em curso?», que muda duas vezes por lote; e a lista, que muda a cada passo), e a página passa a usar só as ações. (2) Cada envio que terminava mandava refazer as listagens, a árvore, a quota e agora também a lixeira e as pesquisas ativas: com 100 ficheiros eram 100 refrescos. O primeiro envio a terminar arma um temporizador (`REFRESH_WINDOW_MS`, 500 ms) e todos os que terminam até ele disparar entram no mesmo refresh; um lote longo continua a atualizar a lista de meio em meio segundo. Ao desmontar o provider o temporizador cancela-se (e os envios cancelados já não agendam nada). Os testes usam um intervalo curto (`refreshWindowMs`) com relógios reais; os que afirmam que ainda não houve refresh, ou que não ficou nenhum agendado, usam intervalos de 200 a 400 ms e despejam as microtarefas com `await act(async () => {})` em vez de `waitFor` (que só consulta de 50 em 50 ms): com margens de 50 ms um atraso do processo de testes dava falhas que não eram defeitos.

Em `src/web/uploads-context.test.tsx`, nos `import`, trocar:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
```

por:

```tsx
import { render, renderHook, waitFor } from "@testing-library/react";
```

No mesmo ficheiro, trocar:

```tsx
import { useUploads, UploadsProvider } from "./uploads-context";
```

por:

```tsx
import {
  UploadsProvider,
  useUploadActions,
  useUploads,
  useUploadsBusy,
  type UploadActions,
} from "./uploads-context";
```

Na função `setup`, trocar:

```tsx
function setup(maxUploadBytes = 1000) {
```

por:

```tsx
/** `refreshWindowMs` curto: os testes esperam de verdade por ele (relógios reais). */
function setup(maxUploadBytes = 1000, refreshWindowMs = 20) {
```

No mesmo sítio, trocar:

```tsx
  const Query = queryWrapper(testQueryClient());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Query>
      <UploadsProvider>{children}</UploadsProvider>
    </Query>
  );
```

por:

```tsx
  const client = testQueryClient();
  const Query = queryWrapper(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Query>
      <UploadsProvider refreshWindowMs={refreshWindowMs}>{children}</UploadsProvider>
    </Query>
  );
```

No fim de `setup`, trocar:

```tsx
  return { hook, server, Xhr, setUsed: (bytes: number) => (usedBytes = bytes) };
```

por:

```tsx
  return { hook, server, Xhr, client, setUsed: (bytes: number) => (usedBytes = bytes) };
```

Acrescentar ao fim de `src/web/uploads-context.test.tsx`:

```tsx
describe("UploadsProvider: um refresh por intervalo", () => {
  /** A sessão (`GET /api/auth/me`) é pedida uma vez ao início e outra por cada refresh do espaço. */
  const sessionCalls = (server: ReturnType<typeof setup>["server"]) => server.callsTo("GET /api/auth/me").length;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("vários envios que terminam juntos dão um só refresh, e só depois do intervalo", async () => {
    const { hook, server, Xhr } = setup(1000, 400);
    await waitFor(() => expect(hook.result.current.me.data).toBeDefined());
    expect(sessionCalls(server)).toBe(1);

    act(() => hook.result.current.uploads.add(["a", "b", "c"].map((name) => new File(["abc"], `${name}.txt`)), null));
    act(() => Xhr.instances.forEach((xhr) => xhr.respond(201, { file: FILE_ITEM })));
    await waitFor(() => expect(hook.result.current.uploads.items.every((item) => item.status === "done")).toBe(true));
    expect(sessionCalls(server)).toBe(1); // o intervalo ainda não acabou: nenhum refresh

    await waitFor(() => expect(sessionCalls(server)).toBe(2));
    await sleep(300);
    expect(sessionCalls(server)).toBe(2); // um só para os três
  });

  it("um envio que termina depois do refresh arma outro", async () => {
    const { hook, server, Xhr } = setup(1000, 50);
    await waitFor(() => expect(hook.result.current.me.data).toBeDefined());

    act(() => hook.result.current.uploads.add([new File(["abc"], "a.txt")], null));
    act(() => Xhr.instances[0].respond(201, { file: FILE_ITEM }));
    await waitFor(() => expect(sessionCalls(server)).toBe(2));

    act(() => hook.result.current.uploads.add([new File(["abc"], "b.txt")], null));
    act(() => Xhr.instances[1].respond(201, { file: FILE_ITEM }));
    await waitFor(() => expect(sessionCalls(server)).toBe(3));
  });

  it("um envio que falha também conta (a quota e as listagens podem ter mudado)", async () => {
    const { hook, server, Xhr } = setup(1000, 50);
    await waitFor(() => expect(hook.result.current.me.data).toBeDefined());

    act(() => hook.result.current.uploads.add([new File(["abc"], "a.txt")], null));
    act(() => Xhr.instances[0].respond(413, { error: "quota_exceeded", message: "Sem espaço suficiente na sua quota." }));
    await waitFor(() => expect(sessionCalls(server)).toBe(2));
  });

  it("ao desmontar o provider não fica um refresh agendado", async () => {
    const { hook, server, Xhr, client } = setup(1000, 200);
    await waitFor(() => expect(hook.result.current.me.data).toBeDefined());
    // Outro observador da sessão, fora do provider, para um refresh agendado se notar nos pedidos.
    const observer = renderHook(() => useMe(), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(observer.result.current.isFetching).toBe(false));
    const before = sessionCalls(server);

    act(() => hook.result.current.uploads.add([new File(["abc"], "a.txt")], null));
    act(() => Xhr.instances[0].respond(201, { file: FILE_ITEM }));
    await act(async () => {}); // despeja as microtarefas que correm `finish` -> `onSettled`, que arma o temporizador
    expect(hook.result.current.uploads.items[0].status).toBe("done");
    hook.unmount();
    await sleep(600); // mais do que o intervalo

    expect(sessionCalls(server)).toBe(before);
  });
});

describe("UploadsProvider: ações, «ocupado» e lista em contextos separados", () => {
  it("as ações são sempre as mesmas e não re-renderizam com o progresso; «ocupado» só quando muda; a lista a cada passo", async () => {
    const Xhr = stubXhr();
    mockApi({ "GET /api/config": () => json({ maxUploadBytes: 1000 }), "GET /api/auth/me": () => json({ user: ME }) });
    const renders = { actions: 0, busy: 0, items: 0 };
    let actions!: UploadActions;
    let busy = false;
    function ActionsConsumer() {
      renders.actions++;
      actions = useUploadActions();
      return null;
    }
    function BusyConsumer() {
      renders.busy++;
      busy = useUploadsBusy();
      return null;
    }
    function ItemsConsumer() {
      renders.items++;
      useUploads();
      return null;
    }
    const Query = queryWrapper(testQueryClient());
    render(
      <Query>
        <UploadsProvider>
          <ActionsConsumer />
          <BusyConsumer />
          <ItemsConsumer />
        </UploadsProvider>
      </Query>,
    );
    const first = actions;
    const base = { ...renders };
    expect(busy).toBe(false);

    act(() => actions.add([new File(["abc"], "a.txt")], null));
    expect(busy).toBe(true);
    const afterAdd = renders.items;
    act(() => Xhr.instances[0].progress(1, 3));
    act(() => Xhr.instances[0].progress(2, 3));

    expect(renders.items).toBeGreaterThan(afterAdd); // a lista re-renderiza com o progresso
    expect(renders.busy - base.busy).toBe(1); // «ocupado» passou de falso a verdadeiro, e só isso
    expect(renders.actions).toBe(base.actions); // as ações não re-renderizaram
    act(() => Xhr.instances[0].respond(201, { file: FILE_ITEM }));
    await waitFor(() => expect(busy).toBe(false));
    expect(renders.busy - base.busy).toBe(2);
    expect(renders.actions).toBe(base.actions);
    expect(actions).toBe(first);
  });

  it("os hooks fora do provider são um erro claro", () => {
    expect(() => renderHook(() => useUploadActions())).toThrow("UploadsProvider");
    expect(() => renderHook(() => useUploadsBusy())).toThrow("UploadsProvider");
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/uploads-context.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  4 failed | 7 passed (11)).

Substituir o conteúdo de `src/web/uploads-context.tsx`:

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

/** As ações da fila: o mesmo objeto durante toda a vida do provider, por isso quem só as usa não re-renderiza com o progresso. */
export interface UploadActions {
  /** Põe ficheiros na fila para a pasta indicada (`null` = raiz). */
  add: (files: File[], folderId: string | null) => void;
  cancel: (id: string) => void;
  clearFinished: () => void;
}

interface UploadsApi extends UploadActions {
  items: readonly UploadItem[];
}

/** Intervalo mínimo entre dois refrescos das listagens e da quota enquanto os envios vão terminando. */
export const REFRESH_WINDOW_MS = 500;

const ActionsContext = createContext<UploadActions | null>(null);
const ItemsContext = createContext<readonly UploadItem[] | null>(null);
const BusyContext = createContext<boolean | null>(null);

/**
 * Dá a toda a área autenticada a mesma fila de envios, por isso um envio continua quando se muda de pasta, e avisa antes de fechar
 * o separador enquanto há envios. Quando envios terminam, atualiza as listagens e a quota **uma vez por intervalo** (`refreshWindowMs`):
 * um refresh por ficheiro refazia, a cada um, todos os pedidos das listagens, da árvore, da quota, da lixeira e das pesquisas.
 *
 * O estado está em três contextos: as ações (nunca mudam), «há envios em curso?» (muda duas vezes por lote) e a lista (muda a cada progresso).
 */
export function UploadsProvider({
  children,
  refreshWindowMs = REFRESH_WINDOW_MS,
}: {
  children: ReactNode;
  refreshWindowMs?: number;
}) {
  const config = useConfig();
  const refresh = useRefreshSpace();
  // A fila é criada uma só vez: lê estes valores, sempre os mais recentes, quando precisa deles.
  const latest = useRef({ maxUploadBytes: Infinity, refresh, refreshWindowMs });
  useEffect(() => {
    latest.current = { maxUploadBytes: config.data?.maxUploadBytes ?? Infinity, refresh, refreshWindowMs };
  });
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const disposed = useRef(false);
  const [manager] = useState(
    () =>
      new UploadManager({
        maxUploadBytes: () => latest.current.maxUploadBytes,
        onSettled: () => {
          // O primeiro envio que termina arma o temporizador; os que terminam até ele disparar ficam incluídos no mesmo refresh.
          if (disposed.current || refreshTimer.current !== undefined) return;
          refreshTimer.current = setTimeout(() => {
            refreshTimer.current = undefined;
            void latest.current.refresh();
          }, latest.current.refreshWindowMs);
        },
      }),
  );
  // Se o provider desaparece (fim de sessão, erro), a fila não pode continuar a enviar ficheiros às escondidas, nem ficar um refresh agendado.
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      clearTimeout(refreshTimer.current);
      refreshTimer.current = undefined;
      manager.cancelAll();
    };
  }, [manager]);
  const items = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const busy = items.some((item) => item.status === "queued" || item.status === "uploading");

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const actions = useMemo(
    () => ({ add: manager.add, cancel: manager.cancel, clearFinished: manager.clearFinished }),
    [manager],
  );
  return (
    <ActionsContext.Provider value={actions}>
      <BusyContext.Provider value={busy}>
        <ItemsContext.Provider value={items}>{children}</ItemsContext.Provider>
      </BusyContext.Provider>
    </ActionsContext.Provider>
  );
}

function required<T>(value: T | null): T {
  if (value === null) throw new Error("Os hooks dos envios só funcionam dentro de um UploadsProvider.");
  return value;
}

/** Só as ações (adicionar, cancelar, limpar): não re-renderiza quando o progresso muda. */
export function useUploadActions(): UploadActions {
  return required(useContext(ActionsContext));
}

/** Se há envios em espera ou a decorrer: re-renderiza só quando isso muda. */
export function useUploadsBusy(): boolean {
  return required(useContext(BusyContext));
}

/** A lista de envios e as ações. Re-renderiza a cada passo do progresso: só para quem mostra a lista (o painel de envios). */
export function useUploads(): UploadsApi {
  const actions = useUploadActions();
  const items = required(useContext(ItemsContext));
  return useMemo(() => ({ items, ...actions }), [items, actions]);
}
```

Em `src/web/pages/FolderPage.tsx`, nos `import`, trocar:

```tsx
import { useUploads } from "../uploads-context";
```

por:

```tsx
import { useUploadActions } from "../uploads-context";
```

No corpo da página, trocar:

```tsx
  const uploads = useUploads();
```

por:

```tsx
  const uploads = useUploadActions(); // só as ações: a página não re-renderiza com o progresso dos envios
```

Em `src/web/pages/FolderPage.test.tsx`, no teste «Carregar ficheiros», trocar:

```tsx
    // Só existe na linha da lista (o `<span>` do painel de envios também diz «nota.txt»).
    expect(await screen.findByRole("button", { name: "Ações para o ficheiro nota.txt" })).toBeInTheDocument();
```

por:

```tsx
    // Só existe na linha da lista (o `<span>` do painel de envios também diz «nota.txt»). A lista atualiza-se
    // quando o intervalo do refresh (500 ms) acaba, por isso a espera é maior do que a de por defeito.
    expect(await screen.findByRole("button", { name: "Ações para o ficheiro nota.txt" }, { timeout: 3000 })).toBeInTheDocument();
```

Run:

```bash
npx vitest run -c vitest.web.config.ts src/web/uploads-context.test.tsx src/web/pages/FolderPage.test.tsx src/web/components/UploadPanel.test.tsx
```
Expected: `Test Files  3 passed (3)`, `Tests  36 passed (36)`.

- [ ] **Step 2: Terminar a sessão sem depender de quem a chama e sem deixar nada para trás (testes primeiro)**

Mover o «Sair» para um componente próprio (passo seguinte) mostrou um defeito que estava escondido: `useLogout` fazia `queryClient.clear()` e depois `setQueryData(ME_KEY, null)`. O `clear()` tira a consulta da sessão da cache e quem a observa (o layout, em `useMe`) só passava a ver a nova quando voltava a renderizar; isso só acontecia porque o layout era também quem chamava o `useLogout`. Com o «Sair» noutro componente, o layout ficava a mostrar a sessão antiga e a navegação para o login não acontecia. O 401 já evitava o `clear()` (`createQueryClient`: `removeQueries` das outras consultas e `setQueryData` da sessão). Mas essa receita, copiada tal e qual, perderia duas coisas que o `clear()` também garantia: (a) um pedido da sessão ainda a decorrer, cuja resposta tardia repunha o utilizador por cima do `null` (cada refresh depois de um envio invalida a sessão, por isso o risco é maior em «Sair» com envios em curso); (b) a cache das mutações, que guarda as variáveis do login e da troca de senha e o token de uma partilha durante o `gcTime` (5 minutos). O fim de sessão (terminar a sessão ou um 401) passa a fazer-se num só sítio, `forgetAccount`: cancela a consulta da sessão, tira as outras consultas, esvazia a cache das mutações e põe a sessão a `null`, por esta ordem (o cancelamento repõe o estado anterior da consulta, por isso tem de vir antes do `setQueryData`). Os testes: o primeiro põe o observador da sessão num componente à parte (a situação que falhava); os outros dois fixam (a) e (b) e passam já com o `clear()`: guardam a troca.

Em `src/web/auth.test.tsx`, nos `import`, trocar:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
```

por:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
```

No mesmo ficheiro, trocar:

```tsx
import { useMe } from "./auth";
import { apiError, json, ME, mockApi } from "./test/mock-api";
```

por:

```tsx
import { ME_KEY, useChangePassword, useLogout, useMe } from "./auth";
import { apiError, json, ME, mockApi, noContent } from "./test/mock-api";
```

Acrescentar ao fim de `src/web/auth.test.tsx`:

```tsx
describe("useLogout", () => {
  it("termina a sessão, esquece os dados da conta e põe a sessão a null em quem a observa, noutro componente", async () => {
    const server = mockApi({
      "GET /api/auth/me": () => json({ user: ME }),
      "POST /api/auth/logout": () => noContent(),
    });
    const client = testQueryClient();
    const wrapper = queryWrapper(client);
    const me = renderHook(() => useMe(), { wrapper }); // um componente
    const logout = renderHook(() => useLogout(), { wrapper }); // outro: não se re-renderiza por causa do `me`
    await waitFor(() => expect(me.result.current.data).toEqual(ME));
    client.setQueryData(["folder", "root"], { folders: [], files: [] });

    await act(() => logout.result.current.mutateAsync());

    expect(server.callsTo("POST /api/auth/logout")).toHaveLength(1);
    await waitFor(() => expect(me.result.current.data).toBeNull());
    expect(client.getQueryData(["folder", "root"])).toBeUndefined();
  });

  it("uma resposta tardia da sessão não repõe o utilizador depois de terminar a sessão", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mockApi({
      "GET /api/auth/me": async () => {
        if (++calls === 1) return json({ user: ME });
        await gate; // o segundo pedido fica à espera
        return json({ user: ME });
      },
      "POST /api/auth/logout": () => noContent(),
    });
    const client = testQueryClient();
    const wrapper = queryWrapper(client);
    const me = renderHook(() => useMe(), { wrapper });
    const logout = renderHook(() => useLogout(), { wrapper });
    await waitFor(() => expect(me.result.current.data).toEqual(ME));
    void client.invalidateQueries({ queryKey: ME_KEY }); // um refresh da sessão em curso
    await waitFor(() => expect(calls).toBe(2));

    await act(() => logout.result.current.mutateAsync());
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(me.result.current.data).toBeNull();
  });

  it("esvazia também a cache das mutações (variáveis de senhas, tokens)", async () => {
    mockApi({
      "GET /api/auth/me": () => json({ user: ME }),
      "POST /api/auth/password": () => noContent(),
      "POST /api/auth/logout": () => noContent(),
    });
    const client = testQueryClient();
    const wrapper = queryWrapper(client);
    const change = renderHook(() => useChangePassword(), { wrapper });
    const logout = renderHook(() => useLogout(), { wrapper });
    await act(() => change.result.current.mutateAsync({ currentPassword: "velha-senha", newPassword: "nova-senha" }));
    expect(client.getMutationCache().getAll()).toHaveLength(1);

    await act(() => logout.result.current.mutateAsync());

    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/auth.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  2 failed | 5 passed (7)).

Em `src/web/auth.ts`, nos `import`, trocar:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
```

por:

```ts
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
```

Antes de `useLogout`, acrescentar a função (trocar):

```ts
export function useLogout() {
```

por:

```ts
/**
 * Fim de sessão (terminar a sessão ou um 401): esquece tudo o que era da conta e deixa a sessão a `null`.
 * Não usa `clear()`, que tirava a consulta da sessão da cache e só quem voltasse a renderizar dava pela nova; faz à mão o que ele
 * garantia: cancela um pedido da sessão ainda a decorrer (uma resposta tardia repunha o utilizador por cima do `null`) e esvazia
 * a cache das mutações (guarda as variáveis do login e da troca de senha, e o token de uma partilha, durante o `gcTime`).
 */
export function forgetAccount(client: QueryClient): void {
  void client.cancelQueries({ queryKey: ME_KEY });
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] });
  client.getMutationCache().clear();
  client.setQueryData(ME_KEY, null);
}

export function useLogout() {
```

Em `useLogout`, trocar:

```ts
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(ME_KEY, null);
    },
```

por:

```ts
    // Ver forgetAccount.
    onSuccess: () => forgetAccount(queryClient),
```

Em `src/web/query-client.ts`, o 401 faz o mesmo. Nos `import`, trocar:

```ts
import { ME_KEY } from "./auth";
```

por:

```ts
import { forgetAccount } from "./auth";
```

No mesmo ficheiro, trocar:

```ts
  setUnauthorizedHandler(() => {
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] });
    client.setQueryData(ME_KEY, null);
  });
```

por:

```ts
  setUnauthorizedHandler(() => forgetAccount(client));
```

Run:

```bash
npx vitest run -c vitest.web.config.ts src/web/auth.test.tsx src/web/query-client.test.ts src/web/components/AppLayout.test.tsx
```
Expected: `Test Files  3 passed (3)`, `Tests  20 passed (20)`.

- [ ] **Step 3: «Sair» com envios em curso pede confirmação (testes primeiro)**

Pendente do Plano 2B: «Sair» cancelava os envios em silêncio (o provider desmonta e a fila aborta tudo). Agora, se há envios em espera ou a decorrer, abre-se uma confirmação. Para a barra lateral saber se há envios, o `UploadsProvider` passa a envolver o layout inteiro e não só a área principal; o «Sair» vira um componente próprio que lê `useUploadsBusy()` (só re-renderiza quando «ocupado» muda, não a cada progresso). Um erro ao terminar a sessão aparece no diálogo quando ele está aberto e por baixo do botão quando não está, nunca nos dois, e um erro de uma tentativa antiga não aparece num diálogo que ainda ninguém confirmou (`logout.reset()` antes de o abrir). O diálogo não se fecha enquanto o pedido decorre (é o `ConfirmDialog` da Task 4).

Em `src/web/components/AppLayout.test.tsx`, nos `import`, trocar:

```tsx
import { act, cleanup, createEvent, fireEvent, screen, waitFor } from "@testing-library/react";
```

por:

```tsx
import { act, cleanup, createEvent, fireEvent, screen, waitFor, within } from "@testing-library/react";
```

No mesmo ficheiro, trocar:

```tsx
import { describe, expect, it, vi } from "vitest";
```

por:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
```

Acrescentar ao fim de `src/web/components/AppLayout.test.tsx`:

```tsx
describe("AppLayout: «Sair» com envios em curso", () => {
  // O `FakeXhr` é uma classe de módulo: sem repor o espião, o `abort` de um teste soma-se ao do seguinte.
  afterEach(() => vi.restoreAllMocks());

  function serveSession() {
    let signedIn = true;
    return mockApi({
      ...CONTENTS,
      "GET /api/auth/me": () => (signedIn ? json({ user: ME }) : apiError(401, "unauthorized", "Sessão inválida ou expirada.")),
      "GET /api/config": () => json({ maxUploadBytes: 1_000_000 }),
      "POST /api/auth/logout": () => {
        signedIn = false;
        return noContent();
      },
    });
  }

  async function startUpload(user: ReturnType<typeof userEvent.setup>) {
    await user.upload(await screen.findByLabelText("Escolher ficheiros"), new File(["abc"], "a.txt"));
    await screen.findByRole("progressbar", { name: "Envio de a.txt" });
  }

  it("pede confirmação; «Cancelar» deixa a sessão e o envio como estavam", async () => {
    const Xhr = stubXhr();
    const abort = vi.spyOn(Xhr.prototype, "abort");
    const server = serveSession();
    const user = userEvent.setup();
    renderApp("/");
    await startUpload(user);

    await user.click(screen.getByRole("button", { name: "Sair" }));
    const dialog = screen.getByRole("dialog", { name: "Sair com envios em curso" });
    expect(dialog).toHaveTextContent("Há envios por terminar. Se sair agora, são cancelados. Sair mesmo assim?");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.callsTo("POST /api/auth/logout")).toHaveLength(0);
    expect(abort).not.toHaveBeenCalled();
    expect(screen.getByRole("progressbar", { name: "Envio de a.txt" })).toBeInTheDocument();
  });

  it("«Sair» no diálogo termina a sessão e cancela os envios", async () => {
    const Xhr = stubXhr();
    const abort = vi.spyOn(Xhr.prototype, "abort");
    const server = serveSession();
    const user = userEvent.setup();
    renderApp("/");
    await startUpload(user);

    await user.click(screen.getByRole("button", { name: "Sair" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sair" }));

    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(server.callsTo("POST /api/auth/logout")).toHaveLength(1);
    await waitFor(() => expect(abort).toHaveBeenCalledTimes(1));
  });

  it("se terminar a sessão falhar, o erro aparece no diálogo (uma só vez) e a sessão continua", async () => {
    stubXhr();
    mockApi({
      ...CONTENTS,
      "GET /api/auth/me": () => json({ user: ME }),
      "GET /api/config": () => json({ maxUploadBytes: 1_000_000 }),
      "POST /api/auth/logout": () => apiError(500, "internal_error", "Erro interno do servidor."),
    });
    const user = userEvent.setup();
    renderApp("/");
    await startUpload(user);

    await user.click(screen.getByRole("button", { name: "Sair" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sair" }));

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("Erro interno do servidor.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
  });

  it("um erro antigo de «Sair» não aparece no diálogo quando ele se abre", async () => {
    stubXhr();
    mockApi({
      ...CONTENTS,
      "GET /api/auth/me": () => json({ user: ME }),
      "GET /api/config": () => json({ maxUploadBytes: 1_000_000 }),
      "POST /api/auth/logout": () => apiError(500, "internal_error", "Erro interno do servidor."),
    });
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Sair" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Erro interno do servidor.");
    await startUpload(user);

    await user.click(screen.getByRole("button", { name: "Sair" }));

    const dialog = screen.getByRole("dialog", { name: "Sair com envios em curso" });
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sem envios, «Sair» não pergunta nada", async () => {
    const server = serveSession();
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Sair" }));
    expect(screen.queryByRole("dialog", { name: "Sair com envios em curso" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(server.callsTo("POST /api/auth/logout")).toHaveLength(1);
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/AppLayout.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  4 failed | 11 passed (15)).

Substituir o conteúdo de `src/web/components/AppLayout.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router";
import { errorMessage } from "../api";
import { useLogout, useMe } from "../auth";
import { UploadsProvider, useUploadsBusy } from "../uploads-context";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Message } from "./Message";
import { SearchBox } from "./SearchBox";
import { UploadPanel } from "./UploadPanel";
import { UsageBar } from "./UsageBar";

function navClass({ isActive }: { isActive: boolean }): string {
  return `block rounded-lg px-3 py-2 text-sm font-medium ${
    isActive ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-100"
  }`;
}

/** «Sair». Com envios em curso pede confirmação: sair cancela-os (os que ainda não chegaram ao fim perdem-se). */
function LogoutButton() {
  const logout = useLogout();
  const busy = useUploadsBusy();
  const [confirming, setConfirming] = useState(false);

  function closeConfirm() {
    setConfirming(false);
    logout.reset();
  }

  return (
    <>
      {logout.isError && !confirming && <Message kind="error">{errorMessage(logout.error)}</Message>}
      <Button
        variant="secondary"
        className="w-full"
        disabled={logout.isPending}
        onClick={() => {
          if (busy) {
            logout.reset(); // um erro de uma tentativa antiga não pode aparecer num diálogo que ainda ninguém confirmou
            setConfirming(true);
          } else logout.mutate();
        }}
      >
        Sair
      </Button>
      {confirming && (
        <ConfirmDialog
          title="Sair com envios em curso"
          message="Há envios por terminar. Se sair agora, são cancelados. Sair mesmo assim?"
          confirmLabel="Sair"
          pendingLabel="A sair…"
          pending={logout.isPending}
          error={logout.error ? errorMessage(logout.error) : null}
          onConfirm={() => logout.mutate()}
          onClose={closeConfirm}
        />
      )}
    </>
  );
}

/** Layout das páginas autenticadas: barra lateral com navegação, uso de espaço e saída. */
export default function AppLayout() {
  const me = useMe();
  const { pathname } = useLocation();
  const signedIn = Boolean(me.data);

  // Um ficheiro largado fora da zona de largar fá-lo o browser abrir, e a aplicação perde-se: a janela impede-o. A zona
  // de largar da página continua a tratar do envio; isto só tira o comportamento por defeito (e só para ficheiros).
  useEffect(() => {
    if (!signedIn) return;
    const guard = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, [signedIn]);

  if (me.isPending) return <p className="p-8 text-slate-500">A carregar…</p>;
  // Só quando ainda não há dados: um refetch falhado em segundo plano não pode desmontar a aplicação (e a fila de envios).
  if (me.isError && me.data === undefined) {
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
    // `key`: se o `me` passar a outro utilizador no mesmo separador, a fila do anterior cancela-se (`cancelAll`).
    // O provider envolve a barra lateral também: o «Sair» precisa de saber se há envios em curso.
    <UploadsProvider key={user.id}>
      <div className="min-h-screen md:flex">
        <aside className="flex shrink-0 flex-col gap-6 border-b border-slate-200 bg-white p-4 md:min-h-screen md:w-64 md:border-r md:border-b-0">
          <div className="text-xl font-bold tracking-tight text-indigo-600">SpaceWork</div>
          <SearchBox />
          <nav className="flex gap-1 md:flex-col" aria-label="Principal">
            {/* "Meu espaço" também fica ativo dentro das pastas (/pasta/...). */}
            <NavLink to="/" end className={({ isActive }) => navClass({ isActive: isActive || pathname.startsWith("/pasta/") })}>
              Meu espaço
            </NavLink>
            <NavLink to="/lixeira" className={navClass}>
              Lixeira
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
            <LogoutButton />
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-6 md:p-8">
          <Outlet />
          <UploadPanel />
        </main>
      </div>
    </UploadsProvider>
  );
}
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/AppLayout.test.tsx`
Expected: `Test Files  1 passed (1)`, `Tests  15 passed (15)`.

- [ ] **Step 4: Verificação e commit**

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  31 passed (31)`, `Tests  237 passed (237)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src
git commit -m "Separa os contextos dos envios, agrupa o refresh por intervalo e pede confirmação ao sair com envios em curso" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Documentação, verificação final e índice dos planos

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-10-03-spacework-design.md`, `docs/superpowers/plans/README.md`

**Interfaces:**
- Consumes: tudo o que as Tasks 1 a 7 entregam.
- Produces: o `README.md` com a interface da pesquisa, da lixeira e da partilha; a especificação com a pesquisa na barra lateral; o índice dos planos com o 3B «Concluído» e os pendentes que ficam.

- [ ] **Step 1: README e especificação**

Em `README.md`, na secção «Interface», trocar:

```markdown
Não há miniaturas (a API responde com `no-store`, por isso cada miniatura seria um pedido novo a cada listagem). A API da lixeira, da pesquisa e da partilha já existe, mas só o Plano 3B lhes dá ecrãs: até lá os ficheiros excluídos continuam a ocupar quota até serem eliminados de vez.
```

por:

```markdown
Não há miniaturas (a API responde com `no-store`, por isso cada miniatura seria um pedido novo a cada listagem).

A **caixa de pesquisa** está na barra lateral de todas as páginas: Enter leva a `/pesquisa?q=...`, que lista as pastas e os ficheiros que têm o texto no nome (2 a 100 caracteres, até 50 resultados), cada um com a pasta onde está e com as mesmas ações das linhas de «Meu espaço». O endereço da pesquisa pode ser guardado ou copiado.

**Lixeira** (`/lixeira`): lista os ficheiros excluídos (os 200 mais recentes) com a pasta onde estavam, o tamanho e as datas de exclusão e de eliminação automática (o cron que a aplica chega no Plano 4). «Restaurar» devolve o ficheiro à pasta de origem (ou à raiz) e diz com que nome ficou; «Eliminar de vez» e «Esvaziar lixeira» pedem confirmação, e esvaziar vai mostrando o progresso. Os ficheiros excluídos continuam a ocupar quota até serem eliminados de vez.

**Partilhar**: «Partilhar…» no menu de um ficheiro abre um diálogo para criar links (sem validade, 1, 7 ou 30 dias), copiar o link, ver os links ativos e revogá-los. **O link completo só se vê logo a seguir a criá-lo** (o servidor guarda só o hash do token); depois só se vê a data de criação e a validade. Quem recebe o link abre `/s/<token>` sem iniciar sessão, vê o nome e o tamanho e descarrega o ficheiro; um link revogado, expirado ou de um ficheiro excluído mostra sempre o mesmo aviso. A página não carrega recursos de outras origens.

**Sair** com envios em curso pede confirmação (sair cancela-os). Quando vários envios terminam, as listagens e a quota atualizam-se uma vez por meio segundo, e não uma vez por ficheiro.
```

Em `docs/superpowers/specs/2026-10-03-spacework-design.md`, na tabela da secção 8, linha de `/` Meu espaço (a pesquisa ficou na barra lateral, para estar em todas as páginas), trocar:

```markdown
Cabeçalho com caminho da pasta (*breadcrumb*), pesquisa, "Nova pasta" e "Carregar". Lista de pastas e ficheiros
```

por:

```markdown
A caixa de pesquisa fica na barra lateral, em todas as páginas (Enter leva a `/pesquisa?q=`, com os resultados e o caminho de cada um). Cabeçalho com caminho da pasta (*breadcrumb*), "Nova pasta" e "Carregar". Lista de pastas e ficheiros
```

- [ ] **Step 2: Índice dos planos**

O índice já tem a linha do 3B como «Escrito, por executar» (veio com o commit deste plano). Passa a «Concluído», os pendentes que o 3B resolveu ficam registados como resolvidos e os que ficam para os planos seguintes ganham o seu sítio.

Em `docs/superpowers/plans/README.md`, na tabela do topo, trocar:

```markdown
| 3B | [Interface da lixeira, pesquisa e partilha](2026-10-03-03b-interface-lixeira-pesquisa-partilha.md) | Ecrã `/lixeira` (restaurar, eliminar de vez, esvaziar), caixa de pesquisa com os resultados e o caminho de cada um, diálogo «Partilhar» (criar links com validade, copiar, revogar), página pública `/s/:token`; fila de envios com um refresh agrupado e aviso ao sair | Escrito, por executar |
```

por:

```markdown
| 3B | [Interface da lixeira, pesquisa e partilha](2026-10-03-03b-interface-lixeira-pesquisa-partilha.md) | Ecrã `/lixeira` (restaurar, eliminar de vez, esvaziar), caixa de pesquisa com os resultados e o caminho de cada um, diálogo «Partilhar» (criar links com validade, copiar, revogar), página pública `/s/:token`; fila de envios com um refresh agrupado e aviso ao sair | Concluído |
```

Na secção «Plano 3», no ponto «Para o 3B (interface)», trocar:

```markdown
- Para o 3B (interface): esvaziar a lixeira repete `DELETE /api/trash` até `remaining` ser 0 (ou `purged` ser 0); a lixeira lista no máximo 200 (`total` conta todos); o link completo só se mostra uma vez, na criação (`token` da resposta de `POST /api/files/:id/shares`); extrair o código comum de `FolderActions`/`FileActions` quando entrar «Partilhar»; dividir o contexto dos envios (itens e ações) para a lista não re-renderizar a cada evento de progresso; um refresh por ficheiro enviado (agrupar quando a fila fica ociosa); «Sair» com envios em curso cancela-os em silêncio: avisar antes; faltam testes dos hooks `useDeleteFolder`/`useUpdateFile`; `formatDate` com `NaN`; o 409 do restauro (10 nomes ocupados) precisa de uma mensagem própria na interface (a da API fala de «um envio em curso»); a página `/s/:token` não deve carregar recursos de terceiros.
```

por:

```markdown
- Resolvido no 3B (interface): esvaziar a lixeira repete `DELETE /api/trash` até `remaining` ser 0 (ou `purged` ser 0), com progresso; a lixeira mostra os 200 mais recentes e diz quantos há (`total`); o link completo só se mostra uma vez, na criação, e deixa de se ver se esse link for revogado; o código comum de `FolderActions`/`FileActions` está em `useDialog`; o contexto dos envios divide-se em ações, «ocupado» e lista (a página da pasta já não re-renderiza com o progresso); um refresh por intervalo de 500 ms em vez de um por ficheiro enviado; «Sair» com envios em curso pede confirmação; testes de `useDeleteFolder`/`useUpdateFile`; `formatDate` com valores inválidos; o 409 do restauro tem uma mensagem própria; um teste garante que `index.html` e o CSS não carregam recursos de outras origens (e que os cabeçalhos estáticos têm `Referrer-Policy`); `ConfirmDialog` com o texto de «a decorrer» configurável (`pendingLabel`); o foco fica no campo de pesquisa depois de pesquisar; o `Modal` devolve o foco ao diálogo quando o elemento focado desaparece (por exemplo, a linha de um link revogado); um `ConfirmDialog` ignora Esc e o fundo enquanto a ação decorre (e o diálogo de partilha faz o mesmo enquanto cria o link), com «Cancelar» e «Fechar» desativados; a pesquisa anuncia o seu estado numa região viva (`role="status"`) e o diálogo de partilha leva o foco para o link criado; o botão «Eliminar de vez» tem o texto visível no nome acessível.
- Resolvido no 3B (defeito latente): `useLogout` fazia `queryClient.clear()`, e só funcionava porque o layout, que observa a sessão, era também quem chamava o hook (re-renderizava e apanhava a consulta nova); passou a fazer como o 401, e os dois usam o mesmo `forgetAccount` (cancela um pedido da sessão ainda a decorrer, `removeQueries` das outras consultas, esvazia a cache das mutações, que guardava senhas e tokens, e põe a sessão a `null`).
- Decisão do 3B: a caixa de pesquisa fica na barra lateral, em todas as páginas, e os resultados numa página própria (`/pesquisa?q=`), em vez de uma lista dentro de «Meu espaço»: o endereço guarda-se e o botão «Voltar» funciona. Pesquisa-se com Enter, não a cada tecla.
- Fica sem plano (3B, achados menores): a lixeira não se atualiza sozinha enquanto está aberta (outro separador pode excluir ou restaurar); os avisos de restauro e de erro ficam no ecrã até à ação seguinte, mesmo depois de eliminar ou esvaziar; depois de eliminar de vez ou esvaziar, o foco cai para o corpo da página (o botão que abriu o diálogo desapareceu ou ficou desativado); o texto de progresso de «Esvaziar lixeira» («A eliminar… x de N») e o «A lixeira está vazia.» não são regiões vivas (`aria-live`); a caixa de pesquisa mantém o texto escrito se se mudar de página sem pesquisar; «Revogar» não pede confirmação; os links ativos só se distinguem pelo número e pela data (e não se pode dar um nome a cada link).
```

Na secção «Plano 2B», trocar:

```markdown
- Fica para o Plano 3B: o ecrã da lixeira (a API já existe: `DELETE /api/trash` liberta o espaço).
```

por:

```markdown
- Feito no Plano 3B: o ecrã da lixeira.
```

No título do bloco do Plano 3, trocar:

```markdown
**Plano 3 (lixeira, pesquisa, partilha): a API ficou no Plano 3A; a interface é o Plano 3B**
```

por:

```markdown
**Plano 3 (lixeira, pesquisa, partilha): a API ficou no Plano 3A e a interface no Plano 3B**
```

Na secção «Plano 5 (deploy)», no ponto da revisão final do 2B (passagem de acessibilidade), o «A excluir…» fixo já foi resolvido (`pendingLabel`). Trocar:

```markdown
`ConfirmDialog` sem `aria-describedby` e com «A excluir…» fixo
```

por:

```markdown
`ConfirmDialog` sem `aria-describedby`
```

Na secção «Plano 5 (deploy)», antes do ponto «Novo (revisão final do 3A)», trocar:

```markdown
- Novo (revisão final do 3A): teste de fumo
```

por:

```markdown
- Novo (3B), browser real com o Playwright: o botão «Copiar» do diálogo «Partilhar…» (a área de transferência precisa de permissão; no painel do Claude foi negada e o texto ficou selecionado); descarregar pelo link público sem sessão (`Content-Disposition: attachment`); abrir `/s/<token>` pelo fallback de SPA do Worker; «Sair» com um envio grande a decorrer; o `Esc` e o foco nos diálogos novos (partilha, esvaziar a lixeira, sair com envios).
- Novo (revisão final do 3A): teste de fumo
```

- [ ] **Step 3: Verificação manual no browser**

Os testes correm em jsdom: não veem o aspeto, o foco, a área de transferência nem a navegação de verdade. Percorrer este guião num browser real, com uma conta **fictícia** numa base local limpa (nunca com credenciais reais; apagar `.wrangler` no fim):

1. `npm run db:migrate:local && npm run dev`, abrir `http://localhost:5173`, registar `ana@example.test` com uma senha inventada na hora. Criar uma pasta «Fotos» e uma «Documentos» com «Contas 2026» lá dentro, e carregar uns ficheiros (`praia.png`, `relatório.pdf`, `notas da praia.txt`).
2. **Pesquisa:** escrever «praia» na caixa da barra lateral e carregar em Enter. O endereço passa a `/pesquisa?q=praia`, a lista mostra os resultados com «Em Meu espaço / Fotos»; a ligação leva à pasta; as ações do menu funcionam; excluir um resultado tira-o da lista. Num ecrã de telemóvel (375 px) a barra lateral continua legível.
3. **Partilhar:** no menu de um ficheiro, «Partilhar…» → validade «7 dias» → «Criar link». O link aparece uma vez, com o aviso; «Copiar» copia ou, se o browser negar, seleciona o texto e explica. Abrir o link num separador (sem sessão serve o mesmo): nome, tamanho e «Descarregar». `curl -i <link do descarregamento>` mostra `content-disposition: attachment`, `x-content-type-options: nosniff` e `content-security-policy: default-src 'none'; sandbox`. «Revogar» tira o link da lista **e** o endereço do diálogo; recarregar a página pública mostra «Este link não existe ou já não está disponível.».
4. **Lixeira:** excluir um ficheiro, abrir «Lixeira»: aparece com a pasta onde estava e as datas. Carregar outro ficheiro com o mesmo nome na raiz e restaurar o excluído: o aviso diz que ficou «… (restaurado)». «Eliminar de vez» pede confirmação e o espaço usado desce. «Esvaziar lixeira» mostra «A eliminar… 0 de N» e acaba com «A lixeira está vazia.».
5. **Sair com envios:** com um envio grande a decorrer, «Sair» pergunta antes (Cancelar mantém tudo; «Sair» termina a sessão e cancela o envio).

- [ ] **Step 4: Verificação final e commit**

Run: `npx vitest run`
Expected: `Test Files  31 passed (31)`, `Tests  271 passed (271)`.

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  31 passed (31)`, `Tests  237 passed (237)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npm run build`
Expected: `✓ built in ...` duas vezes (Worker e cliente).

Commit:

```bash
git add README.md docs
git commit -m "Documenta a interface da lixeira, da pesquisa e da partilha e fecha o Plano 3B" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Auto-revisão do plano contra a especificação

| Requisito | Onde |
|---|---|
| Spec §8, `/lixeira`: Restaurar, Eliminar definitivamente, Esvaziar lixeira | Task 4 |
| Spec §5, restaurar: sufixo « (restaurado)» e raiz se a pasta já não existe (a interface diz como o ficheiro ficou); 409 com os dez nomes ocupados | Task 4 |
| Spec §5, eliminar definitivamente e esvaziar: a quota desce na barra lateral; esvaziar por blocos com progresso | Tasks 2 e 4 |
| Spec §5, pesquisa: mínimo 2 e máximo 100 caracteres, até 50 resultados, cada um com o caminho; spec §8, a caixa de pesquisa (na barra lateral) | Tasks 1, 2 e 3 |
| Spec §8, menu por item com «partilhar» | Task 5 |
| Spec §5, partilha: link completo só na criação, validade opcional, lista de links ativos (criação e validade), revogar | Tasks 2 e 5 |
| Spec §8, `/s/:token`: nome, tamanho e «Descarregar»; o mesmo aviso para um link que não existe, foi revogado, expirou ou cujo ficheiro foi excluído | Task 6 |
| Pendente do Plano 3: `FolderActions`/`FileActions` com código comum | Task 5 |
| Pendente do Plano 2B: contexto dos envios em itens e ações; um refresh por ficheiro enviado; «Sair» com envios em curso | Task 7 |
| Pendente do Plano 2B: testes de `useDeleteFolder` e `useUpdateFile`; `formatDate` com `NaN`; `ConfirmDialog` com «A excluir…» fixo | Tasks 1 e 4 |
| Pendente do Plano 3: o 409 do restauro com mensagem própria; a página pública sem recursos de terceiros | Tasks 4 e 6 |
| Defeito encontrado ao escrever o plano: `useLogout` dependia de o layout o chamar; e o fim de sessão tem de manter o que o `clear()` garantia (pedido da sessão em curso, cache das mutações) | Task 7 (e `gcTime: 0` na Task 2) |
| Acessibilidade: foco depois de pesquisar e de criar um link, região viva da pesquisa, diálogos que não se fecham a meio de uma ação, foco devolvido ao diálogo, nome acessível de «Eliminar de vez» | Tasks 3, 4, 5 e 7 |

**Fora deste plano:** o painel de administração e o cron de manutenção (Plano 4); o deploy, o Playwright e a passagem de acessibilidade em browser real (Plano 5). Nenhuma rota da API muda.

**Totais de testes (medidos na execução deste plano numa pasta limpa):** Worker: Test Files 31 passed (31); Tests 271 passed (271). Interface: Test Files 31 passed (31); Tests 237 passed (237).

## Notas da execução

- **Decisões de desenho que a especificação deixa em aberto:** a caixa de pesquisa fica na barra lateral, em todas as páginas, e os resultados numa página própria (`/pesquisa?q=`), em vez de uma lista dentro de «Meu espaço» (a spec fala de um cabeçalho com pesquisa, que só existiria numa página): o endereço de uma pesquisa guarda-se e o botão «Voltar» funciona. Pesquisa-se com Enter ou «Pesquisar», não a cada tecla (sem *debounce*, sem entradas a mais no histórico, sem leituras da D1 a cada letra). O refresh depois dos envios é um por intervalo de 500 ms e não um por ficheiro. Revogar um link não pede confirmação.
- **Defeitos que a verificação encontrou, já corrigidos neste plano:** `useLogout` fazia `queryClient.clear()` e só funcionava porque o layout era também quem chamava o hook; revogar o link acabado de criar deixava o endereço, já inválido, no diálogo. O primeiro foi apanhado ao mover o «Sair» para um componente próprio (os testes do layout deixaram de levar ao login) e o segundo no browser.
- **Correções que as revisões acrescentaram a este plano (já nos passos acima):** a caixa de pesquisa já não é remontada (mantém o foco); o estado da pesquisa é uma região viva; os diálogos da lixeira, de excluir e de «Sair» não se fecham enquanto a ação decorre (`ConfirmDialog`), como o de partilha enquanto cria o link; o `Modal` devolve o foco ao diálogo se o elemento focado desaparece (revogar um link com o teclado); o fim de sessão é `forgetAccount` (cancela a sessão em curso, esvazia a cache das mutações); o token da partilha tem `gcTime: 0` e o foco vai para o link criado; o botão «Eliminar de vez» tem o texto visível no nome acessível; os testes dos temporizadores têm margens de 200 a 400 ms.
- **Verificação manual:** o guião da Task 8 foi percorrido num browser real contra o `npm run dev` durante a escrita deste plano, com uma conta fictícia numa base local limpa (pesquisa, partilha com validade de 7 dias, página pública, `curl` do descarregamento com `Content-Disposition: attachment` e CSP, revogação, restauro com «(restaurado)», esvaziar a lixeira, a barra lateral num ecrã de 375 px). O botão «Copiar» foi negado pela área de transferência do painel do Claude e o plano B (texto selecionado e a explicação) funcionou. Depois da execução e da revisão final repetiu-se, sobre o código final, o essencial: o foco continua na caixa depois de pesquisar (e o estado da pesquisa é lido na região viva), depois de criar um link o foco vai para o endereço (selecionado), revogar com o teclado esconde o endereço e o Esc fecha o diálogo e devolve o foco ao botão do menu, a lixeira mostra os botões com o nome acessível novo, e «Sair» com um envio de 95 MB a decorrer mostra a confirmação (e «Sair» no diálogo termina a sessão).
