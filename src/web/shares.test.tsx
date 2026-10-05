import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ShareItem } from "../shared/types";
import { shareDownloadUrl, shareUrl, useCreateShare, usePublicShare, useRevokeShare, useShares } from "./shares";
import { apiError, json, mockApi, noContent } from "./test/mock-api";
import { queryWrapper, testQueryClient } from "./test/render";

const SHARE: ShareItem = { id: "s1", fileId: "a b", createdAt: 1, expiresAt: null };

describe("useShares", () => {
  it("lista os links do ficheiro (o id vai codificado no URL)", async () => {
    const server = mockApi({ "GET /api/files/:id/shares": () => json({ shares: [SHARE] }) });
    const { result } = renderHook(() => useShares("a b"), { wrapper: queryWrapper(testQueryClient()) });
    await waitFor(() => expect(result.current.data).toEqual([SHARE]));
    expect(server.calls[0].path).toBe("/api/files/a%20b/shares");
  });
});

describe("useCreateShare", () => {
  it("sem validade envia um corpo vazio e com validade envia `expiresAt`; devolve o token e atualiza a lista", async () => {
    const server = mockApi({
      "GET /api/files/:id/shares": () => json({ shares: [] }),
      "POST /api/files/:id/shares": () => json({ share: SHARE, token: "tok" }, 201),
    });
    const wrapper = queryWrapper(testQueryClient());
    const list = renderHook(() => useShares("a b"), { wrapper });
    const create = renderHook(() => useCreateShare("a b"), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));

    let created: { share: ShareItem; token: string } | undefined;
    await act(async () => {
      created = await create.result.current.mutateAsync(null);
      await create.result.current.mutateAsync(1_800_000_000_000);
    });

    expect(created).toEqual({ share: SHARE, token: "tok" });
    const [forever, until] = server.callsTo("POST /api/files/:id/shares");
    expect(forever).toMatchObject({ path: "/api/files/a%20b/shares", body: {} });
    expect(until.body).toEqual({ expiresAt: 1_800_000_000_000 });
    await waitFor(() => expect(server.callsTo("GET /api/files/:id/shares").length).toBeGreaterThanOrEqual(2));
  });

  it("um erro (por exemplo, links a mais) fica no resultado da mutação", async () => {
    mockApi({ "POST /api/files/:id/shares": () => apiError(409, "too_many_shares", "Este ficheiro já tem 20 links ativos.") });
    const { result } = renderHook(() => useCreateShare("a"), { wrapper: queryWrapper(testQueryClient()) });
    await act(() => result.current.mutateAsync(null).catch(() => undefined));
    await waitFor(() => expect(result.current.error).toMatchObject({ code: "too_many_shares" }));
  });

  it("o token não fica na cache das mutações quando deixa de haver quem a observe", async () => {
    mockApi({ "POST /api/files/:id/shares": () => json({ share: SHARE, token: "tok" }, 201) });
    const client = testQueryClient();
    const create = renderHook(() => useCreateShare("a"), { wrapper: queryWrapper(client) });
    await act(() => create.result.current.mutateAsync(null));
    expect(client.getMutationCache().getAll()).toHaveLength(1);

    create.unmount();

    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
  });
});

describe("useRevokeShare", () => {
  it("usa DELETE com o id da partilha e atualiza a lista de links", async () => {
    const server = mockApi({
      "GET /api/files/:id/shares": () => json({ shares: [SHARE] }),
      "DELETE /api/shares/:id": () => noContent(),
    });
    const wrapper = queryWrapper(testQueryClient());
    const list = renderHook(() => useShares("a b"), { wrapper });
    const revoke = renderHook(() => useRevokeShare("a b"), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));

    await act(() => revoke.result.current.mutateAsync("s 1"));

    expect(server.callsTo("DELETE /api/shares/:id")[0]).toMatchObject({ method: "DELETE", path: "/api/shares/s%201" });
    await waitFor(() => expect(server.callsTo("GET /api/files/:id/shares")).toHaveLength(2));
  });
});

describe("usePublicShare", () => {
  it("pede o nome e o tamanho pelo token (sem sessão)", async () => {
    const server = mockApi({ "GET /api/public/shares/:token": () => json({ name: "relatório.pdf", size: 1536 }) });
    const { result } = renderHook(() => usePublicShare("t/k"), { wrapper: queryWrapper(testQueryClient()) });
    await waitFor(() => expect(result.current.data).toEqual({ name: "relatório.pdf", size: 1536 }));
    expect(server.calls[0].path).toBe("/api/public/shares/t%2Fk");
  });

  it("um link inválido dá o erro `share_not_found`", async () => {
    mockApi({ "GET /api/public/shares/:token": () => apiError(404, "share_not_found", "Este link não existe ou já não está disponível.") });
    const { result } = renderHook(() => usePublicShare("x"), { wrapper: queryWrapper(testQueryClient()) });
    await waitFor(() => expect(result.current.error).toMatchObject({ status: 404, code: "share_not_found" }));
  });
});

describe("endereços de um link", () => {
  it("a página pública fica na origem da aplicação e o descarregamento na API pública", () => {
    expect(shareUrl("abc_-")).toBe(`${window.location.origin}/s/abc_-`);
    expect(shareDownloadUrl("abc_-")).toBe("/api/public/shares/abc_-/download");
  });
});
