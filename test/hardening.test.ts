import { beforeEach, describe, expect, it } from "vitest";
import { HTTPException } from "hono/http-exception";
import { app } from "../src/worker/app";
import { JSON_BODY_LIMIT_BYTES } from "../src/worker/middleware/body-limit";
import { api, resetDb } from "./helpers";

// Rota só para este ficheiro de testes (cada ficheiro corre no seu próprio isolate).
app.get("/api/__teste/http-exception", () => {
  throw new HTTPException(418, { message: "sou um bule" });
});

beforeEach(resetDb);

describe("Cache-Control", () => {
  it("todas as respostas da API levam no-store", async () => {
    for (const path of ["/api/health", "/api/nao-existe", "/api/auth/me"]) {
      expect((await api(path)).headers.get("cache-control")).toBe("no-store");
    }
  });
});

describe("limite de tamanho dos pedidos JSON", () => {
  it("recusa com 413 um corpo JSON acima de 64 KiB", async () => {
    const res = await api("/api/auth/register", {
      method: "POST",
      json: { email: "ana@example.com", password: "x".repeat(JSON_BODY_LIMIT_BYTES) },
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: "payload_too_large",
      message: "O pedido é demasiado grande.",
    });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("aceita corpos pequenos", async () => {
    const res = await api("/api/auth/register", {
      method: "POST",
      json: { email: "ana@example.com", password: "senha-segura-123" },
    });
    expect(res.status).toBe(201);
  });
});

describe("erros do Hono (HTTPException)", () => {
  it("mantêm o estado e viram JSON em vez de 500", async () => {
    const res = await api("/api/__teste/http-exception");
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ error: "http_error", message: "sou um bule" });
  });
});
