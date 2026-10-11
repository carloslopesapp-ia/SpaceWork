import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AdminUser } from "../../shared/types";
import { apiError, json, mockApi, noContent } from "../test/mock-api";
import { queryWrapper, testQueryClient } from "../test/render";
import { PendingActions } from "./PendingActions";

const BOB: AdminUser = { id: "u2", email: "bob@example.com", role: "user", status: "active", approved: false, quotaBytes: 1_073_741_824, usedBytes: 0, createdAt: 1 };
const APPROVE = "Aprovar a conta bob@example.com";
const REJECT = "Rejeitar o pedido de bob@example.com";

function setup() {
  const user = userEvent.setup();
  const Wrapper = queryWrapper(testQueryClient());
  render(
    <Wrapper>
      <PendingActions user={BOB} />
    </Wrapper>,
  );
  return user;
}

describe("PendingActions", () => {
  it("«Aprovar» envia `approved: true` e não pede confirmação (não perde nada)", async () => {
    const server = mockApi({ "PATCH /api/admin/users/:id": () => json({ user: { ...BOB, approved: true } }) });
    const user = setup();

    await user.click(screen.getByRole("button", { name: APPROVE }));

    await waitFor(() => expect(server.callsTo("PATCH /api/admin/users/:id")).toHaveLength(1));
    expect(server.callsTo("PATCH /api/admin/users/:id")[0]).toMatchObject({ params: { id: "u2" }, body: { approved: true } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("«Rejeitar…» fica desativado enquanto «Aprovar» decorre (não se decide a mesma conta duas vezes)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mockApi({
      "PATCH /api/admin/users/:id": async () => {
        await gate;
        return json({ user: { ...BOB, approved: true } });
      },
    });
    const user = setup();

    await user.click(screen.getByRole("button", { name: APPROVE }));
    expect(screen.getByRole("button", { name: APPROVE })).toBeDisabled();
    expect(screen.getByRole("button", { name: REJECT })).toBeDisabled();

    release();
    await waitFor(() => expect(screen.getByRole("button", { name: REJECT })).toBeEnabled());
  });

  it("um erro ao aprovar aparece por baixo dos botões", async () => {
    mockApi({ "PATCH /api/admin/users/:id": () => apiError(409, "account_deleting", "Esta conta está a ser removida.") });
    const user = setup();

    await user.click(screen.getByRole("button", { name: APPROVE }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Esta conta está a ser removida.");
  });

  it("«Rejeitar…» pede confirmação, e «Cancelar» não apaga nada", async () => {
    const server = mockApi({ "DELETE /api/admin/users/:id": () => noContent() });
    const user = setup();

    await user.click(screen.getByRole("button", { name: REJECT }));
    const dialog = screen.getByRole("dialog", { name: "Rejeitar pedido" });
    expect(dialog).toHaveTextContent("bob@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.callsTo("DELETE /api/admin/users/:id")).toHaveLength(0);
  });

  it("confirmar a rejeição apaga a conta e fecha o diálogo", async () => {
    const server = mockApi({ "DELETE /api/admin/users/:id": () => noContent() });
    const user = setup();

    await user.click(screen.getByRole("button", { name: REJECT }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rejeitar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.callsTo("DELETE /api/admin/users/:id")[0]).toMatchObject({ params: { id: "u2" } });
  });

  it("um erro ao rejeitar fica no diálogo, que continua aberto", async () => {
    mockApi({ "DELETE /api/admin/users/:id": () => apiError(500, "internal_error", "Erro interno do servidor.") });
    const user = setup();

    await user.click(screen.getByRole("button", { name: REJECT }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rejeitar" }));

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("Erro interno do servidor.");
  });
});
