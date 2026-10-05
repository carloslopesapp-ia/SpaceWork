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
