import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";

beforeEach(resetDb);

describe("cabeçalhos de segurança", () => {
  it("aparecem nas respostas de sucesso e de erro", async () => {
    for (const path of ["/api/health", "/api/nao-existe"]) {
      const res = await api(path);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      expect(res.headers.get("referrer-policy")).toBe("same-origin");
    }
  });
});

describe("proteção CSRF por Origin", () => {
  it("recusa pedidos que alteram dados sem Origin", async () => {
    const res = await api("/api/qualquer-coisa", { method: "POST", json: {}, origin: null });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden_origin" });
  });

  it("recusa pedidos com Origin de outro site", async () => {
    const res = await api("/api/qualquer-coisa", {
      method: "POST",
      json: {},
      origin: "https://site-malicioso.example",
    });
    expect(res.status).toBe(403);
  });

  it("deixa passar pedidos com o Origin certo (aqui acabam em 404 por a rota não existir)", async () => {
    const res = await api("/api/qualquer-coisa", { method: "POST", json: {} });
    expect(res.status).toBe(404);
  });

  it("não exige Origin em pedidos GET", async () => {
    const res = await api("/api/health", { origin: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("erros em JSON", () => {
  it("devolve 404 em JSON para rotas /api desconhecidas", async () => {
    const res = await api("/api/nao-existe");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: "Não encontrado." });
  });
});
