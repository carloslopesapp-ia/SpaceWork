import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TrashContents, TrashItem } from "../shared/types";
import { useMe } from "./auth";
import { useContents, useDeleteFile } from "./space";
import { apiError, json, ME, mockApi, noContent } from "./test/mock-api";
import { queryWrapper, testQueryClient } from "./test/render";
import { useEmptyTrash, usePurgeFile, useRestoreFile, useTrash } from "./trash";

const ITEM: TrashItem = {
  id: "a b",
  name: "velho.txt",
  size: 10,
  mime: "text/plain",
  folderId: null,
  path: [],
  deletedAt: 1,
  purgeAt: 2,
};
const TRASH: TrashContents = { items: [ITEM], total: 1, retentionDays: 30 };
const EMPTY = { folder: null, breadcrumb: [], folders: [], files: [] };

/** O que uma mutação da lixeira tem de atualizar: a própria lixeira, a listagem das pastas e a quota. */
function serveTrash(extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    "GET /api/trash": () => json(TRASH),
    "GET /api/folders/:id/contents": () => json(EMPTY),
    "GET /api/auth/me": () => json({ user: ME }),
    ...extra,
  });
}

function renderWith<T>(hook: () => T) {
  return renderHook(() => ({ trash: useTrash(), contents: useContents(null), me: useMe(), action: hook() }), {
    wrapper: queryWrapper(testQueryClient()),
  });
}

async function loaded(result: { current: { trash: { isSuccess: boolean }; contents: { isSuccess: boolean }; me: { isSuccess: boolean } } }) {
  await waitFor(() => {
    expect(result.current.trash.isSuccess).toBe(true);
    expect(result.current.contents.isSuccess).toBe(true);
    expect(result.current.me.isSuccess).toBe(true);
  });
}

describe("useTrash", () => {
  it("devolve a lixeira", async () => {
    serveTrash();
    const { result } = renderHook(() => useTrash(), { wrapper: queryWrapper(testQueryClient()) });
    await waitFor(() => expect(result.current.data).toEqual(TRASH));
  });
});

describe("useRestoreFile", () => {
  it("usa POST com o id codificado e atualiza a lixeira, a listagem e a quota", async () => {
    const server = serveTrash({
      "POST /api/trash/:id/restore": () => json({ file: { id: "a b", name: "velho.txt", folderId: null, size: 10, mime: "text/plain", createdAt: 1 } }),
    });
    const { result } = renderWith(useRestoreFile);
    await loaded(result);

    await act(() => result.current.action.mutateAsync("a b"));

    expect(server.callsTo("POST /api/trash/:id/restore")[0]).toMatchObject({ method: "POST", path: "/api/trash/a%20b/restore" });
    await waitFor(() => {
      expect(server.callsTo("GET /api/trash")).toHaveLength(2);
      expect(server.callsTo("GET /api/folders/:id/contents")).toHaveLength(2);
      expect(server.callsTo("GET /api/auth/me")).toHaveLength(2);
    });
  });

  it("também atualiza quando o restauro falha (a lixeira pode estar velha)", async () => {
    const server = serveTrash({ "POST /api/trash/:id/restore": () => apiError(404, "file_not_found", "Ficheiro não encontrado na lixeira.") });
    const { result } = renderWith(useRestoreFile);
    await loaded(result);

    await act(() => result.current.action.mutateAsync("a b").catch(() => undefined));

    await waitFor(() => expect(result.current.action.error?.message).toBe("Ficheiro não encontrado na lixeira."));
    await waitFor(() => expect(server.callsTo("GET /api/trash")).toHaveLength(2));
  });
});

describe("usePurgeFile", () => {
  it("usa DELETE com o id codificado e atualiza a lixeira e a quota", async () => {
    const server = serveTrash({ "DELETE /api/trash/:id": () => noContent() });
    const { result } = renderWith(usePurgeFile);
    await loaded(result);

    await act(() => result.current.action.mutateAsync("a b"));

    expect(server.callsTo("DELETE /api/trash/:id")[0]).toMatchObject({ method: "DELETE", path: "/api/trash/a%20b" });
    await waitFor(() => {
      expect(server.callsTo("GET /api/trash")).toHaveLength(2);
      expect(server.callsTo("GET /api/auth/me")).toHaveLength(2);
    });
  });
});

describe("excluir um ficheiro", () => {
  it("atualiza também a lixeira, que passa a ter o ficheiro", async () => {
    const server = serveTrash({ "DELETE /api/files/:id": () => noContent() });
    const { result } = renderWith(useDeleteFile);
    await loaded(result);

    await act(() => result.current.action.mutateAsync("a1"));

    await waitFor(() => expect(server.callsTo("GET /api/trash")).toHaveLength(2));
  });
});

describe("useEmptyTrash", () => {
  it("repete o pedido até não ficar nada, vai dando o progresso e no fim atualiza a lixeira e a quota", async () => {
    let round = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const server = serveTrash({
      "DELETE /api/trash": async () => {
        round++;
        if (round === 1) return json({ purged: 50, remaining: 70 });
        if (round === 2) {
          await gate; // dá tempo a ver o progresso entre o 1.º e o 2.º bloco
          return json({ purged: 50, remaining: 20 });
        }
        return json({ purged: 20, remaining: 0 });
      },
    });
    const { result } = renderWith(useEmptyTrash);
    await loaded(result);

    let finished!: Promise<unknown>;
    act(() => {
      finished = result.current.action.mutateAsync();
    });
    await waitFor(() => expect(result.current.action.purged).toBe(50));
    expect(server.callsTo("DELETE /api/trash")).toHaveLength(2);

    release();
    await act(() => finished);

    expect(result.current.action.data).toEqual({ purged: 120, remaining: 0 });
    expect(result.current.action.purged).toBe(120);
    expect(server.callsTo("DELETE /api/trash")).toHaveLength(3);
    await waitFor(() => {
      expect(server.callsTo("GET /api/trash")).toHaveLength(2);
      expect(server.callsTo("GET /api/auth/me")).toHaveLength(2);
    });
  });

  it("pára quando um pedido não elimina nada, mesmo que fiquem ficheiros (não repete sem fim)", async () => {
    const server = serveTrash({ "DELETE /api/trash": () => json({ purged: 0, remaining: 5 }) });
    const { result } = renderWith(useEmptyTrash);
    await loaded(result);

    await act(() => result.current.action.mutateAsync());

    expect(server.callsTo("DELETE /api/trash")).toHaveLength(1);
    expect(result.current.action.data).toEqual({ purged: 0, remaining: 5 });
  });

  it("um erro a meio pára o ciclo, fica no resultado e atualiza a lixeira com o que já foi eliminado", async () => {
    let round = 0;
    const server = serveTrash({
      "DELETE /api/trash": () =>
        ++round === 1 ? json({ purged: 50, remaining: 70 }) : apiError(500, "internal_error", "Erro interno do servidor."),
    });
    const { result } = renderWith(useEmptyTrash);
    await loaded(result);

    await act(() => result.current.action.mutateAsync().catch(() => undefined));

    await waitFor(() => expect(result.current.action.error?.message).toBe("Erro interno do servidor."));
    expect(result.current.action.purged).toBe(50);
    expect(server.callsTo("DELETE /api/trash")).toHaveLength(2);
    await waitFor(() => expect(server.callsTo("GET /api/trash")).toHaveLength(2));
  });
});
