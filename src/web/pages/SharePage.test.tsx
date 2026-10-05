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
