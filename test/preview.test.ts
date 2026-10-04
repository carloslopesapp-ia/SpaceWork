import { describe, expect, it } from "vitest";
import { previewContentType } from "../src/shared/preview";

describe("previewContentType", () => {
  it("devolve o tipo fixo das imagens e do PDF, sem distinguir maiúsculas", () => {
    expect(previewContentType("foto.png")).toBe("image/png");
    expect(previewContentType("FOTO.JPG")).toBe("image/jpeg");
    expect(previewContentType("a.jpeg")).toBe("image/jpeg");
    expect(previewContentType("a.gif")).toBe("image/gif");
    expect(previewContentType("a.webp")).toBe("image/webp");
    expect(previewContentType("relatório.final.pdf")).toBe("application/pdf");
  });

  it("recusa tudo o resto, incluindo nomes que parecem propriedades de objetos", () => {
    for (const name of ["a.svg", "b.html", "c.txt", "png", ".png", "d.png.exe", "e.constructor", "f.__proto__"]) {
      expect(previewContentType(name), name).toBeNull();
    }
  });
});
