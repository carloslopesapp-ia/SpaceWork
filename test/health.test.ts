import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { dbFailingOn, fetchWithEnv, silenceErrors } from "./db-helpers";
import { buildRequest } from "./helpers";

describe("GET /api/health", () => {
  it("responde ok quando a base de dados está acessível", async () => {
    const res = await exports.default.fetch("http://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("responde 503 `{ ok: false }` e regista o erro quando a base de dados falha", async () => {
    const errors = silenceErrors();
    const res = await fetchWithEnv(buildRequest("/api/health"), { DB: dbFailingOn(/SELECT 1/) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
    expect(errors).toHaveBeenCalledOnce();
  });
});
