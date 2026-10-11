import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ViewToggle } from "./ViewToggle";

describe("ViewToggle", () => {
  it("é um grupo com «Lista» e «Mosaico», e a vista atual está premida", () => {
    render(<ViewToggle value="list" onChange={() => undefined} />);
    const group = screen.getByRole("group", { name: "Modo de apresentação" });
    expect(within(group).getByRole("button", { name: "Lista" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Mosaico" })).toHaveAttribute("aria-pressed", "false");
  });

  it("com o mosaico escolhido, é «Mosaico» que está premido", () => {
    render(<ViewToggle value="tiles" onChange={() => undefined} />);
    expect(screen.getByRole("button", { name: "Mosaico" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Lista" })).toHaveAttribute("aria-pressed", "false");
  });

  it("escolher uma vista diz qual foi", async () => {
    const onChange = vi.fn();
    render(<ViewToggle value="list" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Mosaico" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("tiles");
  });
});
