import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Loading } from "./Loading";

describe("Loading", () => {
  it("é uma região de estado (o leitor de ecrã anuncia-a) e diz «A carregar…» por defeito", () => {
    render(<Loading />);
    expect(screen.getByRole("status")).toHaveTextContent("A carregar…");
  });

  it("aceita outro texto e classes extra", () => {
    render(<Loading className="p-8">A carregar pastas…</Loading>);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("A carregar pastas…");
    expect(status).toHaveClass("p-8", "text-slate-500");
  });
});
