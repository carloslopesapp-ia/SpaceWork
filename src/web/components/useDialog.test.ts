import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDialog } from "./useDialog";

describe("useDialog", () => {
  it("começa sem diálogo, abre um e fecha-o repondo todas as mutações", () => {
    const first = { reset: vi.fn() };
    const second = { reset: vi.fn() };
    const { result } = renderHook(() => useDialog<"rename" | "delete">(first, second));
    expect(result.current.dialog).toBeNull();

    act(() => result.current.open("rename"));
    expect(result.current.dialog).toBe("rename");
    expect(first.reset).not.toHaveBeenCalled();

    act(() => result.current.close());
    expect(result.current.dialog).toBeNull();
    expect(first.reset).toHaveBeenCalledTimes(1);
    expect(second.reset).toHaveBeenCalledTimes(1);
  });

  it("abrir outro diálogo troca o aberto (nunca há dois)", () => {
    const { result } = renderHook(() => useDialog<"rename" | "delete">());
    act(() => result.current.open("rename"));
    act(() => result.current.open("delete"));
    expect(result.current.dialog).toBe("delete");
  });
});
