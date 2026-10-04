import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { NameDialog } from "./NameDialog";

function setup(props: Partial<Parameters<typeof NameDialog>[0]> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <NameDialog
      title="Renomear pasta"
      label="Nome da pasta"
      confirmLabel="Renomear"
      pending={false}
      error={null}
      onSubmit={onSubmit}
      onClose={onClose}
      {...props}
    />,
  );
  return { onSubmit, onClose, user: userEvent.setup() };
}

describe("NameDialog", () => {
  it("abre com o nome atual todo selecionado, pronto a ser substituído", () => {
    setup({ initialValue: "Fotos" });
    const input = screen.getByLabelText<HTMLInputElement>("Nome da pasta");
    expect(input).toHaveFocus();
    expect(input.value).toBe("Fotos");
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
  });

  it("entrega o nome normalizado (sem espaços nas pontas, em NFC)", async () => {
    const { onSubmit, user } = setup({ confirmLabel: "Criar" });
    await user.type(screen.getByLabelText("Nome da pasta"), "  Férias ");
    await user.click(screen.getByRole("button", { name: "Criar" }));
    expect(onSubmit).toHaveBeenCalledWith("Férias");
  });

  it("recusa um nome inválido sem chamar o servidor, com a mesma mensagem da API", async () => {
    const { onSubmit, user } = setup();
    await user.type(screen.getByLabelText("Nome da pasta"), "a/b");
    await user.click(screen.getByRole("button", { name: "Renomear" }));
    expect(screen.getByRole("alert")).toHaveTextContent("O nome não pode conter a barra (/).");
    await user.clear(screen.getByLabelText("Nome da pasta"));
    await user.click(screen.getByRole("button", { name: "Renomear" }));
    expect(screen.getByRole("alert")).toHaveTextContent("O nome não pode estar vazio.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("mostra o erro do servidor e fica ocupado enquanto grava", () => {
    setup({ error: "Já existe uma pasta com esse nome neste local.", pending: true });
    expect(screen.getByRole("alert")).toHaveTextContent("Já existe uma pasta com esse nome neste local.");
    expect(screen.getByRole("button", { name: "A guardar…" })).toBeDisabled();
  });

  it("Cancelar fecha sem guardar", async () => {
    const { onSubmit, onClose, user } = setup();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Esc fecha e devolve o foco ao botão que o abriu (regressão: autoFocus)", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Abrir diálogo</button>
          {open && (
            <NameDialog
              title="Renomear pasta"
              label="Nome da pasta"
              confirmLabel="Renomear"
              pending={false}
              error={null}
              onSubmit={() => {}}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Abrir diálogo" });
    await user.click(opener);
    await user.keyboard("{Escape}");
    expect(opener).toHaveFocus();
  });
});
