import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NETWORK_ERROR_MESSAGE } from "./api";
import { ME_KEY, useChangePassword, useLogout, useMe } from "./auth";
import { apiError, json, ME, mockApi, noContent } from "./test/mock-api";
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

describe("useLogout", () => {
  it("termina a sessão, esquece os dados da conta e põe a sessão a null em quem a observa, noutro componente", async () => {
    const server = mockApi({
      "GET /api/auth/me": () => json({ user: ME }),
      "POST /api/auth/logout": () => noContent(),
    });
    const client = testQueryClient();
    const wrapper = queryWrapper(client);
    const me = renderHook(() => useMe(), { wrapper }); // um componente
    const logout = renderHook(() => useLogout(), { wrapper }); // outro: não se re-renderiza por causa do `me`
    await waitFor(() => expect(me.result.current.data).toEqual(ME));
    client.setQueryData(["folder", "root"], { folders: [], files: [] });

    await act(() => logout.result.current.mutateAsync());

    expect(server.callsTo("POST /api/auth/logout")).toHaveLength(1);
    await waitFor(() => expect(me.result.current.data).toBeNull());
    expect(client.getQueryData(["folder", "root"])).toBeUndefined();
  });

  it("uma resposta tardia da sessão não repõe o utilizador depois de terminar a sessão", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mockApi({
      "GET /api/auth/me": async () => {
        if (++calls === 1) return json({ user: ME });
        await gate; // o segundo pedido fica à espera
        return json({ user: ME });
      },
      "POST /api/auth/logout": () => noContent(),
    });
    const client = testQueryClient();
    const wrapper = queryWrapper(client);
    const me = renderHook(() => useMe(), { wrapper });
    const logout = renderHook(() => useLogout(), { wrapper });
    await waitFor(() => expect(me.result.current.data).toEqual(ME));
    void client.invalidateQueries({ queryKey: ME_KEY }); // um refresh da sessão em curso
    await waitFor(() => expect(calls).toBe(2));

    await act(() => logout.result.current.mutateAsync());
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(me.result.current.data).toBeNull();
  });

  it("esvazia também a cache das mutações (variáveis de senhas, tokens)", async () => {
    mockApi({
      "GET /api/auth/me": () => json({ user: ME }),
      "POST /api/auth/password": () => noContent(),
      "POST /api/auth/logout": () => noContent(),
    });
    const client = testQueryClient();
    const wrapper = queryWrapper(client);
    const change = renderHook(() => useChangePassword(), { wrapper });
    const logout = renderHook(() => useLogout(), { wrapper });
    await act(() => change.result.current.mutateAsync({ currentPassword: "velha-senha", newPassword: "nova-senha" }));
    expect(client.getMutationCache().getAll()).toHaveLength(1);

    await act(() => logout.result.current.mutateAsync());

    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });
});
