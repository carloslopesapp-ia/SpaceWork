# SpaceWork — Plano 8: navegar na pré-visualização (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na imagem (ou no PDF) ampliada, **setas dos dois lados** (e as teclas ← e →) para passar ao ficheiro anterior e ao seguinte da pasta que se está a ver, ou dos resultados da pesquisa, com um contador («2 de 5»). Só passa pelos ficheiros que se pré-visualizam (imagens e PDF), pela ordem da lista; nos extremos a seta fica desativada.

**Architecture:** Só interface: **nenhuma rota, nenhuma migração, nenhuma mudança no Worker**. Hoje cada linha e cada quadrado abre o seu próprio diálogo, que não conhece os vizinhos. O diálogo passa a ser da **página**: o hook `usePreviewer(files)` (em `previewer.tsx`) guarda o id do ficheiro aberto, calcula a lista dos que se pré-visualizam e mostra o `PreviewDialog` com `navigation` (`index`, `total`, `onPrevious`, `onNext`); `FileRow` e `FileTile` limitam-se a pedir a pré-visualização (`onPreview`) e levam `data-preview-id`, para o foco voltar a eles. O `PreviewDialog` ganha as duas setas (botões com `aria-disabled`, para o foco não se perder nos extremos), o contador numa região viva e as teclas ← e →, ouvidas no documento (por isso calam-se quando o foco está dentro do leitor de PDF, que as usa para mudar de página).

**Tech Stack:** o dos planos anteriores; nenhuma dependência nova.

**Spec:** [docs/superpowers/specs/2026-10-03-spacework-design.md](../specs/2026-10-03-spacework-design.md) (secção 8, interface). Índice dos planos: [README.md](README.md).

## Global Constraints

Valores da especificação e dos planos anteriores; todas as tarefas os cumprem implicitamente.

- Interface em português europeu. **Nada muda no Worker, na API nem na base de dados.**
- A lista de navegação é a dos ficheiros que se pré-visualizam (`previewContentType(nome) !== null`: png, jpg, jpeg, gif, webp e pdf), pela ordem da lista da página; as pastas e os outros ficheiros não contam. **Não dá a volta**: no primeiro ficheiro a seta de trás fica desativada e no último a da frente. Com um só ficheiro que se pré-visualiza não há setas nem contador.
- As setas desativadas usam `aria-disabled="true"` e **não** `disabled`: o botão em que se acabou de carregar continua focável, e o foco não se perde (com o foco no `<body>` o Esc deixava de fechar o diálogo).
- As teclas ← e → ouvem-se no documento e ignoram o que tem Ctrl, Alt ou Meta; nos extremos não fazem nada.
- O ficheiro aberto guarda-se pelo **id**: se a lista muda à volta dele, o diálogo continua nele; se ele sai da lista (excluído, renomeado para um tipo sem pré-visualização), o diálogo fecha-se.
- **O foco ao fechar** volta ao botão que abriu o diálogo (o menu «⋮», por exemplo); só se se passou a **outro** ficheiro é que vai para o botão do ficheiro que está à vista (`data-preview-id`: o nome de uma linha ou o rosto de um quadrado).
- A imagem ou o PDF de cada ficheiro tem a sua `key` (o id), para o aviso de uma imagem que falhou não passar à seguinte.
- Os testes da interface (`npx vitest run -c vitest.web.config.ts`) e os de ponta a ponta (`npm run test:e2e`) mostram só o resumo: qualquer outra saída (avisos de `act`, `console.error`) é um defeito do teste a corrigir. Nenhum teste espera por temporizadores falsos.
- Este plano não instala nada, não toca na conta da Cloudflare, no GitHub nem em credenciais, e **não faz push**. Vitest `^4.1`.
- **Nenhum `git push` sem confirmação explícita do utilizador.**

## Ambiente

- Node 24 e npm 11; todos os comandos correm na raiz do repositório (`~/Developer/SpaceWork`, fora do iCloud). Ramo de trabalho: `plano-8-navegacao-previsualizacao`.
- Commits: mensagem curta em português; cada commit termina com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (nos comandos abaixo, é o segundo `-m`). Escrever **exatamente** esse trailer, "Claude Sonnet 5.5", mesmo que o modelo que executa seja outro.
- As Tasks 1 e 2 são da interface (`npx vitest run -c vitest.web.config.ts`); a Task 3 tem o teste de ponta a ponta (`npm run test:e2e`, porta 4180 livre; o Chromium do Playwright já deve estar instalado) e a documentação.
- A verificação manual (Task 3) usa um utilizador e ficheiros **fictícios** numa base local limpa.

## Estrutura de ficheiros deste plano

```
src/web/components/PreviewDialog.tsx     as setas, o contador e as teclas (`navigation`); o corpo com `key`
src/web/previewer.tsx                    o hook usePreviewer: o diálogo é da página e conhece a lista (novo)
src/web/components/ItemRows.tsx          FileRow pede a pré-visualização (`onPreview`) em vez de a abrir
src/web/components/Tiles.tsx             FileTile também
src/web/pages/FolderPage.tsx             usa o hook com os ficheiros da pasta
src/web/pages/SearchPage.tsx             usa o hook com os ficheiros dos resultados
e2e/gallery.spec.ts                      as setas e as teclas num browser real (novo)
README.md, spec §8, plans/README.md      a documentação e o índice
src/web/                                 + os testes dos ficheiros acima
```

---


### Task 1: O diálogo de pré-visualização: as setas, o contador e as teclas ← e →

**Files:**
- Modify: `src/web/components/PreviewDialog.tsx`
- Test: `src/web/components/PreviewDialog.test.tsx`

**Interfaces:**
- Consumes: `Modal`, `Button`, `Message` e `previewContentType` (planos anteriores) e o `PreviewDialog({ file, onClose })` que já existe.
- Produces: `PreviewNavigation` (`{ index, total, onPrevious, onNext }`) e `PreviewDialog({ file, onClose, navigation? })`: com `navigation`, duas setas («Ficheiro anterior», «Ficheiro seguinte»; `aria-disabled` nos extremos), o contador «2 de 5» numa região viva e as teclas ← e →; o corpo (imagem ou PDF) com `key` do ficheiro.

- [ ] **Step 1: Os testes primeiro**

Sem `navigation` o diálogo é o de sempre (nem setas nem contador). Com ela: as duas setas e o «2 de 3», e cada seta chama o seu ficheiro; no primeiro ficheiro a de trás **não faz nada** e no último a da frente também, mas continuam focáveis (`aria-disabled`, e o foco não se perde); as teclas ← e → fazem o mesmo (ouvidas no documento), não fazem nada nos extremos nem com Ctrl, Alt ou Meta, e deixam de se ouvir quando o diálogo desaparece; e ao passar a outro ficheiro, o aviso de uma imagem que falhou não passa à seguinte (o corpo tem a `key` do ficheiro).

Em `src/web/components/PreviewDialog.test.tsx`, trocar:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FileItem } from "../../shared/types";
```

por:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FileItem } from "../../shared/types";
```

Em `src/web/components/PreviewDialog.test.tsx`, trocar:

```tsx
  });
});
```

por:

