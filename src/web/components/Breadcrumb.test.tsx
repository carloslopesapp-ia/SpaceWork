import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Breadcrumb } from "./Breadcrumb";

const renderCrumbs = (items: Parameters<typeof Breadcrumb>[0]["items"]) =>
  render(
    <MemoryRouter>
      <Breadcrumb items={items} />
    </MemoryRouter>,
  );

describe("Breadcrumb", () => {
  it("na raiz só mostra «Meu espaço», como página atual e sem ligação", () => {
    renderCrumbs([]);
    expect(screen.getByText("Meu espaço")).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("numa pasta liga a raiz e as pastas acima; a pasta atual não é uma ligação", () => {
    renderCrumbs([
      { id: "a", name: "Fotos" },
      { id: "b", name: "Férias" },
    ]);
    expect(screen.getByRole("navigation", { name: "Caminho" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Meu espaço" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Fotos" })).toHaveAttribute("href", "/pasta/a");
    expect(screen.queryByRole("link", { name: "Férias" })).not.toBeInTheDocument();
    expect(screen.getByText("Férias")).toHaveAttribute("aria-current", "page");
  });
});
