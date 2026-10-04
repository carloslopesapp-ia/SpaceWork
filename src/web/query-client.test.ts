import { describe, expect, it } from "vitest";
import { ApiRequestError, apiFetch, networkError } from "./api";
import { ME_KEY } from "./auth";
import { createQueryClient, shouldRetry } from "./query-client";
import { apiError, ME, mockApi } from "./test/mock-api";

describe("shouldRetry", () => {
  it("repete falhas de rede e erros 5xx até duas vezes", () => {
    for (const error of [networkError(), new ApiRequestError(502, "unknown_error", "x")]) {
      expect(shouldRetry(0, error)).toBe(true);
      expect(shouldRetry(1, error)).toBe(true);
      expect(shouldRetry(2, error)).toBe(false);
    }
  });

  it("não repete erros 4xx (um 404 ou um 409 não se resolvem a repetir)", () => {
    expect(shouldRetry(0, new ApiRequestError(404, "folder_not_found", "x"))).toBe(false);
    expect(shouldRetry(0, new ApiRequestError(409, "name_taken", "x"))).toBe(false);
  });
});

describe("createQueryClient", () => {
  it("num 401 `unauthorized` esquece as consultas da conta e põe a sessão a null", async () => {
    const client = createQueryClient();
    client.setQueryData(ME_KEY, ME);
    client.setQueryData(["folder", "root"], { folders: [], files: [] });
    mockApi({ "GET /api/folders/tree": () => apiError(401, "unauthorized", "Sessão inválida ou expirada.") });

    await expect(apiFetch("/api/folders/tree")).rejects.toBeInstanceOf(ApiRequestError);

    expect(client.getQueryData(ME_KEY)).toBeNull();
    expect(client.getQueryData(["folder", "root"])).toBeUndefined();
  });
});
