import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Location } from "./Location";

function show(path: Parameters<typeof Location>[0]["path"], prefix?: string) {
  render(
    <MemoryRouter>
      <Location path={path} prefix={prefix} />
    </MemoryRouter>,
  );
  return screen.getByRole("link");
}

describe("Location", () => {
  it("na raiz diz «Em Meu espaço» e liga à raiz", () => {
    const link = show([]);
    expect(link).toHaveTextContent("Em Meu espaço");
    expect(link).toHaveAttribute("href", "/");
  });

  it("numa pasta mostra o caminho todo e liga à última pasta", () => {
    const link = show([
      { id: "d1", name: "Documentos" },
      { id: "c1", name: "Contas 2026" },
    ]);
    expect(link).toHaveTextContent("Em Meu espaço / Documentos / Contas 2026");
    expect(link).toHaveAttribute("href", "/pasta/c1");
  });

  it("o prefixo pode ser outro", () => {
    expect(show([{ id: "d1", name: "Documentos" }], "Estava em")).toHaveTextContent("Estava em Meu espaço / Documentos");
  });
});