```tsx
  });
});

describe("PreviewDialog: setas para o ficheiro anterior e o seguinte", () => {
  const navigation = (index: number, total: number) => ({ index, total, onPrevious: vi.fn(), onNext: vi.fn() });

  it("sem navegação (um só ficheiro, ou fora de uma lista) não há setas nem contador", () => {
    render(<PreviewDialog file={file("foto.png")} onClose={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Ficheiro anterior" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ficheiro seguinte" })).not.toBeInTheDocument();
    expect(screen.queryByText(/ de \d+$/)).not.toBeInTheDocument();
  });

  it("mostra as duas setas e o sítio onde está («2 de 3»), e cada seta chama o seu ficheiro", async () => {
    const nav = navigation(1, 3);
    render(<PreviewDialog file={file("b.png")} onClose={() => undefined} navigation={nav} />);
    const dialog = screen.getByRole("dialog", { name: "b.png" });
    expect(within(dialog).getByText("2 de 3")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Ficheiro seguinte" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Ficheiro anterior" }));

    expect(nav.onNext).toHaveBeenCalledTimes(1);
    expect(nav.onPrevious).toHaveBeenCalledTimes(1);
  });

  it("no primeiro ficheiro a seta de trás não faz nada, e no último a da frente também (continuam focáveis: o foco não se perde)", async () => {
    const first = navigation(0, 3);
    const { unmount } = render(<PreviewDialog file={file("a.png")} onClose={() => undefined} navigation={first} />);
    const back = screen.getByRole("button", { name: "Ficheiro anterior" });
    expect(back).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(back);
    expect(first.onPrevious).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Ficheiro seguinte" })).toHaveAttribute("aria-disabled", "false");
    unmount();

    const last = navigation(2, 3);
    render(<PreviewDialog file={file("c.png")} onClose={() => undefined} navigation={last} />);
    const forward = screen.getByRole("button", { name: "Ficheiro seguinte" });
    expect(forward).toHaveAttribute("aria-disabled", "true");
    forward.focus();
    await userEvent.click(forward);
    expect(last.onNext).not.toHaveBeenCalled();
    expect(forward).toHaveFocus();
  });

  it("as teclas ← e → fazem o mesmo, e não fazem nada nos extremos nem com Ctrl, Alt ou Meta", () => {
    const middle = navigation(1, 3);
    render(<PreviewDialog file={file("b.png")} onClose={() => undefined} navigation={middle} />);

    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    fireEvent.keyDown(document, { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(document, { key: "ArrowLeft", altKey: true });
    fireEvent.keyDown(document, { key: "ArrowLeft", metaKey: true });

    expect(middle.onNext).toHaveBeenCalledTimes(1);
    expect(middle.onPrevious).toHaveBeenCalledTimes(1);
  });

  it("nos extremos as teclas não chamam nada", () => {
    const first = navigation(0, 2);
    render(<PreviewDialog file={file("a.png")} onClose={() => undefined} navigation={first} />);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(first.onPrevious).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(first.onNext).toHaveBeenCalledTimes(1);
  });

  it("ao desaparecer o diálogo, as teclas deixam de fazer efeito", () => {
    const nav = navigation(1, 3);
    const { unmount } = render(<PreviewDialog file={file("b.png")} onClose={() => undefined} navigation={nav} />);
    unmount();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(nav.onNext).not.toHaveBeenCalled();
  });

  it("ao passar a outro ficheiro, uma imagem que falhou não deixa o aviso para a seguinte", () => {
    const nav = navigation(0, 2);
    const { rerender } = render(<PreviewDialog file={{ ...file("a.png"), id: "a1" }} onClose={() => undefined} navigation={nav} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(<PreviewDialog file={{ ...file("b.png"), id: "b2" }} onClose={() => undefined} navigation={{ ...nav, index: 1 }} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "b.png" })).toHaveAttribute("src", "/api/files/b2/preview");
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts src/web/components/PreviewDialog.test.tsx`
Expected: FAIL (Test Files  1 failed (1); Tests  5 failed | 7 passed (12)). Falham os testes das setas, das teclas e do aviso que não passa à seguinte; os de sempre passam.

- [ ] **Step 2: A implementação**

**`PreviewBody`** é o que o diálogo mostra (a imagem ou o PDF) e leva a sua `key` (o id do ficheiro): o estado «falhou» é dele e recomeça a cada ficheiro. **As setas** são botões posicionados nos dois lados do corpo (sobre os bordos da imagem no telemóvel; com uma margem lateral a partir de 640 px, para não taparem o leitor de PDF), com `aria-disabled` e não `disabled`: no último ficheiro, o botão da frente em que se acabou de carregar continua a ter o foco, e o Esc continua a fechar o diálogo. **O contador** («2 de 5») está numa região viva. **As teclas** ouvem-se no documento (e, por isso, não se ouvem quando o foco está dentro do leitor de PDF, que usa as setas para mudar de página).

Em `src/web/components/PreviewDialog.tsx`, trocar:

```tsx
import { useState } from "react";
import { previewContentType } from "../../shared/preview";
import type { FileItem } from "../../shared/types";
import { Button } from "./Button";
import { Message } from "./Message";
import { Modal } from "./Modal";

/**
 * Pré-visualização de uma imagem (`<img>`) ou de um PDF (`<iframe>`), servida por `/api/files/:id/preview`, que só aceita
 * estes tipos. Abre-se ao clicar. O mosaico só mostra miniaturas das imagens pequenas (`thumbnails.ts`): a API responde com
 * `no-store`, por isso cada miniatura é um pedido novo a cada visita a uma pasta.
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
```

por:

```tsx
import { useEffect, useState } from "react";
import { previewContentType } from "../../shared/preview";
import type { FileItem } from "../../shared/types";
import { Button } from "./Button";
import { Message } from "./Message";
import { Modal } from "./Modal";

/** Onde o ficheiro está na lista dos que se pré-visualizam, e como passar ao anterior e ao seguinte. */
export interface PreviewNavigation {
  /** A posição do ficheiro aberto (a contar de 0) e quantos há. */
  index: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}

/** O que mostra o diálogo: a imagem ou o PDF. Tem a sua `key` (o id do ficheiro), para um aviso de falha não passar ao ficheiro seguinte. */
function PreviewBody({ file }: { file: FileItem }) {
  const [failed, setFailed] = useState(false);
  const type = previewContentType(file.name);
  const id = encodeURIComponent(file.id);

  if (type === null || failed) {
    return (
      <Message kind="error">
        {type === null ? "Este tipo de ficheiro não tem pré-visualização." : "Não foi possível carregar a pré-visualização."}
      </Message>
    );
  }
  if (type.startsWith("image/")) {
    return (
      <img
        src={`/api/files/${id}/preview`}
        alt={file.name}
        onError={() => setFailed(true)}
        className="mx-auto max-h-[70vh] max-w-full object-contain"
      />
    );
  }
  return (
    <iframe
      src={`/api/files/${id}/preview`}
      title={`Pré-visualização de ${file.name}`}
      className="h-[70vh] w-full rounded-lg border border-slate-200"
    />
  );
}

function Arrow({ direction, disabled, onClick }: { direction: "previous" | "next"; disabled: boolean; onClick: () => void }) {
  const previous = direction === "previous";
  // `aria-disabled` e não `disabled`: no primeiro e no último ficheiro a seta continua focável, e o foco não se perde (o Esc continua a fechar o diálogo).
  return (
    <button
      type="button"
      aria-label={previous ? "Ficheiro anterior" : "Ficheiro seguinte"}
      aria-disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={`absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-slate-300 bg-white/90 text-slate-700 shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
        previous ? "left-1" : "right-1"
      } ${disabled ? "cursor-not-allowed opacity-40" : "hover:bg-white"}`}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={previous ? "M12 4l-6 6 6 6" : "M8 4l6 6-6 6"} />
      </svg>
    </button>
  );
}

/**
 * Pré-visualização de uma imagem (`<img>`) ou de um PDF (`<iframe>`), servida por `/api/files/:id/preview`, que só aceita
 * estes tipos. Abre-se ao clicar. O mosaico só mostra miniaturas das imagens pequenas (`thumbnails.ts`): a API responde com
 * `no-store`, por isso cada miniatura é um pedido novo a cada visita a uma pasta.
 *
 * Com `navigation`, tem setas para o ficheiro anterior e o seguinte (e as teclas ← e →) e diz onde está («2 de 5»). As teclas ouvem-se no
 * documento e por isso calam-se quando o foco está dentro do leitor de PDF, que usa as setas para mudar de página.
 */
export function PreviewDialog({ file, onClose, navigation }: { file: FileItem; onClose: () => void; navigation?: PreviewNavigation }) {
  const id = encodeURIComponent(file.id);
  const atStart = navigation !== undefined && navigation.index === 0;
  const atEnd = navigation !== undefined && navigation.index === navigation.total - 1;

  useEffect(() => {
    if (!navigation) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "ArrowLeft" && !atStart) navigation.onPrevious();
      else if (event.key === "ArrowRight" && !atEnd) navigation.onNext();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navigation, atStart, atEnd]);

  return (
    <Modal title={file.name} onClose={onClose} wide>
      <div className="relative">
        {navigation && (
          <>
            <Arrow direction="previous" disabled={atStart} onClick={navigation.onPrevious} />
            <Arrow direction="next" disabled={atEnd} onClick={navigation.onNext} />
          </>
        )}
        <div className={navigation ? "sm:px-12" : ""}>
          <PreviewBody key={file.id} file={file} />
        </div>
      </div>
      {navigation && (
        <p aria-live="polite" className="mt-3 text-center text-sm text-slate-500">
          {navigation.index + 1} de {navigation.total}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <a
```

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  43 passed (43)`, `Tests  340 passed (340)`.

- [ ] **Step 3: Verificação e commit**

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src
git commit -m "A pré-visualização ganha setas, contador e as teclas esquerda e direita" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: O diálogo passa a ser da página: o hook `usePreviewer` e as linhas, os quadrados e as páginas

**Files:**
- Create: `src/web/previewer.tsx`
- Modify: `src/web/components/ItemRows.tsx`, `src/web/components/Tiles.tsx`, `src/web/pages/FolderPage.tsx`, `src/web/pages/SearchPage.tsx`
- Create (testes): `src/web/previewer.test.tsx`; Test: `src/web/components/Tiles.test.tsx`, `src/web/pages/FolderPage.test.tsx`, `src/web/pages/SearchPage.test.tsx`

**Interfaces:**
- Consumes: `PreviewDialog` com `navigation` (Task 1), `previewContentType`, `FileRow`, `FileTile`, `FileActions` (que já recebe `onPreview`).
- Produces: `usePreviewer(files): { open(file), dialog }`; `FileRow({ file, path?, onPreview? })` e `FileTile({ file, onPreview? })`, cujo botão de pré-visualizar leva `data-preview-id` (o id do ficheiro); em «Meu espaço» (lista e mosaico) e na pesquisa, as setas passam entre os ficheiros que se pré-visualizam.

- [ ] **Step 1: Os testes primeiro**

`previewer.test.tsx` (o hook, com uma lista de botões «abrir …» e «menu …» que imita as linhas e o menu «⋮»): abre no ficheiro escolhido e só conta os que se pré-visualizam; as setas passam ao anterior e ao seguinte e saltam o que não se pré-visualiza; com um só ficheiro não há setas; se o ficheiro aberto sai da lista o diálogo fecha-se, e se a lista muda à volta dele o diálogo continua nele (pelo id) e conta de novo; **o foco ao fechar:** sem ter navegado volta a quem abriu o diálogo (o menu «⋮»), e se se passou a outro ficheiro vai para o botão do que está à vista (se se voltou ao que se abriu, volta a quem abriu). `Tiles.test.tsx`: o quadrado **pede** a pré-visualização (`onPreview`, com o ficheiro) em vez de a abrir, sem `onPreview` não é um botão e o botão leva `data-preview-id`. `FolderPage.test.tsx`: na lista e no mosaico as setas e as teclas passam de uma imagem à seguinte (e o texto não conta), pelo menu «⋮» também, e fechada sem navegar o foco volta ao «⋮». `SearchPage.test.tsx`: as setas passam pelos ficheiros dos resultados (as pastas e o texto não contam).

Em `src/web/components/Tiles.test.tsx`, trocar:

```tsx
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { FileItem, FolderItem } from "../../shared/types";
import { THUMBNAIL_MAX_BYTES } from "../thumbnails";
import { json, mockApi } from "../test/mock-api";
```

por:

```tsx
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { FileItem, FolderItem } from "../../shared/types";
import { THUMBNAIL_MAX_BYTES } from "../thumbnails";
import { json, mockApi } from "../test/mock-api";
```

Em `src/web/components/Tiles.test.tsx`, trocar:

```tsx

