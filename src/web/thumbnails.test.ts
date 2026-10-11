import { describe, expect, it } from "vitest";
import type { FileItem } from "../shared/types";
import { extensionLabel, showsThumbnail, THUMBNAIL_MAX_BYTES } from "./thumbnails";

const file = (name: string, size: number): FileItem => ({ id: "f1", name, folderId: null, size, mime: "application/octet-stream", createdAt: 1 });

describe("showsThumbnail", () => {
  it("uma imagem de um tipo que se pré-visualiza, até ao limite, tem miniatura (o limite incluído)", () => {
    expect(showsThumbnail(file("foto.png", 1000))).toBe(true);
    expect(showsThumbnail(file("foto.JPG", 1000))).toBe(true);
    expect(showsThumbnail(file("foto.webp", THUMBNAIL_MAX_BYTES))).toBe(true);
  });

  it("uma imagem acima do limite não tem (cada miniatura é uma descarga inteira, sem cache)", () => {
    expect(showsThumbnail(file("foto.png", THUMBNAIL_MAX_BYTES + 1))).toBe(false);
  });

  it("o que não é uma imagem pré-visualizável não tem miniatura (um PDF, um SVG, texto)", () => {
    expect(showsThumbnail(file("relatório.pdf", 1000))).toBe(false);
    expect(showsThumbnail(file("desenho.svg", 1000))).toBe(false);
    expect(showsThumbnail(file("nota.txt", 1000))).toBe(false);
  });

  it("o limite é de 2 MiB", () => {
    expect(THUMBNAIL_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe("extensionLabel", () => {
  it("é a extensão em maiúsculas", () => {
    expect(extensionLabel("relatório.pdf")).toBe("PDF");
    expect(extensionLabel("arquivo.tar.gz")).toBe("GZ");
  });

  it("vazia sem extensão, num ficheiro escondido ou com o ponto no fim", () => {
    expect(extensionLabel("semextensao")).toBe("");
    expect(extensionLabel(".escondido")).toBe("");
    expect(extensionLabel("termina.")).toBe("");
  });

  it("corta as extensões compridas aos 5 caracteres", () => {
    expect(extensionLabel("texto.markdown")).toBe("MARKD");
  });
});
