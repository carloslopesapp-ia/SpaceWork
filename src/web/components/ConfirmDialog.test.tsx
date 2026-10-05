import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

function setup(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <ConfirmDialog
      title="Excluir pasta"
      message="Excluir a pasta «Fotos»?"
      confirmLabel="Excluir"
      pending={false}
      error={null}
      onConfirm={onConfirm}
      onClose={onClose}
      {...props}
    />,
  );
  return { onConfirm, onClose, user: userEvent.setup() };
}

describe("ConfirmDialog", () => {
  it("mostra a pergunta e deixa o foco em Cancelar (a ação segura)", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Excluir pasta" })).toHaveTextContent("Excluir a pasta «Fotos»?");
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
  });

  it("Excluir confirma e Cancelar fecha", async () => {
    const { onConfirm, onClose, user } = setup();
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("mostra o erro do servidor e desativa o botão enquanto exclui", () => {
    setup({ error: "A pasta não está vazia. Mova ou exclua primeiro o conteúdo.", pending: true });
    expect(screen.getByRole("alert")).toHaveTextContent("A pasta não está vazia.");
    expect(screen.getByRole("button", { name: "A excluir…" })).toBeDisabled();
  });

  it("o texto do botão enquanto a ação decorre pode ser outro", () => {
    setup({ pending: true, pendingLabel: "A eliminar…" });
    expect(screen.getByRole("button", { name: "A eliminar…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "A excluir…" })).not.toBeInTheDocument();
  });

  it("enquanto a ação decorre, «Cancelar» está desativado (não a pode parar)", () => {
    setup({ pending: true });
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  });

  it("enquanto a ação decorre, Esc e o fundo não fecham o diálogo", () => {
    const { onClose } = setup({ pending: true });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.mouseDown(screen.getByTestId("modal-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("quando não decorre nada, Esc fecha o diálogo", () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
