import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NETWORK_ERROR_MESSAGE } from "../api";
import { ME_KEY } from "../auth";
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

    expect(client.getQueryState(ME_KEY)?.status).toBe("error"); // o refetch falhou mesmo
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
