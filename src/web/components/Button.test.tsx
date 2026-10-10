import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";

describe("Button: o anel de foco", () => {
  it("o botão de perigo tem o anel vermelho (e só esse) e os outros o índigo", () => {
    render(
      <>
        <Button variant="danger">Excluir</Button>
        <Button>Guardar</Button>
        <Button variant="secondary">Cancelar</Button>
      </>,
    );

    const danger = screen.getByRole("button", { name: "Excluir" }).className;
    expect(danger).toContain("focus-visible:ring-red-300");
    expect(danger).not.toContain("ring-indigo");
    for (const name of ["Guardar", "Cancelar"]) {
      const className = screen.getByRole("button", { name }).className;
      expect(className, name).toContain("focus-visible:ring-indigo-300");
      expect(className, name).not.toContain("ring-red");
    }
  });
});
