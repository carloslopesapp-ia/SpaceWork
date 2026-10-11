import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AdminUser } from "../../shared/types";
import { apiError, json, mockApi } from "../test/mock-api";
import { queryWrapper, testQueryClient } from "../test/render";
import { UserActions } from "./UserActions";

const ANA: AdminUser = { id: "u1", email: "ana@example.com", role: "user", status: "active", approved: true, quotaBytes: 1_073_741_824, usedBytes: 536_870_912, createdAt: 1 };
const MENU = "Ações para a conta ana@example.com";

function setup(user: AdminUser = ANA) {
  const user$ = userEvent.setup();
  const Wrapper = queryWrapper(testQueryClient());
  render(
    <Wrapper>
      <UserActions user={user} />
    </Wrapper>,
  );
  return user$;
}

async function choose(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(screen.getByRole("button", { name: MENU }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

const labels = () => screen.getAllByRole("menuitem").map((item) => item.textContent);

describe("UserActions: o menu", () => {
  it("uma conta ativa pode mudar de quota, ser suspensa e ser apagada", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: MENU }));
    expect(labels()).toEqual(["Alterar quota…", "Suspender…", "Apagar conta…"]);
  });

  it("uma conta suspensa pode ser reativada em vez de suspensa", async () => {
    const user = setup({ ...ANA, status: "suspended" });
    await user.click(screen.getByRole("button", { name: MENU }));
    expect(labels()).toEqual(["Alterar quota…", "Reativar", "Apagar conta…"]);
  });

  it("uma conta de administrador só muda de quota", async () => {
    const user = setup({ ...ANA, role: "admin" });
    await user.click(screen.getByRole("button", { name: MENU }));
    expect(labels()).toEqual(["Alterar quota…"]);
  });
});

