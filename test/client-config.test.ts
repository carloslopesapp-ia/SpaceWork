import { beforeEach, describe, expect, it } from "vitest";
import { registerUser } from "./auth-helpers";
import { fetchWithEnv } from "./db-helpers";
import { api, buildRequest, resetDb } from "./helpers";

beforeEach(resetDb);

describe("GET /api/config", () => {
  it("exige sessão", async () => {
    expect((await api("/api/config")).status).toBe(401);
  });

  it("devolve o tamanho máximo de um ficheiro", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const res = await api("/api/config", { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ maxUploadBytes: 104_857_600 });
  });

  it("segue a variável MAX_UPLOAD_BYTES", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const res = await fetchWithEnv(buildRequest("/api/config", { cookie }), { MAX_UPLOAD_BYTES: "2048" });
    expect(await res.json()).toEqual({ maxUploadBytes: 2048 });
  });
});
