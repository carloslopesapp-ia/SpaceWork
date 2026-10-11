import { act, cleanup, createEvent, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NETWORK_ERROR_MESSAGE } from "../api";
import { ME_KEY } from "../auth";
import { stubXhr } from "../test/fake-xhr";
import { apiError, json, ME, mockApi, noContent, SESSION } from "../test/mock-api";
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

  it("um refetch da sessão que falha em segundo plano não deita abaixo a aplicação nem mostra o erro", async () => {
    let failing = false;
    mockApi({
      ...CONTENTS,
      "GET /api/auth/me": () => (failing ? apiError(500, "internal_error", "Erro interno do servidor.") : json({ user: ME })),
    });
    const { client } = renderApp("/");
    expect(await screen.findByRole("navigation", { name: "Principal" })).toBeInTheDocument();

    failing = true;
    await act(() => client.invalidateQueries({ queryKey: ME_KEY }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0))); // o React Query avisa os componentes no tick seguinte

    expect(client.getQueryState(ME_KEY)?.status).toBe("error"); // o refetch falhou mesmo
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  describe("guarda de largar ao nível da janela", () => {
    /** Dispara o evento em `document.body` (fora de qualquer zona de largar) e diz se o browser foi impedido de agir. */
    function prevented(type: "dragOver" | "drop", types: string[]): boolean {
      const event = createEvent[type](document.body, { dataTransfer: { types } });
      fireEvent(document.body, event);
      return event.defaultPrevented;
    }

    it("um ficheiro largado fora da zona não abre no browser; o que não é ficheiro não é tocado", async () => {
      mockApi({ ...SESSION, ...CONTENTS });
      renderApp("/");
      await screen.findByRole("navigation", { name: "Principal" });

      expect(prevented("dragOver", ["Files"])).toBe(true);
      expect(prevented("drop", ["Files"])).toBe(true);
      expect(prevented("dragOver", ["text/plain"])).toBe(false);
      expect(prevented("drop", ["text/plain"])).toBe(false);
    });

    it("sem sessão (no login) não há guarda, e ao sair da área autenticada deixa de haver", async () => {
      mockApi({ ...SESSION, ...CONTENTS });
      renderApp("/");
      await screen.findByRole("navigation", { name: "Principal" });
      expect(prevented("drop", ["Files"])).toBe(true);

      cleanup(); // desmonta a aplicação
      expect(prevented("drop", ["Files"])).toBe(false);

      mockApi({ "GET /api/auth/me": () => apiError(401, "unauthorized", "Sessão inválida ou expirada.") });
      renderApp("/");
      await screen.findByRole("heading", { name: "Entrar" });
      expect(prevented("drop", ["Files"])).toBe(false);
    });
  });

  it("se o `me` passa a outro utilizador no mesmo separador, a fila de envios é cancelada", async () => {
    const Xhr = stubXhr();
    mockApi({ ...SESSION, ...CONTENTS });
    const user = userEvent.setup();
    const { client } = renderApp("/");
    await screen.findByRole("heading", { name: "Meu espaço" });
    await user.upload(screen.getByLabelText("Escolher ficheiros"), new File(["abc"], "nota.txt"));
    expect(Xhr.instances).toHaveLength(1);
    const abort = vi.spyOn(Xhr.instances[0], "abort");
    expect(await screen.findByRole("progressbar", { name: "Envio de nota.txt" })).toBeInTheDocument();

    act(() => client.setQueryData(ME_KEY, { ...ME, id: "u2", email: "outra@example.com" }));

    expect(await screen.findByText("outra@example.com")).toBeInTheDocument(); // o React Query avisa os componentes no tick seguinte
    await waitFor(() => expect(abort).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("progressbar", { name: "Envio de nota.txt" })).not.toBeInTheDocument());
  });
});

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

describe("AppLayout: o conteúdo da página", () => {
  it("aceita o foco por programa (é para onde vai o foco quando o botão que abriu um diálogo desaparece)", async () => {
    mockApi({ ...CONTENTS, "GET /api/auth/me": () => json({ user: ME }) });
    renderApp("/");
    await screen.findByRole("navigation", { name: "Principal" });
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
  });
});

describe("AppLayout: enquanto a sessão carrega", () => {
  it("o aviso é uma região de estado, para o leitor de ecrã o anunciar", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mockApi({
      ...CONTENTS,
      "GET /api/auth/me": async () => {
        await gate;
        return json({ user: ME });
      },
    });
    renderApp("/");

    expect(await screen.findByRole("status")).toHaveTextContent("A carregar…");

    release();
    await screen.findByRole("navigation", { name: "Principal" });
  });
});

describe("AppLayout: contas por aprovar", () => {
  const ADMIN_ME = { ...ME, id: "adm", email: "admin@example.com", role: "admin" as const };
  const adminLink = async (pendingApprovals?: number) => {
    mockApi({ ...CONTENTS, "GET /api/config": SESSION["GET /api/config"], "GET /api/auth/me": () => json({ user: { ...ADMIN_ME, pendingApprovals } }) });
    renderApp("/");
    await screen.findByRole("navigation", { name: "Principal" });
    return within(screen.getByRole("navigation", { name: "Principal" })).getByRole("link", { name: /^Admin/ });
  };

  it("«Admin» diz quantas contas aguardam aprovação, no plural e no singular, e mostra o número", async () => {
    const plural = await adminLink(2);
    expect(plural).toHaveAccessibleName("Admin, 2 contas por aprovar");
    expect(plural).toHaveTextContent("Admin2");
    cleanup();
    const singular = await adminLink(1);
    expect(singular).toHaveAccessibleName("Admin, 1 conta por aprovar");
    expect(singular).toHaveTextContent("Admin1");
  });

  it("sem contas por aprovar (zero, ou o campo em falta) «Admin» fica como estava, sem selo nem descrição", async () => {
    for (const count of [0, undefined]) {
      const link = await adminLink(count);
      expect(link).toHaveAccessibleName("Admin");
      expect(link).toHaveTextContent(/^Admin$/);
      expect(link).not.toHaveAttribute("aria-label");
      cleanup();
    }
  });
});