describe("FileTile", () => {
  it("uma imagem pequena mostra a própria imagem, carregada só quando aparece no ecrã", () => {
    const { container } = renderTile(<FileTile file={file("foto.png", 1000)} />);
    const image = container.querySelector("img")!;
    expect(image).toHaveAttribute("src", "/api/files/a1/preview");
    expect(image).toHaveAttribute("loading", "lazy");
```

por:

```tsx

describe("FileTile", () => {
  it("uma imagem pequena mostra a própria imagem, carregada só quando aparece no ecrã", () => {
    const { container } = renderTile(<FileTile file={file("foto.png", 1000)} onPreview={() => undefined} />);
    const image = container.querySelector("img")!;
    expect(image).toHaveAttribute("src", "/api/files/a1/preview");
    expect(image).toHaveAttribute("loading", "lazy");
```

Em `src/web/components/Tiles.test.tsx`, trocar:

```tsx
  });

  it("uma imagem acima do limite mostra o ícone e a extensão, sem pedir a imagem", () => {
    const { container } = renderTile(<FileTile file={file("foto.png", THUMBNAIL_MAX_BYTES + 1)} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("PNG")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pré-visualizar foto.png" })).toBeInTheDocument(); // continua a abrir a pré-visualização
  });

  it("se a imagem não carregar, passa ao ícone", () => {
    const { container } = renderTile(<FileTile file={file("foto.png", 1000)} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("PNG")).toBeInTheDocument();
```

por:

```tsx
  });

  it("uma imagem acima do limite mostra o ícone e a extensão, sem pedir a imagem", () => {
    const { container } = renderTile(<FileTile file={file("foto.png", THUMBNAIL_MAX_BYTES + 1)} onPreview={() => undefined} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("PNG")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pré-visualizar foto.png" })).toBeInTheDocument(); // continua a abrir a pré-visualização
  });

  it("se a imagem não carregar, passa ao ícone", () => {
    const { container } = renderTile(<FileTile file={file("foto.png", 1000)} onPreview={() => undefined} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("PNG")).toBeInTheDocument();
```

Em `src/web/components/Tiles.test.tsx`, trocar:

```tsx
    expect(screen.queryByRole("button", { name: /Pré-visualizar/ })).not.toBeInTheDocument();
  });

  it("um PDF mostra o ícone e abre a pré-visualização ao clicar no quadrado", async () => {
    renderTile(<FileTile file={file("relatório.pdf", 1536)} />);
    expect(screen.getByText("PDF")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Pré-visualizar relatório.pdf" }));

    expect(await screen.findByRole("dialog", { name: "relatório.pdf" })).toBeInTheDocument();
  });

  it("tem o menu «⋮» do ficheiro, com a ação de pré-visualizar quando há pré-visualização", async () => {
    mockApi({ "GET /api/folders/tree": () => json({ folders: [] }) });
    renderTile(<FileTile file={file("relatório.pdf", 1536)} />);
    await userEvent.click(screen.getByRole("button", { name: "Ações para o ficheiro relatório.pdf" }));
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Pré-visualizar" })).toBeInTheDocument();
  });
```

por:

```tsx
    expect(screen.queryByRole("button", { name: /Pré-visualizar/ })).not.toBeInTheDocument();
  });

  it("um PDF mostra o ícone e pede a pré-visualização (`onPreview`, com o ficheiro) ao clicar no quadrado", async () => {
    const onPreview = vi.fn();
    const pdf = file("relatório.pdf", 1536);
    renderTile(<FileTile file={pdf} onPreview={onPreview} />);
    expect(screen.getByText("PDF")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Pré-visualizar relatório.pdf" }));

    expect(onPreview).toHaveBeenCalledExactlyOnceWith(pdf);
  });

  it("sem `onPreview` (quem usa o quadrado não trata da pré-visualização) o quadrado não é um botão", () => {
    renderTile(<FileTile file={file("foto.png", 1000)} />);
    expect(screen.queryByRole("button", { name: /Pré-visualizar/ })).not.toBeInTheDocument();
  });

  it("o botão do quadrado leva o id do ficheiro (`data-preview-id`), para o foco voltar a ele", () => {
    renderTile(<FileTile file={file("foto.png", 1000)} onPreview={() => undefined} />);
    expect(screen.getByRole("button", { name: "Pré-visualizar foto.png" })).toHaveAttribute("data-preview-id", "a1");
  });

  it("tem o menu «⋮» do ficheiro, com a ação de pré-visualizar quando há pré-visualização", async () => {
    mockApi({ "GET /api/folders/tree": () => json({ folders: [] }) });
    renderTile(<FileTile file={file("relatório.pdf", 1536)} onPreview={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Ações para o ficheiro relatório.pdf" }));
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Pré-visualizar" })).toBeInTheDocument();
  });
```

Em `src/web/pages/FolderPage.test.tsx`, trocar:

```tsx
    expect(await screen.findByText(/Esta pasta está vazia/)).toBeInTheDocument();
  });
});
```

por:

```tsx
    expect(await screen.findByText(/Esta pasta está vazia/)).toBeInTheDocument();
  });
});

describe("FolderPage: navegar na pré-visualização", () => {
  beforeEach(() => localStorage.clear());

  const entry = { folderId: "f1", size: 1000, mime: "image/png", createdAt: CREATED };
  const GALLERY: FolderContents = {
    ...FOTOS,
    files: [
      { ...entry, id: "i1", name: "a.png" },
      { ...entry, id: "t1", name: "notas.txt" },
      { ...entry, id: "i2", name: "b.png" },
      { ...entry, id: "i3", name: "c.png" },
    ],
  };
  const serveGallery = () =>
    mockApi({ ...SESSION, "GET /api/folders/:id/contents": () => json(GALLERY), "GET /api/folders/tree": () => json({ folders: [] }) });

  it("na lista: as setas e as teclas passam de uma imagem à seguinte, e ao fechar o foco volta ao nome da que estava à vista", async () => {
    serveGallery();
    const user = userEvent.setup();
    renderApp("/pasta/f1");
    await user.click(await screen.findByRole("button", { name: "b.png" }));
    expect(screen.getByRole("dialog", { name: "b.png" })).toBeInTheDocument();
    expect(screen.getByText("2 de 3")).toBeInTheDocument(); // notas.txt não conta

    await user.click(screen.getByRole("button", { name: "Ficheiro seguinte" }));
    expect(screen.getByRole("dialog", { name: "c.png" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "c.png" })).toHaveAttribute("src", "/api/files/i3/preview");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("dialog", { name: "a.png" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "a.png" })).toHaveFocus();
  });

  it("no mosaico: o quadrado abre a pré-visualização e as setas passam à seguinte", async () => {
    localStorage.setItem("spacework:view-mode", "tiles");
    serveGallery();
    const user = userEvent.setup();
    renderApp("/pasta/f1");
    await user.click(await screen.findByRole("button", { name: "Pré-visualizar a.png" }));
    expect(screen.getByText("1 de 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ficheiro seguinte" }));
    await user.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "Pré-visualizar b.png" })).toHaveFocus();
  });

  it("«Pré-visualizar» no menu «⋮» também deixa navegar", async () => {
    serveGallery();
    const user = userEvent.setup();
    renderApp("/pasta/f1");
    await user.click(await screen.findByRole("button", { name: "Ações para o ficheiro b.png" }));
    await user.click(screen.getByRole("menuitem", { name: "Pré-visualizar" }));

    await user.click(screen.getByRole("button", { name: "Ficheiro anterior" }));

    expect(screen.getByRole("dialog", { name: "a.png" })).toBeInTheDocument();
  });

  it("aberta pelo menu «⋮» e fechada sem navegar, o foco volta ao «⋮»", async () => {
    serveGallery();
    const user = userEvent.setup();
    renderApp("/pasta/f1");
    await user.click(await screen.findByRole("button", { name: "Ações para o ficheiro b.png" }));
    await user.click(screen.getByRole("menuitem", { name: "Pré-visualizar" }));

    await user.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "Ações para o ficheiro b.png" })).toHaveFocus();
  });
});
```

Em `src/web/pages/SearchPage.test.tsx`, trocar:

```tsx
  });
});
```

por:

```tsx
  });
});

