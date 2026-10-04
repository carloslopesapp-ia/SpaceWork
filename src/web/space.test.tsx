import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { FolderContents } from "../shared/types";
import { useMe } from "./auth";
import { useConfig, useContents, useCreateFolder, useDeleteFile, useTree, useUpdateFolder } from "./space";
import { apiError, json, ME, mockApi, noContent } from "./test/mock-api";
import { queryWrapper, testQueryClient } from "./test/render";

const EMPTY: FolderContents = { folder: null, breadcrumb: [], folders: [], files: [] };

describe("consultas", () => {
  it("useContents pede a raiz como `root` e as pastas pelo id", async () => {
    const server = mockApi({ "GET /api/folders/:id/contents": () => json(EMPTY) });
    const wrapper = queryWrapper(testQueryClient());
    const root = renderHook(() => useContents(null), { wrapper });
    const inner = renderHook(() => useContents("abc"), { wrapper });
    await waitFor(() => expect(root.result.current.data).toEqual(EMPTY));
    await waitFor(() => expect(inner.result.current.data).toEqual(EMPTY));
    expect(server.calls.map((call) => call.path).sort()).toEqual([
      "/api/folders/abc/contents",
      "/api/folders/root/contents",
    ]);
  });

  it("useTree devolve a lista de pastas e useConfig os limites", async () => {
    const folders = [{ id: "a", name: "A", parentId: null, createdAt: 1 }];
    mockApi({
      "GET /api/folders/tree": () => json({ folders }),
      "GET /api/config": () => json({ maxUploadBytes: 1024 }),
    });
    const wrapper = queryWrapper(testQueryClient());
    const tree = renderHook(() => useTree(), { wrapper });
    const config = renderHook(() => useConfig(), { wrapper });
    await waitFor(() => expect(tree.result.current.data).toEqual(folders));
    await waitFor(() => expect(config.result.current.data).toEqual({ maxUploadBytes: 1024 }));
  });
});

describe("mutações", () => {
  it("criar uma pasta envia o corpo certo e atualiza a listagem, a árvore e a quota", async () => {
    let created = false;
    const server = mockApi({
      "GET /api/folders/:id/contents": () =>
        json({ ...EMPTY, folders: created ? [{ id: "n", name: "Nova", parentId: null, createdAt: 1 }] : [] }),
      "GET /api/folders/tree": () => json({ folders: [] }),
      "GET /api/auth/me": () => json({ user: { ...ME, usedBytes: created ? 10 : 0 } }),
      "POST /api/folders": () => {
        created = true;
        return json({ folder: { id: "n", name: "Nova", parentId: null, createdAt: 1 } }, 201);
      },
    });
    const { result } = renderHook(
      () => ({ contents: useContents(null), tree: useTree(), me: useMe(), create: useCreateFolder() }),
      { wrapper: queryWrapper(testQueryClient()) },
    );
    await waitFor(() => expect(result.current.contents.data?.folders).toEqual([]));
    await waitFor(() => expect(result.current.me.data?.usedBytes).toBe(0));
    await waitFor(() => expect(result.current.tree.isSuccess).toBe(true));

    await act(() => result.current.create.mutateAsync({ name: "Nova", parentId: null }));

    expect(server.callsTo("POST /api/folders")[0].body).toEqual({ name: "Nova", parentId: null });
    await waitFor(() => expect(result.current.contents.data?.folders).toHaveLength(1));
    await waitFor(() => expect(result.current.me.data?.usedBytes).toBe(10));
    await waitFor(() => expect(server.callsTo("GET /api/folders/tree")).toHaveLength(2));
  });

  it("também atualiza quando a mutação falha (os dados podem estar velhos)", async () => {
    const server = mockApi({
      "GET /api/folders/:id/contents": () => json(EMPTY),
      "PATCH /api/folders/:id": () => apiError(404, "folder_not_found", "Pasta não encontrada."),
    });
    const wrapper = queryWrapper(testQueryClient());
    const contents = renderHook(() => useContents(null), { wrapper });
    const update = renderHook(() => useUpdateFolder(), { wrapper });
    await waitFor(() => expect(contents.result.current.isSuccess).toBe(true));

    await act(async () => {
      await update.result.current.mutateAsync({ id: "x", name: "Y" }).catch(() => undefined);
    });

    await waitFor(() => expect(update.result.current.error?.message).toBe("Pasta não encontrada."));
    await waitFor(() => expect(server.callsTo("GET /api/folders/:id/contents")).toHaveLength(2));
  });

  it("excluir um ficheiro usa DELETE e o id codificado", async () => {
    const server = mockApi({ "DELETE /api/files/:id": () => noContent() });
    const { result } = renderHook(() => useDeleteFile(), { wrapper: queryWrapper(testQueryClient()) });
    await act(() => result.current.mutateAsync("a b"));
    expect(server.calls[0]).toMatchObject({ method: "DELETE", path: "/api/files/a%20b" });
  });
});
