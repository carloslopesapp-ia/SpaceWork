import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NETWORK_ERROR_MESSAGE } from "./api";
import { useMe } from "./auth";
import { apiError, json, ME, mockApi } from "./test/mock-api";
import { queryWrapper, testQueryClient } from "./test/render";

function renderMe() {
  return renderHook(() => useMe(), { wrapper: queryWrapper(testQueryClient()) });
}

describe("useMe", () => {
  it("devolve o utilizador da sessão", async () => {
    mockApi({ "GET /api/auth/me": () => json({ user: ME }) });
    const { result } = renderMe();
    await waitFor(() => expect(result.current.data).toEqual(ME));
  });

  it("devolve null quando não há sessão (401)", async () => {
    mockApi({ "GET /api/auth/me": () => apiError(401, "unauthorized", "Sessão inválida ou expirada.") });
    const { result } = renderMe();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("falha com a mensagem da API quando o servidor dá erro", async () => {
    mockApi({ "GET /api/auth/me": () => apiError(500, "internal_error", "Erro interno do servidor.") });
    const { result } = renderMe();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Erro interno do servidor.");
  });

  it("falha por falha de rede com a mensagem de ligação", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { result } = renderMe();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(NETWORK_ERROR_MESSAGE);
  });
});