describe("pesquisa: pré-visualização com setas", () => {
  const IMAGE = (id: string, name: string): SearchResult => ({
    kind: "file",
    path: [{ id: "f1", name: "Fotos" }],
    file: { id, name, folderId: "f1", size: 1536, mime: "image/png", createdAt: 0 },
  });

  it("as setas passam de um resultado que se pré-visualiza ao seguinte, e saltam as pastas e o que não se pré-visualiza", async () => {
    serve([IMAGE("p1", "praia.png"), FOLDER_IN_ROOT, NOTES_DEEP, IMAGE("p2", "praia2.png")]);
    const user = userEvent.setup();
    renderApp("/pesquisa?q=praia");
    await user.click(await screen.findByRole("button", { name: "praia.png" }));
    expect(screen.getByText("1 de 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ficheiro seguinte" }));

    expect(screen.getByRole("dialog", { name: "praia2.png" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "praia2.png" })).toHaveFocus();
  });
});
```

Criar `src/web/previewer.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FileItem } from "../shared/types";
import { usePreviewer } from "./previewer";

const item = (id: string, name: string): FileItem => ({ id, name, folderId: null, size: 10, mime: "x/y", createdAt: 0 });
const A = item("a", "a.png");
const TXT = item("t", "nota.txt");
const B = item("b", "b.pdf");
const C = item("c", "c.jpg");

/**
 * Uma lista de ficheiros: um botão «abrir …» (com `data-preview-id`, como o nome de uma linha ou o rosto de um quadrado) e um botão «menu …»
 * (que também abre a pré-visualização, como o «Pré-visualizar» do menu «⋮») para cada um, e o diálogo da lista.
 */
function List({ files }: { files: FileItem[] }) {
  const preview = usePreviewer(files);
  return (
    <>
      <ul>
        {files.map((file) => (
          <li key={file.id}>
            <button type="button" data-preview-id={file.id} onClick={() => preview.open(file)}>
              abrir {file.name}
            </button>
            <button type="button" onClick={() => preview.open(file)}>
              menu {file.name}
            </button>
          </li>
        ))}
      </ul>
      {preview.dialog}
    </>
  );
}

