import { fireEvent, render, screen, within } from "@testing-library/react";
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

describe("PreviewDialog: setas para o ficheiro anterior e o seguinte", () => {
  const navigation = (index: number, total: number) => ({ index, total, onPrevious: vi.fn(), onNext: vi.fn() });

  it("sem navegação (um só ficheiro, ou fora de uma lista) não há setas nem contador", () => {
    render(<PreviewDialog file={file("foto.png")} onClose={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Ficheiro anterior" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ficheiro seguinte" })).not.toBeInTheDocument();
    expect(screen.queryByText(/ de \d+$/)).not.toBeInTheDocument();
  });

  it("mostra as duas setas e o sítio onde está («2 de 3»), e cada seta chama o seu ficheiro", async () => {
    const nav = navigation(1, 3);
    render(<PreviewDialog file={file("b.png")} onClose={() => undefined} navigation={nav} />);
    const dialog = screen.getByRole("dialog", { name: "b.png" });
    expect(within(dialog).getByText("2 de 3")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Ficheiro seguinte" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Ficheiro anterior" }));

    expect(nav.onNext).toHaveBeenCalledTimes(1);
    expect(nav.onPrevious).toHaveBeenCalledTimes(1);
  });

  it("no primeiro ficheiro a seta de trás não faz nada, e no último a da frente também (continuam focáveis: o foco não se perde)", async () => {
    const first = navigation(0, 3);
    const { unmount } = render(<PreviewDialog file={file("a.png")} onClose={() => undefined} navigation={first} />);
    const back = screen.getByRole("button", { name: "Ficheiro anterior" });
    expect(back).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(back);
    expect(first.onPrevious).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Ficheiro seguinte" })).toHaveAttribute("aria-disabled", "false");
    unmount();

    const last = navigation(2, 3);
    render(<PreviewDialog file={file("c.png")} onClose={() => undefined} navigation={last} />);
    const forward = screen.getByRole("button", { name: "Ficheiro seguinte" });
    expect(forward).toHaveAttribute("aria-disabled", "true");
    forward.focus();
    await userEvent.click(forward);
    expect(last.onNext).not.toHaveBeenCalled();
    expect(forward).toHaveFocus();
  });

  it("as teclas ← e → fazem o mesmo, e não fazem nada nos extremos nem com Ctrl, Alt ou Meta", () => {
    const middle = navigation(1, 3);
    render(<PreviewDialog file={file("b.png")} onClose={() => undefined} navigation={middle} />);

    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    fireEvent.keyDown(document, { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(document, { key: "ArrowLeft", altKey: true });
    fireEvent.keyDown(document, { key: "ArrowLeft", metaKey: true });

    expect(middle.onNext).toHaveBeenCalledTimes(1);
    expect(middle.onPrevious).toHaveBeenCalledTimes(1);
  });

  it("nos extremos as teclas não chamam nada", () => {
    const first = navigation(0, 2);
    render(<PreviewDialog file={file("a.png")} onClose={() => undefined} navigation={first} />);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(first.onPrevious).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(first.onNext).toHaveBeenCalledTimes(1);
  });

  it("ao desaparecer o diálogo, as teclas deixam de fazer efeito", () => {
    const nav = navigation(1, 3);
    const { unmount } = render(<PreviewDialog file={file("b.png")} onClose={() => undefined} navigation={nav} />);
    unmount();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(nav.onNext).not.toHaveBeenCalled();
  });

  it("ao passar a outro ficheiro, uma imagem que falhou não deixa o aviso para a seguinte", () => {
    const nav = navigation(0, 2);
    const { rerender } = render(<PreviewDialog file={{ ...file("a.png"), id: "a1" }} onClose={() => undefined} navigation={nav} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(<PreviewDialog file={{ ...file("b.png"), id: "b2" }} onClose={() => undefined} navigation={{ ...nav, index: 1 }} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "b.png" })).toHaveAttribute("src", "/api/files/b2/preview");
  });
});
