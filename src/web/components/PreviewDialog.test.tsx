import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FileItem } from "../../shared/types";
import { PreviewDialog } from "./PreviewDialog";

const file = (name: string): FileItem => ({ id: "a 1", name, folderId: null, size: 10, mime: "x/y", createdAt: 0 });

describe("PreviewDialog", () => {
  it("mostra uma imagem com o nome como texto alternativo", () => {
    render(<PreviewDialog file={file("foto.PNG")} onClose={() => undefined} />);
    expect(screen.getByRole("dialog", { name: "foto.PNG" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "foto.PNG" })).toHaveAttribute("src", "/api/files/a%201/preview");
  });

  it("mostra um PDF numa moldura", () => {
    render(<PreviewDialog file={file("relatório.pdf")} onClose={() => undefined} />);
    expect(screen.getByTitle("Pré-visualização de relatório.pdf")).toHaveAttribute("src", "/api/files/a%201/preview");
  });

  it("oferece sempre Descarregar e Fechar", async () => {
    const onClose = vi.fn();
    render(<PreviewDialog file={file("foto.jpg")} onClose={onClose} />);
    expect(screen.getByRole("link", { name: "Descarregar" })).toHaveAttribute("href", "/api/files/a%201/download");
    await userEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("se a imagem não carregar, diz isso em vez de mostrar uma imagem partida", () => {
    render(<PreviewDialog file={file("foto.png")} onClose={() => undefined} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar a pré-visualização.");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("um tipo sem pré-visualização (nunca deveria chegar aqui) dá um aviso", () => {
    render(<PreviewDialog file={file("notas.txt")} onClose={() => undefined} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Este tipo de ficheiro não tem pré-visualização.");
  });
});
