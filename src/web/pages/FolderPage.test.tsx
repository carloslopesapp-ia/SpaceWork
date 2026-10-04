import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FolderContents } from "../../shared/types";
import { apiError, json, ME, mockApi, noContent, SESSION } from "../test/mock-api";
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