describe("UserActions: quota", () => {
  it("mostra a quota atual em GB e o espaço usado, e envia a quota nova em bytes (vírgula ou ponto)", async () => {
    const server = mockApi({ "PATCH /api/admin/users/:id": () => json({ user: { ...ANA, quotaBytes: 2_684_354_560 } }) });
    const user = setup();
    await choose(user, "Alterar quota…");
    const dialog = screen.getByRole("dialog", { name: "Quota de ana@example.com" });
    expect(within(dialog).getByLabelText("Quota (GB)")).toHaveValue("1");
    expect(dialog).toHaveTextContent("Espaço usado: 512 MB.");

    await user.clear(within(dialog).getByLabelText("Quota (GB)"));
    await user.type(within(dialog).getByLabelText("Quota (GB)"), "2,5");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.callsTo("PATCH /api/admin/users/:id")[0]).toMatchObject({ params: { id: "u1" }, body: { quotaBytes: 2_684_354_560 } });
  });

  it("uma quota inválida nem chega ao servidor", async () => {
    const server = mockApi({ "PATCH /api/admin/users/:id": () => json({ user: ANA }) });
    const user = setup();
    await choose(user, "Alterar quota…");
    const field = screen.getByLabelText("Quota (GB)");
    for (const text of ["abc", "-1", "2000000"]) {
      await user.clear(field);
      await user.type(field, text);
      await user.click(screen.getByRole("button", { name: "Guardar" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Indique a quota em GB, um número de 0 a 1048576 (por exemplo 1,5).");
    }
    expect(server.callsTo("PATCH /api/admin/users/:id")).toHaveLength(0);
  });

  it("guardar sem editar o campo fecha o diálogo e não grava (o campo arredonda a quota, que pode não ser um valor exato em GB)", async () => {
    const server = mockApi({ "PATCH /api/admin/users/:id": () => json({ user: ANA }) });
    const user = setup({ ...ANA, quotaBytes: 1_000_000 });
    await choose(user, "Alterar quota…");
    const dialog = screen.getByRole("dialog", { name: "Quota de ana@example.com" });
    expect(within(dialog).getByLabelText("Quota (GB)")).toHaveValue("0");

    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.callsTo("PATCH /api/admin/users/:id")).toHaveLength(0);
  });

  it("um erro do servidor fica no diálogo, que continua aberto", async () => {
    mockApi({ "PATCH /api/admin/users/:id": () => apiError(409, "account_deleting", "Esta conta está a ser removida.") });
    const user = setup();
    await choose(user, "Alterar quota…");
    await user.clear(screen.getByLabelText("Quota (GB)"));
    await user.type(screen.getByLabelText("Quota (GB)"), "2");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Esta conta está a ser removida.");
    expect(screen.getByRole("dialog", { name: "Quota de ana@example.com" })).toBeInTheDocument();
  });

  it("enquanto guarda, o diálogo não se fecha (Esc e fundo ignorados, «Cancelar» desativado)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mockApi({
      "PATCH /api/admin/users/:id": async () => {
        await gate;
        return json({ user: ANA });
      },
    });
    const user = setup();
    await choose(user, "Alterar quota…");
    const dialog = screen.getByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Quota (GB)"));
    await user.type(within(dialog).getByLabelText("Quota (GB)"), "2");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));
    await within(dialog).findByRole("button", { name: "A guardar…" });

    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("modal-backdrop"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("UserActions: suspender e reativar", () => {
  it("suspender pede confirmação e envia o estado; «Cancelar» não envia nada", async () => {
    const server = mockApi({ "PATCH /api/admin/users/:id": () => json({ user: { ...ANA, status: "suspended" } }) });
    const user = setup();
    await choose(user, "Suspender…");
    const dialog = screen.getByRole("dialog", { name: "Suspender conta" });
    expect(dialog).toHaveTextContent("Suspender a conta de «ana@example.com»?");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(server.callsTo("PATCH /api/admin/users/:id")).toHaveLength(0);

    await choose(user, "Suspender…");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Suspender" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.callsTo("PATCH /api/admin/users/:id")[0].body).toEqual({ status: "suspended" });
  });

  it("reativar envia o estado logo, sem diálogo", async () => {
    const server = mockApi({ "PATCH /api/admin/users/:id": () => json({ user: ANA }) });
    const user = setup({ ...ANA, status: "suspended" });
    await choose(user, "Reativar");
    await waitFor(() => expect(server.callsTo("PATCH /api/admin/users/:id")).toHaveLength(1));
    expect(server.callsTo("PATCH /api/admin/users/:id")[0].body).toEqual({ status: "active" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("se reativar falha, o erro aparece por baixo do menu (e desaparece ao abrir outro diálogo)", async () => {
    mockApi({ "PATCH /api/admin/users/:id": () => apiError(409, "account_deleting", "Esta conta está a ser removida.") });
    const user = setup({ ...ANA, status: "suspended" });
    await choose(user, "Reativar");
    expect(await screen.findByRole("alert")).toHaveTextContent("Esta conta está a ser removida.");

    await choose(user, "Alterar quota…");

    expect(within(screen.getByRole("dialog")).queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("UserActions: apagar", () => {
  it("avisa que não se pode desfazer, apaga e fecha", async () => {
    const server = mockApi({ "DELETE /api/admin/users/:id": () => new Response(null, { status: 204 }) });
    const user = setup();
    await choose(user, "Apagar conta…");
    const dialog = screen.getByRole("dialog", { name: "Apagar conta" });
    expect(dialog).toHaveTextContent("Apagar a conta de «ana@example.com»?");
    expect(dialog).toHaveTextContent("não se pode desfazer");
    expect(dialog).toHaveTextContent("o email não pode ser registado outra vez");
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "Apagar conta" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.callsTo("DELETE /api/admin/users/:id")[0].params.id).toBe("u1");
  });

  it("um erro do servidor fica no diálogo", async () => {
    mockApi({ "DELETE /api/admin/users/:id": () => apiError(403, "admin_protected", "Uma conta de administrador não se pode suspender nem apagar.") });
    const user = setup();
    await choose(user, "Apagar conta…");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Apagar conta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Uma conta de administrador não se pode suspender nem apagar.");
    expect(screen.getByRole("dialog", { name: "Apagar conta" })).toBeInTheDocument();
  });
});
