import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { apiError, json, ME, mockApi } from "../test/mock-api";
import { renderApp } from "../test/render";

const PENDING = "Conta criada. Aguarde a aprovação do administrador.";
const EMPTY = { folder: null, breadcrumb: [], folders: [], files: [] };

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Email"), "ana@example.com");
  await user.type(screen.getByLabelText("Senha"), "senha-segura-123");
  await user.type(screen.getByLabelText("Confirmar senha"), "senha-segura-123");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));
}

describe("RegisterPage", () => {
  it("o registo aberto inicia sessão e leva a «Meu espaço»", async () => {
    let signedUp = false;
    mockApi({
      "GET /api/auth/me": () => (signedUp ? json({ user: ME }) : apiError(401, "unauthorized", "Sessão inválida ou expirada.")),
      "GET /api/config": () => json({ maxUploadBytes: 104_857_600 }),
      "GET /api/folders/:id/contents": () => json(EMPTY),
      "POST /api/auth/register": () => {
        signedUp = true;
        return json({ user: ME }, 201);
      },
    });
    renderApp("/registo");

    await fillAndSubmit(userEvent.setup());

    expect(await screen.findByRole("heading", { name: "Meu espaço" })).toBeInTheDocument();
  });

  it("o registo por aprovação não inicia sessão: mostra a mensagem do servidor, sem o formulário, e o caminho para entrar", async () => {
    mockApi({
      "GET /api/auth/me": () => apiError(401, "unauthorized", "Sessão inválida ou expirada."),
      "POST /api/auth/register": () => json({ pending: true, message: PENDING }, 202),
    });
    renderApp("/registo");

    await fillAndSubmit(userEvent.setup());

    expect(await screen.findByRole("status")).toHaveTextContent(PENDING);
    expect(screen.getByText(PENDING).parentElement).toHaveFocus(); // o foco passa para a mensagem (o formulário, onde estava, desapareceu)
    expect(screen.getByText("Quando o administrador a aprovar, entre com o seu email e a sua senha.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Principal" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Entrar" })).toHaveAttribute("href", "/login");
  });

  it("um erro do servidor (por exemplo, o email já registado) fica no formulário", async () => {
    mockApi({
      "GET /api/auth/me": () => apiError(401, "unauthorized", "Sessão inválida ou expirada."),
      "POST /api/auth/register": () => apiError(409, "email_taken", "Este email já está registado."),
    });
    renderApp("/registo");

    await fillAndSubmit(userEvent.setup());

    expect(await screen.findByRole("alert")).toHaveTextContent("Este email já está registado.");
    expect(screen.getByLabelText("Email")).toHaveValue("ana@example.com");
  });
});
