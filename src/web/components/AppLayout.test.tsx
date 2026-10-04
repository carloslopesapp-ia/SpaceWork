import { act, cleanup, createEvent, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