describe("usePreviewer", () => {
  it("abre o diálogo no ficheiro escolhido, e só conta os que se pré-visualizam", async () => {
    render(<List files={[A, TXT, B, C]} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "abrir b.pdf" }));

    expect(screen.getByRole("dialog", { name: "b.pdf" })).toBeInTheDocument();
    expect(screen.getByText("2 de 3")).toBeInTheDocument(); // a.png, b.pdf, c.jpg: o texto não conta
  });

  it("as setas passam ao anterior e ao seguinte, e saltam o que não se pré-visualiza", async () => {
    render(<List files={[A, TXT, B, C]} />);
    await userEvent.click(screen.getByRole("button", { name: "abrir a.png" }));

    await userEvent.click(screen.getByRole("button", { name: "Ficheiro seguinte" }));
    expect(screen.getByRole("dialog", { name: "b.pdf" })).toBeInTheDocument(); // saltou nota.txt
    await userEvent.click(screen.getByRole("button", { name: "Ficheiro seguinte" }));
    expect(screen.getByRole("dialog", { name: "c.jpg" })).toBeInTheDocument();
    expect(screen.getByText("3 de 3")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("dialog", { name: "b.pdf" })).toBeInTheDocument();
  });

  it("com um só ficheiro que se pré-visualiza não há setas", async () => {
    render(<List files={[A, TXT]} />);
    await userEvent.click(screen.getByRole("button", { name: "abrir a.png" }));
    expect(screen.getByRole("dialog", { name: "a.png" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ficheiro seguinte" })).not.toBeInTheDocument();
    expect(screen.queryByText(/ de \d+$/)).not.toBeInTheDocument();
  });

  it("se o ficheiro aberto sai da lista (excluído, renomeado para um tipo sem pré-visualização) o diálogo fecha", async () => {
    const { rerender } = render(<List files={[A, B, C]} />);
    await userEvent.click(screen.getByRole("button", { name: "abrir b.pdf" }));
    expect(screen.getByRole("dialog", { name: "b.pdf" })).toBeInTheDocument();

    rerender(<List files={[A, C]} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("se a lista muda à volta do ficheiro aberto, o diálogo continua nele (pelo id) e conta de novo", async () => {
    const { rerender } = render(<List files={[A, B, C]} />);
    await userEvent.click(screen.getByRole("button", { name: "abrir b.pdf" }));
    expect(screen.getByText("2 de 3")).toBeInTheDocument();

    rerender(<List files={[B, C]} />);

    expect(screen.getByRole("dialog", { name: "b.pdf" })).toBeInTheDocument();
    expect(screen.getByText("1 de 2")).toBeInTheDocument();
  });

  it("ao fechar, o foco vai para o botão do ficheiro que estava à vista (não para o que abriu o diálogo)", async () => {
    render(<List files={[A, B, C]} />);
    await userEvent.click(screen.getByRole("button", { name: "menu a.png" }));
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog", { name: "b.pdf" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "abrir b.pdf" })).toHaveFocus();
  });

  it("fechar sem ter navegado devolve o foco ao botão que abriu o diálogo (o menu «⋮», por exemplo)", async () => {
    render(<List files={[A, B, C]} />);
    await userEvent.click(screen.getByRole("button", { name: "menu c.jpg" }));

    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "menu c.jpg" })).toHaveFocus();
  });

  it("se se navegou e se voltou ao ficheiro que se abriu, o foco volta ao botão que abriu o diálogo", async () => {
    render(<List files={[A, B, C]} />);
    await userEvent.click(screen.getByRole("button", { name: "menu b.pdf" }));
    await userEvent.keyboard("{ArrowRight}{ArrowLeft}");
    expect(screen.getByRole("dialog", { name: "b.pdf" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "menu b.pdf" })).toHaveFocus();
  });
});
```

Run: `npx vitest run -c vitest.web.config.ts`
Expected: FAIL (Test Files  4 failed | 40 passed (44); Tests  7 failed | 340 passed (347)). `previewer.test.tsx` nem arranca (o módulo não existe) e falham os testes novos de `Tiles`, `FolderPage` e `SearchPage`.

- [ ] **Step 2: A implementação**

**`usePreviewer(files)`** guarda o **id** do ficheiro aberto, filtra os que se pré-visualizam, e devolve `open(file)` e o `dialog` (com `navigation` só se houver pelo menos dois). Se o id deixa de estar na lista, o diálogo desaparece. O foco ao fechar: o `Modal` já o devolve a quem abriu o diálogo; o hook só o muda se se passou a **outro** ficheiro (um `useEffect` que procura o botão com o `data-preview-id` do que estava à vista). **`FileRow` e `FileTile`** deixam de ter o seu estado e o seu diálogo: pedem a pré-visualização (`onPreview`) e levam `data-preview-id`. **`FolderPage` e `SearchPage`** chamam o hook com os ficheiros da pasta e dos resultados (o hook fica com os outros, antes dos `return` antecipados) e mostram o `dialog`.

Em `src/web/components/ItemRows.tsx`, trocar:

```tsx
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { formatBytes, formatDate } from "../../shared/format";
import { previewContentType } from "../../shared/preview";
```

por:

```tsx
import type { ReactNode } from "react";
import { Link } from "react-router";
import { formatBytes, formatDate } from "../../shared/format";
import { previewContentType } from "../../shared/preview";
```

Em `src/web/components/ItemRows.tsx`, trocar:

```tsx
import { FolderActions } from "./FolderActions";
import { FileIcon, FolderIcon } from "./icons";
import { Location } from "./Location";
import { PreviewDialog } from "./PreviewDialog";

interface ItemRowProps {
  icon: ReactNode;
```

por:

```tsx
import { FolderActions } from "./FolderActions";
import { FileIcon, FolderIcon } from "./icons";
import { Location } from "./Location";

interface ItemRowProps {
  icon: ReactNode;
```

Em `src/web/components/ItemRows.tsx`, trocar:

```tsx
  );
}

export function FileRow({ file, path }: { file: FileItem; path?: BreadcrumbItem[] }) {
  const [previewing, setPreviewing] = useState(false);
  const canPreview = previewContentType(file.name) !== null;
  const openPreview = () => setPreviewing(true);
  return (
    <ItemRow
      icon={<FileIcon />}
      subtitle={path && <Location path={path} />}
      name={
        canPreview ? (
          <button type="button" title={file.name} onClick={openPreview} className="block w-full truncate text-left hover:underline">
            {file.name}
          </button>
        ) : (
```

por:

```tsx
  );
}

/** `onPreview`: quem trata da pré-visualização (a página, que conhece a lista toda e deixa passar de um ficheiro ao seguinte); sem ele a linha não a oferece. */
export function FileRow({ file, path, onPreview }: { file: FileItem; path?: BreadcrumbItem[]; onPreview?: (file: FileItem) => void }) {
  const canPreview = onPreview !== undefined && previewContentType(file.name) !== null;
  const openPreview = () => onPreview?.(file);
  return (
    <ItemRow
      icon={<FileIcon />}
      subtitle={path && <Location path={path} />}
      name={
        canPreview ? (
          <button type="button" title={file.name} data-preview-id={file.id} onClick={openPreview} className="block w-full truncate text-left hover:underline">
            {file.name}
          </button>
        ) : (
```

Em `src/web/components/ItemRows.tsx`, trocar:

```tsx
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
```

por:

```tsx
      size={formatBytes(file.size)}
      date={formatDate(file.createdAt)}
      actions={
        <FileActions file={file} onPreview={canPreview ? openPreview : undefined} />
      }
    />
  );
```

Em `src/web/components/Tiles.tsx`, trocar:

```tsx
import { FileActions } from "./FileActions";
import { FolderActions } from "./FolderActions";
import { FileIcon, FolderIcon } from "./icons";
import { PreviewDialog } from "./PreviewDialog";

// Sem `overflow-hidden` no quadrado: o menu «⋮» abre-se por cima do que está à volta e seria cortado. O corte é só no rosto.
const TILE = "relative flex flex-col rounded-xl border border-slate-200 bg-white hover:border-indigo-300";
```

por:

```tsx
import { FileActions } from "./FileActions";
import { FolderActions } from "./FolderActions";
import { FileIcon, FolderIcon } from "./icons";

// Sem `overflow-hidden` no quadrado: o menu «⋮» abre-se por cima do que está à volta e seria cortado. O corte é só no rosto.
const TILE = "relative flex flex-col rounded-xl border border-slate-200 bg-white hover:border-indigo-300";
```

Em `src/web/components/Tiles.tsx`, trocar:

```tsx

/**
 * Um ficheiro no mosaico. As imagens pequenas mostram a própria imagem (carregada só quando o quadrado está perto do ecrã); os outros
 * ficheiros, o ícone e a extensão. Se o ficheiro se pré-visualiza, o quadrado é um botão que abre a pré-visualização.
 */
export function FileTile({ file }: { file: FileItem }) {
  const [previewing, setPreviewing] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const canPreview = previewContentType(file.name) !== null;
  const openPreview = () => setPreviewing(true);
  const extension = extensionLabel(file.name);

  const face =
```

por:

```tsx

/**
 * Um ficheiro no mosaico. As imagens pequenas mostram a própria imagem (carregada só quando o quadrado está perto do ecrã); os outros
 * ficheiros, o ícone e a extensão. Se o ficheiro se pré-visualiza (e quem usa o quadrado trata disso, `onPreview`), o quadrado é um botão
 * que a pede.
 */
export function FileTile({ file, onPreview }: { file: FileItem; onPreview?: (file: FileItem) => void }) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const canPreview = onPreview !== undefined && previewContentType(file.name) !== null;
  const openPreview = () => onPreview?.(file);
  const extension = extensionLabel(file.name);

  const face =
```

Em `src/web/components/Tiles.tsx`, trocar:

```tsx
  return (
    <li className={TILE}>
      {canPreview ? (
        <button type="button" aria-label={`Pré-visualizar ${file.name}`} onClick={openPreview} className={`${FACE} ${FOCUS}`}>
          {face}
        </button>
      ) : (
```

por:

```tsx
  return (
    <li className={TILE}>
      {canPreview ? (
        <button
          type="button"
          aria-label={`Pré-visualizar ${file.name}`}
          data-preview-id={file.id}
          onClick={openPreview}
          className={`${FACE} ${FOCUS}`}
        >
          {face}
        </button>
      ) : (
```

Em `src/web/components/Tiles.tsx`, trocar:

```tsx
      <Caption
        name={file.name}
        detail={formatBytes(file.size)}
        actions={
          <>
            <FileActions file={file} onPreview={canPreview ? openPreview : undefined} />
            {previewing && <PreviewDialog file={file} onClose={() => setPreviewing(false)} />}
          </>
        }
      />
    </li>
  );
```

por:

```tsx
      <Caption
        name={file.name}
        detail={formatBytes(file.size)}
        actions={<FileActions file={file} onPreview={canPreview ? openPreview : undefined} />}
      />
    </li>
  );
```

Em `src/web/pages/FolderPage.tsx`, trocar:

```tsx
import { NameDialog } from "../components/NameDialog";
import { FileTile, FolderTile } from "../components/Tiles";
import { ViewToggle } from "../components/ViewToggle";
import { filesFromDrop } from "../dropped-files";
import { useContents, useCreateFolder } from "../space";
import { ROOT_LABEL } from "../tree";
import { useUploadActions } from "../uploads-context";
import { useViewMode } from "../view-mode";

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
/** Um diálogo aberto é do que está a decorrer: enquanto houver um, o que se larga não é para a zona de largar (o fundo do diálogo cobre o ecrã todo, por isso não basta olhar ao alvo do evento). */
```

por:

```tsx
import { NameDialog } from "../components/NameDialog";
import { FileTile, FolderTile } from "../components/Tiles";
import { ViewToggle } from "../components/ViewToggle";
import type { FileItem } from "../../shared/types";
import { filesFromDrop } from "../dropped-files";
import { usePreviewer } from "../previewer";
import { useContents, useCreateFolder } from "../space";
import { ROOT_LABEL } from "../tree";
import { useUploadActions } from "../uploads-context";
import { useViewMode } from "../view-mode";

const NO_FILES: FileItem[] = [];

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
/** Um diálogo aberto é do que está a decorrer: enquanto houver um, o que se larga não é para a zona de largar (o fundo do diálogo cobre o ecrã todo, por isso não basta olhar ao alvo do evento). */
```

Em `src/web/pages/FolderPage.tsx`, trocar:

```tsx
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useViewMode();
  const fileInput = useRef<HTMLInputElement>(null);
  // `dragenter`/`dragleave` disparam também ao passar por cima dos filhos: conta-se a profundidade.
  const dragDepth = useRef(0);
```

por:

```tsx
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useViewMode();
  const preview = usePreviewer(contents.data?.files ?? NO_FILES);
  const fileInput = useRef<HTMLInputElement>(null);
  // `dragenter`/`dragleave` disparam também ao passar por cima dos filhos: conta-se a profundidade.
  const dragDepth = useRef(0);
```

Em `src/web/pages/FolderPage.tsx`, trocar:

```tsx
            <FolderTile key={item.id} folder={item} />
          ))}
          {files.map((item) => (
            <FileTile key={item.id} file={item} />
          ))}
        </ul>
      ) : (
```

por:

```tsx
            <FolderTile key={item.id} folder={item} />
          ))}
          {files.map((item) => (
            <FileTile key={item.id} file={item} onPreview={preview.open} />
          ))}
        </ul>
      ) : (
```

Em `src/web/pages/FolderPage.tsx`, trocar:

```tsx
            <FolderRow key={item.id} folder={item} />
          ))}
          {files.map((item) => (
            <FileRow key={item.id} file={item} />
          ))}
        </ul>
      )}

      {creating && (
        <NameDialog
```

por:

```tsx
            <FolderRow key={item.id} folder={item} />
          ))}
          {files.map((item) => (
            <FileRow key={item.id} file={item} onPreview={preview.open} />
          ))}
        </ul>
      )}

      {preview.dialog}

      {creating && (
        <NameDialog
```

Em `src/web/pages/SearchPage.tsx`, trocar:

```tsx
import { useSearchParams } from "react-router";
import { errorMessage } from "../api";
import { Button } from "../components/Button";
import { FileRow, FolderRow } from "../components/ItemRows";
import { Message } from "../components/Message";
import { describeSearch, useSearch } from "../search";

/** O servidor devolve no máximo 50 resultados. */
const MAX_RESULTS = 50;
```

por:

```tsx
import { useSearchParams } from "react-router";
import type { FileItem } from "../../shared/types";
import { errorMessage } from "../api";
import { Button } from "../components/Button";
import { FileRow, FolderRow } from "../components/ItemRows";
import { Message } from "../components/Message";
import { usePreviewer } from "../previewer";
import { describeSearch, useSearch } from "../search";

const NO_FILES: FileItem[] = [];

/** O servidor devolve no máximo 50 resultados. */
const MAX_RESULTS = 50;
```

Em `src/web/pages/SearchPage.tsx`, trocar:

```tsx
  const { term, problem } = describeSearch(raw);
  const search = useSearch(raw);
  const results = problem === null ? search.data : undefined;

  // Uma só linha de estado, sempre montada e com `role="status"`: o foco fica na caixa de pesquisa e os leitores de ecrã só anunciam
  // o que muda dentro de uma região viva (uma linha nova a cada estado não seria anunciada).
```

por:

```tsx
  const { term, problem } = describeSearch(raw);
  const search = useSearch(raw);
  const results = problem === null ? search.data : undefined;
  // As setas da pré-visualização passam pelos ficheiros dos resultados (as pastas não contam), pela ordem em que aparecem.
  const preview = usePreviewer(results?.flatMap((result) => (result.kind === "file" ? [result.file] : [])) ?? NO_FILES);

  // Uma só linha de estado, sempre montada e com `role="status"`: o foco fica na caixa de pesquisa e os leitores de ecrã só anunciam
  // o que muda dentro de uma região viva (uma linha nova a cada estado não seria anunciada).
```

Em `src/web/pages/SearchPage.tsx`, trocar:

```tsx
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

por:

```tsx
            result.kind === "folder" ? (
              <FolderRow key={`folder-${result.folder.id}`} folder={result.folder} path={result.path} />
            ) : (
              <FileRow key={`file-${result.file.id}`} file={result.file} path={result.path} onPreview={preview.open} />
            ),
          )}
        </ul>
      )}
      {preview.dialog}
    </div>
  );
}
```

Criar `src/web/previewer.tsx`:

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import { previewContentType } from "../shared/preview";
import type { FileItem } from "../shared/types";
import { PreviewDialog } from "./components/PreviewDialog";

/**
 * A pré-visualização de uma lista de ficheiros (uma pasta, os resultados de uma pesquisa). `open(file)` abre o diálogo nesse ficheiro e as
 * setas passam ao anterior e ao seguinte **dos que se pré-visualizam**, pela ordem da lista. O diálogo é da página e não de cada linha
 * ou quadrado, para conhecer a lista toda. O ficheiro aberto guarda-se pelo id: se a lista muda à volta dele o diálogo continua nele e se
 * ele sai da lista (foi excluído, ou renomeado para um tipo sem pré-visualização) o diálogo fecha-se.
 *
 * Ao fechar, o foco volta ao botão que abriu o diálogo (o menu «⋮», por exemplo); mas se se passou a outro ficheiro, vai para o botão do ficheiro
 * que está à vista (o que tem `data-preview-id`: o nome de uma linha, o rosto de um quadrado), porque o que abriu já não tem a ver com o que se vê.
 */
export function usePreviewer(files: FileItem[]): { open: (file: FileItem) => void; dialog: ReactNode } {
  const [currentId, setCurrentId] = useState<string | null>(null);
  const shown = useRef<string | null>(null);
  const opened = useRef<string | null>(null);
  const previewable = files.filter((file) => previewContentType(file.name) !== null);
  const index = currentId === null ? -1 : previewable.findIndex((file) => file.id === currentId);

  useEffect(() => {
    if (index !== -1) {
      shown.current = currentId;
      return;
    }
    const id = shown.current;
    shown.current = null;
    if (id === null || id === opened.current) return; // o Modal já devolveu o foco a quem o abriu
    [...document.querySelectorAll<HTMLElement>("[data-preview-id]")].find((element) => element.dataset.previewId === id)?.focus();
  }, [index, currentId]);

  const dialog =
    index === -1 ? null : (
      <PreviewDialog
        file={previewable[index]}
        onClose={() => setCurrentId(null)}
        navigation={
          previewable.length > 1
            ? {
                index,
                total: previewable.length,
                onPrevious: () => index > 0 && setCurrentId(previewable[index - 1].id),
                onNext: () => index < previewable.length - 1 && setCurrentId(previewable[index + 1].id),
              }
            : undefined
        }
      />
    );

  return {
    open: (file) => {
      opened.current = file.id;
      setCurrentId(file.id);
    },
    dialog,
  };
}
```

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  44 passed (44)`, `Tests  355 passed (355)`.

- [ ] **Step 3: Verificação e commit**

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Commit:

```bash
git add src
git commit -m "O diálogo de pré-visualização passa a ser da página e deixa navegar entre os ficheiros" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: As setas num browser real, a documentação e a verificação final

**Files:**
- Create: `e2e/gallery.spec.ts`
- Modify: `README.md`, `docs/superpowers/specs/2026-10-03-spacework-design.md`, `docs/superpowers/plans/README.md`

**Interfaces:**
- Consumes: `signUp`, `upload` (`e2e/support.ts`) e a navegação das Tasks 1 e 2.
- Produces: um teste de ponta a ponta das setas e das teclas; o README, a especificação (§8) e o índice dos planos com o Plano 8 «Concluído».

- [ ] **Step 1: As setas e as teclas num browser real**

Um só teste, com passos: envia três imagens e um texto (que as setas saltam), abre a primeira, e confere que o contador diz «1 de 3» e a seta de trás está desativada; passa à seguinte com a seta e com a tecla →, vê «3 de 3» com a seta da frente desativada e a imagem a **carregar-se de verdade** (`naturalWidth`); volta com ←, fecha com o Esc e confere que o foco voltou ao nome da imagem que estava à vista. Escreve-se depois do código que testa (não há fase «vermelha»): uma falha é um defeito encontrado. (Foi o teste que já existia, `preview.spec.ts`, que apanhou o defeito do foco da primeira versão: ver as notas no fim.)

Criar `e2e/gallery.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { signUp, upload } from "./support";

// Um PNG de 1×1, válido.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

test("a pré-visualização passa de uma imagem à seguinte com as setas e com o teclado, e ao fechar o foco volta à que estava à vista", async ({ page }) => {
  await signUp(page);
  await upload(page, "a.png", PNG, "image/png");
  await upload(page, "nota.txt", "olá"); // o texto não se pré-visualiza: as setas saltam-no
  await upload(page, "b.png", PNG, "image/png");
  await upload(page, "c.png", PNG, "image/png");

  await page.getByRole("button", { name: "a.png", exact: true }).click();

  await test.step("no primeiro ficheiro a seta de trás está desativada, e o contador diz onde se está", async () => {
    const dialog = page.getByRole("dialog", { name: "a.png" });
    await expect(dialog.getByText("1 de 3")).toBeVisible(); // a.png, b.png e c.png: o texto não conta
    await expect(dialog.getByRole("button", { name: "Ficheiro anterior" })).toHaveAttribute("aria-disabled", "true");
  });

  await test.step("a seta da frente e a tecla → passam à seguinte, e a imagem carrega-se de verdade", async () => {
    await page.getByRole("button", { name: "Ficheiro seguinte" }).click();
    await expect(page.getByRole("dialog", { name: "b.png" })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    const dialog = page.getByRole("dialog", { name: "c.png" });
    await expect(dialog.getByText("3 de 3")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Ficheiro seguinte" })).toHaveAttribute("aria-disabled", "true");
    const image = dialog.getByRole("img", { name: "c.png" });
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(1);
  });

  await test.step("a tecla ← volta atrás, e o Esc fecha e devolve o foco à imagem que estava à vista", async () => {
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("dialog", { name: "b.png" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "b.png", exact: true })).toBeFocused();
  });
});
```

Run: `npx playwright test e2e/gallery.spec.ts`
Expected: `1 passed` (a duração varia).

- [ ] **Step 2: README, especificação e índice dos planos**

O README descreve as setas (e as teclas, o contador, o que acontece nos extremos, o foco ao fechar e o que muda dentro do leitor de PDF). A especificação, §8, ganha a frase na linha de «Meu espaço». O índice passa o Plano 8 a «Concluído».

Em `README.md`, trocar:

```markdown

## Interface

Depois do login, «Meu espaço» (`/`, e `/pasta/:id` dentro de uma pasta) mostra o caminho, as pastas e os ficheiros. Tem o seletor **«Lista | Mosaico»** (a escolha fica guardada neste browser), «Nova pasta», «Carregar ficheiros» (ou arrastar ficheiros para a página) e, em cada linha ou quadrado, o menu «⋮»: o das pastas tem renomear, mover e excluir; o dos ficheiros tem também pré-visualizar (imagens e PDF) e descarregar. Os envios correm até 3 em paralelo, com progresso, e continuam se mudar de pasta; um ficheiro acima de `maxUploadBytes` nem sai do browser. No **mosaico**, cada pasta e cada ficheiro é um quadrado: as imagens até 2 MB mostram a própria imagem (carregada só quando o quadrado está perto do ecrã), as maiores e os outros ficheiros mostram o ícone e a extensão, e clicar num ficheiro que se pré-visualiza abre a pré-visualização. Não há miniaturas geradas: a API responde com `no-store`, por isso cada imagem do mosaico é uma descarga inteira a cada visita a uma pasta (daí o limite de 2 MB).

A **caixa de pesquisa** está na barra lateral de todas as páginas: Enter leva a `/pesquisa?q=...`, que lista as pastas e os ficheiros que têm o texto no nome (2 a 100 caracteres, até 50 resultados), cada um com a pasta onde está e com as mesmas ações das linhas de «Meu espaço». O endereço da pesquisa pode ser guardado ou copiado.
```

por:

```markdown

## Interface

Depois do login, «Meu espaço» (`/`, e `/pasta/:id` dentro de uma pasta) mostra o caminho, as pastas e os ficheiros. Tem o seletor **«Lista | Mosaico»** (a escolha fica guardada neste browser), «Nova pasta», «Carregar ficheiros» (ou arrastar ficheiros para a página) e, em cada linha ou quadrado, o menu «⋮»: o das pastas tem renomear, mover e excluir; o dos ficheiros tem também pré-visualizar (imagens e PDF) e descarregar. Na pré-visualização, as **setas** (e as teclas ← e →) passam ao ficheiro anterior e ao seguinte dos que se pré-visualizam na pasta (ou nos resultados da pesquisa), pela ordem da lista, e um contador diz onde se está («2 de 5»); nos extremos a seta fica desativada, e ao fechar o foco volta ao ficheiro que estava à vista. Dentro do leitor de PDF as teclas são do leitor (mudam de página): as setas do ecrã continuam a funcionar. Os envios correm até 3 em paralelo, com progresso, e continuam se mudar de pasta; um ficheiro acima de `maxUploadBytes` nem sai do browser. No **mosaico**, cada pasta e cada ficheiro é um quadrado: as imagens até 2 MB mostram a própria imagem (carregada só quando o quadrado está perto do ecrã), as maiores e os outros ficheiros mostram o ícone e a extensão, e clicar num ficheiro que se pré-visualiza abre a pré-visualização. Não há miniaturas geradas: a API responde com `no-store`, por isso cada imagem do mosaico é uma descarga inteira a cada visita a uma pasta (daí o limite de 2 MB).

A **caixa de pesquisa** está na barra lateral de todas as páginas: Enter leva a `/pesquisa?q=...`, que lista as pastas e os ficheiros que têm o texto no nome (2 a 100 caracteres, até 50 resultados), cada um com a pasta onde está e com as mesmas ações das linhas de «Meu espaço». O endereço da pesquisa pode ser guardado ou copiado.
```

Em `docs/superpowers/plans/README.md`, trocar:

```markdown
| 5B | [Deploy](2026-10-11-05b-deploy.md) | Recursos na Cloudflare (D1, R2), `wrangler deploy`, o master em produção e o deploy automático por Git; o guia do que se fez e do que correu mal. Feito à mão com o dono (sem replay) | Concluído; faltam as medições que precisam da conta (o cron, o CPU) |
| 6 | [Registo por aprovação](2026-10-11-06-registo-por-aprovacao.md) | `REGISTRATION_OPEN=approval`: as contas novas ficam por aprovar até um administrador as ativar (API, ecrã de registo e de login, painel com «Aprovar» e «Rejeitar…», contador na barra lateral) e a produção passa a usar esse modo | Concluído |
| 7 | [Mosaico em «Meu espaço»](2026-10-11-07-mosaico.md) | O seletor «Lista \| Mosaico» (guardado no browser) e o mosaico de quadrados, com a imagem das fotos até 2 MB e o ícone e a extensão nos outros ficheiros | Concluído |
| 8 | [Navegar na pré-visualização](2026-10-12-08-navegacao-previsualizacao.md) | Setas (e ← →) na pré-visualização para o ficheiro anterior e o seguinte da pasta ou dos resultados da pesquisa, com o contador «2 de 5» | Escrito, por executar |

## Factos verificados que os planos seguintes devem respeitar
```

por:

```markdown
| 5B | [Deploy](2026-10-11-05b-deploy.md) | Recursos na Cloudflare (D1, R2), `wrangler deploy`, o master em produção e o deploy automático por Git; o guia do que se fez e do que correu mal. Feito à mão com o dono (sem replay) | Concluído; faltam as medições que precisam da conta (o cron, o CPU) |
| 6 | [Registo por aprovação](2026-10-11-06-registo-por-aprovacao.md) | `REGISTRATION_OPEN=approval`: as contas novas ficam por aprovar até um administrador as ativar (API, ecrã de registo e de login, painel com «Aprovar» e «Rejeitar…», contador na barra lateral) e a produção passa a usar esse modo | Concluído |
| 7 | [Mosaico em «Meu espaço»](2026-10-11-07-mosaico.md) | O seletor «Lista \| Mosaico» (guardado no browser) e o mosaico de quadrados, com a imagem das fotos até 2 MB e o ícone e a extensão nos outros ficheiros | Concluído |
| 8 | [Navegar na pré-visualização](2026-10-12-08-navegacao-previsualizacao.md) | Setas (e ← →) na pré-visualização para o ficheiro anterior e o seguinte da pasta ou dos resultados da pesquisa, com o contador «2 de 5» | Concluído |

## Factos verificados que os planos seguintes devem respeitar
```

Em `docs/superpowers/specs/2026-10-03-spacework-design.md`, trocar:

```markdown
| Rota | Conteúdo |
|---|---|
| `/login`, `/registo` | Formulários de email e senha (o registo pede confirmação da senha). No registo por aprovação, depois de enviar, o ecrã diz que a conta aguarda a aprovação do administrador (sem entrar). |
| `/` Meu espaço | Barra lateral: Meu espaço, Lixeira, Conta, Admin (só master; com o número de contas por aprovar, se houver), Sair, e barra de uso. A caixa de pesquisa fica na barra lateral, em todas as páginas (Enter leva a `/pesquisa?q=`, com os resultados e o caminho de cada um). Cabeçalho com caminho da pasta (*breadcrumb*), o seletor «Lista \| Mosaico» (guardado no browser), "Nova pasta" e "Carregar". Lista de pastas e ficheiros (ou, no mosaico, quadrados com a imagem das fotos até 2 MB e o ícone e a extensão nos outros ficheiros) com menu por item: pré-visualizar, descarregar, renomear, mover, partilhar, excluir. Upload por arrastar e largar e por seleção, com até 3 envios em paralelo e progresso por ficheiro (`XMLHttpRequest`). "Mover" abre um diálogo com a árvore de pastas. |
| `/lixeira` | Ficheiros excluídos: Restaurar, Eliminar definitivamente, Esvaziar lixeira. |
| `/conta` | Alterar senha. |
| `/admin` | Tabela de utilizadores (email, usado/quota, estado, data de criação); editar quota, suspender/reativar, apagar. As contas por aprovar vêm primeiro, com o estado «Aguarda aprovação», e só têm **Aprovar** e **Rejeitar**. |
```

por:

```markdown
| Rota | Conteúdo |
|---|---|
| `/login`, `/registo` | Formulários de email e senha (o registo pede confirmação da senha). No registo por aprovação, depois de enviar, o ecrã diz que a conta aguarda a aprovação do administrador (sem entrar). |
| `/` Meu espaço | Barra lateral: Meu espaço, Lixeira, Conta, Admin (só master; com o número de contas por aprovar, se houver), Sair, e barra de uso. A caixa de pesquisa fica na barra lateral, em todas as páginas (Enter leva a `/pesquisa?q=`, com os resultados e o caminho de cada um). Cabeçalho com caminho da pasta (*breadcrumb*), o seletor «Lista \| Mosaico» (guardado no browser), "Nova pasta" e "Carregar". Lista de pastas e ficheiros (ou, no mosaico, quadrados com a imagem das fotos até 2 MB e o ícone e a extensão nos outros ficheiros) com menu por item: pré-visualizar, descarregar, renomear, mover, partilhar, excluir. A pré-visualização tem setas (e as teclas ← e →) para o ficheiro anterior e o seguinte dos que se pré-visualizam na pasta (ou nos resultados da pesquisa), com um contador («2 de 5»). Upload por arrastar e largar e por seleção, com até 3 envios em paralelo e progresso por ficheiro (`XMLHttpRequest`). "Mover" abre um diálogo com a árvore de pastas. |
| `/lixeira` | Ficheiros excluídos: Restaurar, Eliminar definitivamente, Esvaziar lixeira. |
| `/conta` | Alterar senha. |
| `/admin` | Tabela de utilizadores (email, usado/quota, estado, data de criação); editar quota, suspender/reativar, apagar. As contas por aprovar vêm primeiro, com o estado «Aguarda aprovação», e só têm **Aprovar** e **Rejeitar**. |
```

- [ ] **Step 3: Verificação manual**

Os testes cobrem a lógica; falta ver a disposição num browser real, numa base local limpa, com um utilizador **fictício** (`*@example.test`), uma senha inventada e ficheiros inventados:

1. Apagar `.wrangler`, aplicar as migrações (`npm run db:migrate:local`), criar o master (`npm run seed:master -- --local`, com `MASTER_EMAIL` e `MASTER_PASSWORD` inventados no ambiente) e `npm run dev`.
2. Carregar três imagens de formatos diferentes (uma larga, uma alta, uma quadrada).
3. Abrir a do meio: as duas setas aparecem dos lados da imagem, e por baixo «2 de 3». A seta da frente avança; na última imagem a da frente fica esbatida e a de trás continua ativa.
4. Num ecrã de 375 px: as setas ficam sobre os bordos da imagem, o contador e os botões «Descarregar» e «Fechar» por baixo, e a página não rola na horizontal.
5. Apagar o `.wrangler` e os cookies no fim.

- [ ] **Step 4: Verificação final e commit**

Run: `npx vitest run`
Expected: `Test Files  37 passed (37)`, `Tests  346 passed (346)`.

Run: `npx vitest run -c vitest.web.config.ts`
Expected: `Test Files  44 passed (44)`, `Tests  355 passed (355)`.

Run: `npm run typecheck`
Expected: o `tsc` não imprime nada (só aparecem as linhas `> typecheck` e `> tsc -b` do npm).

Run: `npm run build`
Expected: `✓ built in ...` duas vezes (Worker e cliente).

Run: `npx playwright test`
Expected: `25 passed` (a duração varia).

Commit:

```bash
git add e2e README.md docs
git commit -m "Documenta a navegação na pré-visualização e acrescenta o teste de ponta a ponta" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Auto-revisão do plano contra a especificação

| Requisito | Onde |
|---|---|
| Spec §8: a pré-visualização tem setas (e ← →) para o ficheiro anterior e o seguinte, com um contador | Tasks 1, 2 e 3 |
| Os vizinhos são os ficheiros que se pré-visualizam da pasta, e dos resultados da pesquisa | Task 2 |
| Acessibilidade: setas com nome, `aria-disabled` nos extremos, contador numa região viva, foco ao fechar | Tasks 1, 2 e 3 |
| As setas e as teclas num browser real, com a imagem a carregar-se | Task 3 |

**Fora deste plano:** deslizar o dedo para mudar de imagem no telemóvel; dar a volta no fim da lista; as teclas Home e End; pré-carregar a imagem seguinte (a API responde com `no-store`, por isso cada imagem é uma descarga inteira de qualquer modo); passar a ver os ficheiros partilhados desta forma.

**Totais de testes (medidos na execução deste plano numa pasta limpa):** Worker: Test Files 37 passed (37); Tests 346 passed (346). Interface: Test Files 44 passed (44); Tests 355 passed (355). Ponta a ponta: 25 testes do Playwright.

## Notas da execução

- **Decisões que a especificação deixa em aberto:** os PDF entram na navegação (as setas do **ecrã** funcionam sempre; as teclas calam-se dentro do leitor de PDF, que as usa para mudar de página); as setas **não dão a volta**; `aria-disabled` em vez de `disabled`; **um só diálogo por página** (a página conhece a lista) em vez de um por linha; só há navegação com **pelo menos dois** ficheiros que se pré-visualizam.
- **Um defeito apanhado pelos testes existentes:** a primeira versão devolvia sempre o foco ao nome do ficheiro à vista, e o teste de ponta a ponta da Task 3 do plano anterior (`preview.spec.ts`, «o Esc devolve o foco ao menu») falhou: quem abre a pré-visualização pelo menu «⋮» espera o foco de volta no «⋮». A regra passou a ser: o foco volta a quem abriu o diálogo, e só se se navegou para **outro** ficheiro vai para o botão desse ficheiro.
- **Verificação manual:** feita durante a escrita deste plano, num browser real com um utilizador e imagens fictícias: as duas setas aparecem dos lados da imagem e o contador por baixo («2 de 3»); a seta da frente avança e, na última imagem, fica esbatida; a 375 px as setas ficam sobre os bordos da imagem e a página não rola na horizontal.
