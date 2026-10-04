import { describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  apiFetch,
  errorMessage,
  NETWORK_ERROR_MESSAGE,
  setUnauthorizedHandler,
} from "./api";
import { apiError, json, mockApi, noContent } from "./test/mock-api";

describe("apiFetch", () => {
  it("devolve o JSON da resposta e envia o corpo como JSON", async () => {
    const server = mockApi({
      "POST /api/folders": ({ body }) => json({ folder: { id: "f1", echo: body } }, 201),
    });
    const data = await apiFetch<{ folder: { id: string; echo: unknown } }>("/api/folders", {
      method: "POST",
      json: { name: "Fotos" },
    });
    expect(data.folder).toEqual({ id: "f1", echo: { name: "Fotos" } });
    expect(server.callsTo("POST /api/folders")).toHaveLength(1);
  });

  it("devolve undefined quando a resposta é 204", async () => {
    mockApi({ "DELETE /api/files/:id": () => noContent() });
    await expect(apiFetch("/api/files/f1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("lança ApiRequestError com o código e a mensagem em português da API", async () => {
    mockApi({
      "GET /api/x": () => apiError(409, "name_taken", "Já existe uma pasta com esse nome neste local."),
    });
    const failure = apiFetch("/api/x");
    await expect(failure).rejects.toBeInstanceOf(ApiRequestError);
    await expect(failure).rejects.toMatchObject({
      status: 409,
      code: "name_taken",
      message: "Já existe uma pasta com esse nome neste local.",
    });
  });
});

describe("apiFetch: erros sem o JSON da API", () => {
  it.each([
    [413, "O ficheiro é demasiado grande."],
    [502, "Erro do servidor. Tente novamente dentro de instantes."],
    [400, "Ocorreu um erro. Tente novamente."],
  ])("o estado %i usa a mensagem de recurso", async (status, message) => {
    mockApi({ "GET /api/x": () => new Response("<html>erro</html>", { status }) });
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ status, code: "unknown_error", message });
  });

  it("converte uma falha de rede numa mensagem em português (e não em 'Failed to fetch')", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(apiFetch("/api/x")).rejects.toMatchObject({
      status: 0,
      code: "network_error",
      message: NETWORK_ERROR_MESSAGE,
    });
  });
});

describe("sessão expirada", () => {
  it("avisa o handler num 401 `unauthorized`, mas não noutros 401", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockApi({
      "GET /api/a": () => apiError(401, "unauthorized", "Sessão inválida ou expirada."),
      "POST /api/auth/login": () => apiError(401, "invalid_credentials", "Email ou senha inválidos."),
    });
    await expect(apiFetch("/api/a")).rejects.toMatchObject({ code: "unauthorized" });
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(apiFetch("/api/auth/login", { method: "POST", json: {} })).rejects.toMatchObject({
      code: "invalid_credentials",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("errorMessage", () => {
  it("usa a mensagem do erro, ou uma genérica se o valor não for um erro", () => {
    expect(errorMessage(new ApiRequestError(409, "name_taken", "Nome repetido."))).toBe("Nome repetido.");
    expect(errorMessage("estranho")).toBe("Ocorreu um erro. Tente novamente.");
  });
});
