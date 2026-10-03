import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("responde ok quando a base de dados está acessível", async () => {
    const res = await exports.default.fetch("http://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
