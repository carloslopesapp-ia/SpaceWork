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

function VanishingHarness() {
  const [shown, setShown] = useState(true);
  return (
    <Modal title="Um título" onClose={() => undefined}>
      {shown && <button onClick={() => setShown(false)}>Remover-me</button>}
    </Modal>
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

  it("se o elemento focado desaparece, o foco volta ao diálogo (o Esc e o Tab continuam a funcionar)", async () => {
    const user = userEvent.setup();
    render(<VanishingHarness />);
    await user.click(screen.getByRole("button", { name: "Remover-me" }));
    expect(screen.queryByRole("button", { name: "Remover-me" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Um título" })).toHaveFocus();
  });
});

function DescribedHarness() {
  return (
    <Modal title="Excluir" describedBy="pergunta" onClose={() => undefined}>
      <p id="pergunta">Isto não se pode desfazer.</p>
      <button>Excluir</button>
    </Modal>
  );
}

function StackedHarness() {
  const [second, setSecond] = useState(true);
  return (
    <Modal title="Primeiro" onClose={() => undefined}>
      {second && (
        <Modal title="Segundo" onClose={() => setSecond(false)}>
          <button onClick={() => setSecond(false)}>Fechar o segundo</button>
        </Modal>
      )}
    </Modal>
  );
}

/** O botão que abre o diálogo desaparece quando o diálogo age (como o «⋮» de uma linha que se move ou se exclui). */
function RemovedOpenerHarness() {
  const [open, setOpen] = useState(false);
  const [hasOpener, setHasOpener] = useState(true);
  return (
    <main tabIndex={-1} aria-label="Conteúdo">
      {hasOpener && <button onClick={() => setOpen(true)}>Abrir</button>}
      {open && (
        <Modal
          title="Apagar"
          onClose={() => setOpen(false)}
        >
          <button
            onClick={() => {
              setHasOpener(false);
              setOpen(false);
            }}
          >
            Apagar tudo
          </button>
        </Modal>
      )}
    </main>
  );
}

describe("Modal: descrição, rolagem e foco de reserva", () => {
  it("a descrição (`aria-describedby`) é o texto indicado", () => {
    render(<DescribedHarness />);
    expect(screen.getByRole("dialog", { name: "Excluir" })).toHaveAccessibleDescription("Isto não se pode desfazer.");
  });

  it("a página não rola enquanto há um diálogo aberto, e volta a rolar quando o último se fecha", async () => {
    const user = await openModal();
    expect(document.body.style.overflow).toBe("hidden");
    await user.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("");
  });

  it("com um diálogo aberto por cima de outro, a página só volta a rolar quando os dois se fecham", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<StackedHarness />);
    expect(document.body.style.overflow).toBe("hidden");

    await user.click(screen.getByRole("button", { name: "Fechar o segundo" }));
    expect(screen.queryByRole("dialog", { name: "Segundo" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden"); // o primeiro continua aberto

    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("se o botão que abriu o diálogo desapareceu, o foco vai para o conteúdo da página e não para o <body>", async () => {
    const user = userEvent.setup();
    render(<RemovedOpenerHarness />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await user.click(screen.getByRole("button", { name: "Apagar tudo" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("main", { name: "Conteúdo" })).toHaveFocus();
  });
});
