import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { FileItem, FolderItem } from "../../shared/types";
import { THUMBNAIL_MAX_BYTES } from "../thumbnails";
import { json, mockApi } from "../test/mock-api";
import { queryWrapper, testQueryClient } from "../test/render";
import { FileTile, FolderTile } from "./Tiles";

const file = (name: string, size: number): FileItem => ({ id: "a1", name, folderId: null, size, mime: "application/octet-stream", createdAt: 1 });
const FOTOS: FolderItem = { id: "f1", name: "Fotos", parentId: null, createdAt: 1 };

function renderTile(tile: React.ReactElement) {
  const Wrapper = queryWrapper(testQueryClient());
  return render(
    <Wrapper>
      <MemoryRouter>
        <ul>{tile}</ul>
      </MemoryRouter>
    </Wrapper>,
  );
}

describe("FileTile", () => {
  it("uma imagem pequena mostra a própria imagem, carregada só quando aparece no ecrã", () => {
    const { container } = renderTile(<FileTile file={file("foto.png", 1000)} />);
    const image = container.querySelector("img")!;
    expect(image).toHaveAttribute("src", "/api/files/a1/preview");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("alt", ""); // o nome já está por baixo: a imagem é decorativa
    expect(screen.getByRole("button", { name: "Pré-visualizar foto.png" })).toBeInTheDocument();
    expect(screen.getByText("foto.png")).toBeInTheDocument();
    expect(screen.getByText("1000 B")).toBeInTheDocument();
  });

  it("uma imagem acima do limite mostra o ícone e a extensão, sem pedir a imagem", () => {
    const { container } = renderTile(<FileTile file={file("foto.png", THUMBNAIL_MAX_BYTES + 1)} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("PNG")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pré-visualizar foto.png" })).toBeInTheDocument(); // continua a abrir a pré-visualização
  });

  it("se a imagem não carregar, passa ao ícone", () => {
    const { container } = renderTile(<FileTile file={file("foto.png", 1000)} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("PNG")).toBeInTheDocument();
  });

  it("um ficheiro que não se pré-visualiza mostra o ícone e a extensão, e não é um botão", () => {
    const { container } = renderTile(<FileTile file={file("nota.txt", 10)} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("TXT")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pré-visualizar/ })).not.toBeInTheDocument();
  });

  it("um PDF mostra o ícone e abre a pré-visualização ao clicar no quadrado", async () => {
    renderTile(<FileTile file={file("relatório.pdf", 1536)} />);
    expect(screen.getByText("PDF")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Pré-visualizar relatório.pdf" }));

    expect(await screen.findByRole("dialog", { name: "relatório.pdf" })).toBeInTheDocument();
  });

  it("tem o menu «⋮» do ficheiro, com a ação de pré-visualizar quando há pré-visualização", async () => {
    mockApi({ "GET /api/folders/tree": () => json({ folders: [] }) });
    renderTile(<FileTile file={file("relatório.pdf", 1536)} />);
    await userEvent.click(screen.getByRole("button", { name: "Ações para o ficheiro relatório.pdf" }));
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Pré-visualizar" })).toBeInTheDocument();
  });
});

describe("FolderTile", () => {
  it("é uma ligação para a pasta, com o nome, o ícone e o menu «⋮»", () => {
    renderTile(<FolderTile folder={FOTOS} />);
    expect(screen.getByRole("link", { name: "Abrir a pasta Fotos" })).toHaveAttribute("href", "/pasta/f1");
    expect(screen.getByText("Fotos")).toBeInTheDocument();
    expect(screen.getByText("Pasta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ações para a pasta Fotos" })).toBeInTheDocument();
  });
});
