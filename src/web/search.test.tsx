import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SearchResult } from "../shared/types";
import { describeSearch, useSearch } from "./search";
import { useDeleteFile } from "./space";
import { json, mockApi, noContent } from "./test/mock-api";
import { queryWrapper, testQueryClient } from "./test/render";

const FOUND: SearchResult[] = [
  {
    kind: "file",
    path: [{ id: "f1", name: "Fotos" }],
    file: { id: "a1", name: "praia.png", folderId: "f1", size: 10, mime: "image/png", createdAt: 1 },
  },
];

describe("describeSearch", () => {
  it("tira os espaços das pontas e aceita 2 caracteres ou mais", () => {
    expect(describeSearch("  Relatório ")).toEqual({ term: "Relatório", problem: null });
    expect(describeSearch("ab").problem).toBeNull();
  });

  it("pede pelo menos 2 caracteres, depois de tirar os espaços e os acentos (como a API)", () => {
    for (const raw of ["", " a ", "́"]) {
      expect(describeSearch(raw).problem, JSON.stringify(raw)).toBe("Escreva pelo menos 2 caracteres.");
    }
  });

  it("recusa mais de 100 caracteres, mas aceita exatamente 100", () => {
    expect(describeSearch("x".repeat(100)).problem).toBeNull();
    expect(describeSearch("x".repeat(101)).problem).toBe("A pesquisa não pode ter mais de 100 caracteres.");
  });
});

describe("useSearch", () => {
  it("pede à API o texto sem espaços (com o URL codificado) e devolve os resultados", async () => {
    const server = mockApi({ "GET /api/search": () => json({ results: FOUND }) });
    const { result } = renderHook(() => useSearch("  praia & sol "), { wrapper: queryWrapper(testQueryClient()) });
    await waitFor(() => expect(result.current.data).toEqual(FOUND));
    expect(server.calls[0].query.get("q")).toBe("praia & sol");
  });

  it("não pede nada à API enquanto o texto não é válido", async () => {
    const server = mockApi({ "GET /api/search": () => json({ results: FOUND }) });
    const { result } = renderHook(() => useSearch("a"), { wrapper: queryWrapper(testQueryClient()) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
    expect(server.calls).toHaveLength(0);
  });

  it("depois de uma alteração ao espaço volta a pedir os resultados", async () => {
    const server = mockApi({
      "GET /api/search": () => json({ results: FOUND }),
      "DELETE /api/files/:id": () => noContent(),
    });
    const wrapper = queryWrapper(testQueryClient());
    const search = renderHook(() => useSearch("praia"), { wrapper });
    const remove = renderHook(() => useDeleteFile(), { wrapper });
    await waitFor(() => expect(search.result.current.isSuccess).toBe(true));

    await act(() => remove.result.current.mutateAsync("a1"));

    await waitFor(() => expect(server.callsTo("GET /api/search")).toHaveLength(2));
  });
});
