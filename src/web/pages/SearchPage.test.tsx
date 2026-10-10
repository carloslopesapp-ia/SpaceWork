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
    await screen.findByRole("navigation", { name: "Principal" }); // a sessão já carregou (o «A carregar…» do layout também é uma região de estado)
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("A pesquisar…"));

    release();

    await waitFor(() => expect(status).toHaveTextContent("1 resultado"));
    expect(screen.getByRole("status")).toBe(status); // o mesmo elemento: os leitores de ecrã anunciam a mudança
  });
});
