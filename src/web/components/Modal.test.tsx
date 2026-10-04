import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Modal } from "./Modal";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      {open && (
        <Modal title="Um título" onClose={() => setOpen(false)}>
          <button>Primeiro</button>
          <button>Último</button>
        </Modal>
      )}
    </>
  );
}

async function openModal() {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Abrir" }));
  return user;
}

describe("Modal", () => {
  it("abre um diálogo com o título como nome e o foco no primeiro botão", async () => {
    await openModal();
    expect(screen.getByRole("dialog", { name: "Um título" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Primeiro" })).toHaveFocus();
  });

  it("Esc fecha e devolve o foco a quem o abriu", async () => {
    const user = await openModal();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir" })).toHaveFocus();
  });

  it("o foco dá a volta: Tab no último vai ao primeiro e Shift+Tab no primeiro vai ao último", async () => {
    const user = await openModal();
    await user.tab();
    expect(screen.getByRole("button", { name: "Último" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Primeiro" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Último" })).toHaveFocus();
  });

  it("um clique no fundo fecha, um clique dentro não", async () => {
    const user = await openModal();
    await user.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByTestId("modal-backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
