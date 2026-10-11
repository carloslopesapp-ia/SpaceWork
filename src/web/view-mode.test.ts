import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readViewMode, useViewMode, VIEW_MODE_KEY } from "./view-mode";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("readViewMode", () => {
  it("a vista por defeito é a lista", () => {
    expect(readViewMode()).toBe("list");
  });

  it("lê a vista que ficou guardada", () => {
    localStorage.setItem(VIEW_MODE_KEY, "tiles");
    expect(readViewMode()).toBe("tiles");
  });

  it("um valor guardado que não é uma vista (editado à mão, de outra versão) vale a lista", () => {
    localStorage.setItem(VIEW_MODE_KEY, "grelha");
    expect(readViewMode()).toBe("list");
  });

  it("sem acesso ao armazenamento do browser (modo privado, dados bloqueados) vale a lista", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    expect(readViewMode()).toBe("list");
  });
});

describe("useViewMode", () => {
  it("começa pela vista guardada e guarda a escolha quando muda", () => {
    localStorage.setItem(VIEW_MODE_KEY, "tiles");
    const { result } = renderHook(() => useViewMode());
    expect(result.current[0]).toBe("tiles");

    act(() => result.current[1]("list"));

    expect(result.current[0]).toBe("list");
    expect(localStorage.getItem(VIEW_MODE_KEY)).toBe("list");
  });

  it("a escolha vale para a página mesmo que não se consiga guardar", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("cheio", "QuotaExceededError");
    });
    const { result } = renderHook(() => useViewMode());

    act(() => result.current[1]("tiles"));

    expect(result.current[0]).toBe("tiles");
  });
});
