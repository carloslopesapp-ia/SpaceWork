import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FileItem } from "../shared/types";
import { usePreviewer } from "./previewer";

const item = (id: string, name: string): FileItem => ({ id, name, folderId: null, size: 10, mime: "x/y", createdAt: 0 });
const A = item("a", "a.png");
const TXT = item("t", "nota.txt");
const B = item("b", "b.pdf");
const C = item("c", "c.jpg");

/**
 * Uma lista de ficheiros: um botão «abrir …» (com `data-preview-id`, como o nome de uma linha ou o rosto de um quadrado) e um botão «menu …»
 * (que também abre a pré-visualização, como o «Pré-visualizar» do menu «⋮») para cada um, e o diálogo da lista.
 */
function List({ files }: { files: FileItem[] }) {
  const preview = usePreviewer(files);
  return (
    <>
      <ul>
        {files.map((file) => (
          <li key={file.id}>
            <button type="button" data-preview-id={file.id} onClick={() => preview.open(file)}>
              abrir {file.name}
            </button>
            <button type="button" onClick={() => preview.open(file)}>
              menu {file.name}
            </button>
          </li>
        ))}
      </ul>
      {preview.dialog}
    </>
  );
}

describe("usePreviewer", () => {
  it("abre o diálogo no ficheiro escolhido, e só conta os que se pré-visualizam", async () => {
    render(<List files={[A, TXT, B, C]} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "abrir b.pdf" }));

    expect(screen.getByRole("dialog", { name: "b.pdf" })).toBeInTheDocument();
    expect(screen.getByText("2 de 3")).toBeInTheDocument(); // a.png, b.pdf, c.jpg: o texto não conta
  });

  it("as setas passam ao anterior e ao seguinte, e saltam o que não se pré-visualiza", async () => {
    render(<List files={[A, TXT, B, C]} />);
    await userEvent.click(screen.getByRole("button", { name: "abrir a.png" }));

    await userEvent.click(screen.getByRole("button", { name: "Ficheiro seguinte" }));
    expect(screen.getByRole("dialog", { name: "b.pdf" })).toBeInTheDocument(); // saltou nota.txt
    await userEvent.click(screen.getByRole("button", { name: "Ficheiro seguinte" }));
    expect(screen.getByRole("dialog", { name: "c.jpg" })).toBeInTheDocument();
    expect(screen.getByText("3 de 3")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("dialog", { name: "b.pdf" })).toBeInTheDocument();
  });

  it("com um só ficheiro que se pré-visualiza não há setas", async () => {
    render(<List files={[A, TXT]} />);
    await userEvent.click(screen.getByRole("button", { name: "abrir a.png" }));
    expect(screen.getByRole("dialog", { name: "a.png" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ficheiro seguinte" })).not.toBeInTheDocument();
    expect(screen.queryByText(/ de \d+$/)).not.toBeInTheDocument();
  });

  it("se o ficheiro aberto sai da lista (excluído, renomeado para um tipo sem pré-visualização) o diálogo fecha", async () => {
    const { rerender } = render(<List files={[A, B, C]} />);
    await userEvent.click(screen.getByRole("button", { name: "abrir b.pdf" }));
    expect(screen.getByRole("dialog", { name: "b.pdf" })).toBeInTheDocument();

    rerender(<List files={[A, C]} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("se a lista muda à volta do ficheiro aberto, o diálogo continua nele (pelo id) e conta de novo", async () => {
    const { rerender } = render(<List files={[A, B, C]} />);
    await userEvent.click(screen.getByRole("button", { name: "abrir b.pdf" }));
    expect(screen.getByText("2 de 3")).toBeInTheDocument();

    rerender(<List files={[B, C]} />);

    expect(screen.getByRole("dialog", { name: "b.pdf" })).toBeInTheDocument();
    expect(screen.getByText("1 de 2")).toBeInTheDocument();
  });

  it("ao fechar, o foco vai para o botão do ficheiro que estava à vista (não para o que abriu o diálogo)", async () => {
    render(<List files={[A, B, C]} />);
    await userEvent.click(screen.getByRole("button", { name: "menu a.png" }));
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog", { name: "b.pdf" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "abrir b.pdf" })).toHaveFocus();
  });

  it("fechar sem ter navegado devolve o foco ao botão que abriu o diálogo (o menu «⋮», por exemplo)", async () => {
    render(<List files={[A, B, C]} />);
    await userEvent.click(screen.getByRole("button", { name: "menu c.jpg" }));

    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "menu c.jpg" })).toHaveFocus();
  });

  it("se se navegou e se voltou ao ficheiro que se abriu, o foco volta ao botão que abriu o diálogo", async () => {
    render(<List files={[A, B, C]} />);
    await userEvent.click(screen.getByRole("button", { name: "menu b.pdf" }));
    await userEvent.keyboard("{ArrowRight}{ArrowLeft}");
    expect(screen.getByRole("dialog", { name: "b.pdf" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "menu b.pdf" })).toHaveFocus();
  });
});
