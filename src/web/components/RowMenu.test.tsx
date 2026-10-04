import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RowMenu } from "./RowMenu";

function setup() {
  const rename = vi.fn();
  const remove = vi.fn();
  render(
    <div>
      <p>Fora do menu</p>
      <RowMenu
        label="Ações para a pasta Fotos"
        actions={[
          { label: "Renomear", onSelect: rename },
          { label: "Descarregar", href: "/api/files/f1/download" },
          { label: "Excluir", danger: true, onSelect: remove },
        ]}
      />
    </div>,
  );
  const button = screen.getByRole("button", { name: "Ações para a pasta Fotos" });
  return { rename, remove, button, user: userEvent.setup() };
}

describe("RowMenu", () => {
  it("começa fechado e abre com o foco na primeira ação", async () => {
    const { button, user } = setup();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Renomear" })).toHaveFocus();
  });

  it("escolher uma ação chama-a, fecha o menu e deixa o foco no botão", async () => {
    const { rename, button, user } = setup();
    await user.click(button);
    await user.click(screen.getByRole("menuitem", { name: "Renomear" }));
    expect(rename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("uma ação com `href` é uma ligação", async () => {
    const { button, user } = setup();
    await user.click(button);
    expect(screen.getByRole("menuitem", { name: "Descarregar" })).toHaveAttribute("href", "/api/files/f1/download");
  });

  it("as setas dão a volta pelas ações", async () => {
    const { button, user } = setup();
    await user.click(button);
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Descarregar" })).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Renomear" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Excluir" })).toHaveFocus();
  });

  it("Esc fecha e devolve o foco ao botão", async () => {
    const { button, user } = setup();
    await user.click(button);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("um clique fora fecha o menu", async () => {
    const { user, button } = setup();
    await user.click(button);
    await user.click(screen.getByText("Fora do menu"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
