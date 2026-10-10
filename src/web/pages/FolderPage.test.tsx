import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FolderContents } from "../../shared/types";
import { CONFIG_KEY } from "../space";
import { stubXhr } from "../test/fake-xhr";
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
    expect(
      screen.getByText("Esta pasta está vazia. Arraste ficheiros para aqui ou use «Carregar ficheiros»."),
    ).toBeInTheDocument();
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

  it("um refetch falhado em segundo plano mantém a lista e o diálogo aberto, e avisa por cima da lista", async () => {
    let failing = false;
    mockApi({
      ...SESSION,
      "GET /api/folders/:id/contents": () => (failing ? apiError(500, "internal_error", "Erro interno do servidor.") : json(ROOT)),
    });
    const user = userEvent.setup();
    const { client } = renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Nova pasta" }));
    await user.type(screen.getByLabelText("Nome da pasta"), "Doc");

    failing = true;
    await act(() => client.invalidateQueries({ queryKey: ["folder"] }));

    expect(await screen.findByText("Erro interno do servidor.")).toBeInTheDocument();
    expect(client.getQueryState(["folder", "root"])?.status).toBe("error"); // o refetch falhou mesmo
    expect(screen.getByRole("link", { name: "Fotos" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Nova pasta" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nome da pasta")).toHaveValue("Doc");

    failing = false;
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(screen.queryByText("Erro interno do servidor.")).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Fotos" })).toBeInTheDocument();
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

describe("FolderPage: estado por pasta", () => {
  const serveFolders = () =>
    mockApi({
      ...SESSION,
      "GET /api/folders/:id/contents": ({ params }) => json(params.id === "root" ? ROOT : FOTOS),
    });
  /** Muda de pasta pela barra lateral, sem passar pelo diálogo (como o botão «Voltar» do browser). */
  const goToRoot = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(within(screen.getByRole("navigation", { name: "Principal" })).getByRole("link", { name: "Meu espaço" }));

  it("o diálogo «Nova pasta» aberto não passa para a pasta seguinte", async () => {
    serveFolders();
    const user = userEvent.setup();
    renderApp("/pasta/f1");
    await user.click(await screen.findByRole("button", { name: "Nova pasta" }));
    expect(screen.getByRole("dialog", { name: "Nova pasta" })).toBeInTheDocument();

    await goToRoot(user);

    expect(await screen.findByRole("link", { name: "Fotos" })).toBeInTheDocument(); // a raiz já carregou
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("o aviso das pastas largadas desaparece ao mudar de pasta", async () => {
    serveFolders();
    const user = userEvent.setup();
    renderApp("/pasta/f1");
    const heading = await screen.findByRole("heading", { name: "Fotos" });
    fireEvent.drop(heading, {
      dataTransfer: {
        types: ["Files"],
        items: [{ kind: "file", getAsFile: () => new File([""], "Pasta"), webkitGetAsEntry: () => ({ isDirectory: true }) }],
      },
    });
    expect(screen.getByText("As pastas não se enviam: arraste os ficheiros.")).toBeInTheDocument();

    await goToRoot(user);

    expect(await screen.findByRole("link", { name: "Fotos" })).toBeInTheDocument();
    expect(screen.queryByText("As pastas não se enviam: arraste os ficheiros.")).not.toBeInTheDocument();
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
    // Só existe na linha da lista (o `<span>` do painel de envios também diz «nota.txt»). A lista atualiza-se
    // quando o intervalo do refresh (500 ms) acaba, por isso a espera é maior do que a de por defeito.
    expect(await screen.findByRole("button", { name: "Ações para o ficheiro nota.txt" }, { timeout: 3000 })).toBeInTheDocument();
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
