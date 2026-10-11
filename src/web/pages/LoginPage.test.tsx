import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { apiError, mockApi } from "../test/mock-api";
import { renderApp } from "../test/render";

describe("LoginPage", () => {
  it("uma conta por aprovar mostra a mensagem do servidor e fica no formulário", async () => {
    mockApi({
      "GET /api/auth/me": () => apiError(401, "unauthorized", "Sessão inválida ou expirada."),
      "POST /api/auth/login": () => apiError(403, "account_pending", "A sua conta aguarda a aprovação do administrador."),
    });
    const user = userEvent.setup();
    renderApp("/login");

    await user.type(await screen.findByLabelText("Email"), "ana@example.com");
    await user.type(screen.getByLabelText("Senha"), "senha-segura-123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("A sua conta aguarda a aprovação do administrador.");
    expect(screen.getByLabelText("Email")).toHaveValue("ana@example.com");
  });
});
