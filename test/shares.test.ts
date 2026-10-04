import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ShareItem } from "../src/shared/types";
import { sha256Hex } from "../src/worker/lib/crypto";
import { JSON_BODY_LIMIT_BYTES } from "../src/worker/middleware/body-limit";
import { registerUser } from "./auth-helpers";
import { uploadOk } from "./file-helpers";
import { api, resetState } from "./helpers";

beforeEach(resetState);

const HOUR_MS = 3_600_000;
const YEAR_MS = 365 * 86_400_000;

const createShare = (cookie: string, fileId: string, json: unknown = {}) =>
  api(`/api/files/${fileId}/shares`, { method: "POST", cookie, json });

async function created(cookie: string, fileId: string, json: unknown = {}): Promise<{ share: ShareItem; token: string }> {
  const res = await createShare(cookie, fileId, json);
  expect(res.status).toBe(201);
  return (await res.json()) as { share: ShareItem; token: string };
}

async function listShares(cookie: string, fileId: string): Promise<ShareItem[]> {
  const res = await api(`/api/files/${fileId}/shares`, { cookie });
  expect(res.status).toBe(200);
  return ((await res.json()) as { shares: ShareItem[] }).shares;
}

describe("POST /api/files/:id/shares", () => {
  it("exige sessão", async () => {
    expect((await api("/api/files/x/shares", { method: "POST", json: {} })).status).toBe(401);
    expect((await api("/api/files/x/shares")).status).toBe(401);
    expect((await api("/api/shares/x", { method: "DELETE" })).status).toBe(401);
  });

  it("cria um link: devolve o token uma só vez e a D1 guarda só o hash", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "x");

    const { share, token } = await created(cookie, file.id);

    expect(share).toMatchObject({ fileId: file.id, expiresAt: null });
    expect(typeof share.createdAt).toBe("number");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes em base64url
    const row = await env.DB.prepare("SELECT token_hash FROM shares WHERE id = ?1").bind(share.id).first<{ token_hash: string }>();
    expect(row?.token_hash).toBe(await sha256Hex(token));
    expect(row?.token_hash).not.toBe(token);
    expect((await created(cookie, file.id)).token).not.toBe(token); // cada link tem o seu token
  });

  it("aceita uma validade no futuro e recusa tudo o resto com 400", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "x");
    const inOneHour = Date.now() + HOUR_MS;

    expect((await created(cookie, file.id, { expiresAt: inOneHour })).share.expiresAt).toBe(inOneHour);
    expect((await created(cookie, file.id, { expiresAt: null })).share.expiresAt).toBeNull();

    const invalid = [
      Date.now() - 1000,
      0,
      -0,
      "amanhã",
      1.5,
      true,
      {},
      [],
      Number.MAX_SAFE_INTEGER, // para lá dos 100 anos (a interface formata a data com `Intl`, que lança acima de 8,64e15)
      Date.now() + 101 * YEAR_MS,
    ];
    for (const expiresAt of invalid) {
      const res = await createShare(cookie, file.id, { expiresAt });
      expect(res.status, JSON.stringify(expiresAt)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_expiry" });
    }
    // `1e999` em JSON lê-se como `Infinity`: tem de ir como texto, o `JSON.stringify` do helper dava `null`.
    const infinite = await api(`/api/files/${file.id}/shares`, {
      method: "POST",
      cookie,
      body: '{"expiresAt":1e999}',
      headers: { "Content-Type": "application/json" },
    });
    expect(infinite.status).toBe(400);
    expect(await infinite.json()).toMatchObject({ error: "invalid_expiry" });
    expect((await createShare(cookie, file.id, { expiresAt: Date.now() + 99 * YEAR_MS })).status).toBe(201);
    const noBody = await api(`/api/files/${file.id}/shares`, { method: "POST", cookie });
    expect(noBody.status).toBe(400);
    expect(await noBody.json()).toMatchObject({ error: "invalid_body" });
  });

  it("só se partilha um ficheiro pronto, fora da lixeira e do próprio utilizador (senão 404)", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const file = await uploadOk(ana.cookie, "a.txt", "x");
    const apagado = await uploadOk(ana.cookie, "b.txt", "x");
    await api(`/api/files/${apagado.id}`, { method: "DELETE", cookie: ana.cookie });

    for (const [cookie, id] of [[bob.cookie, file.id], [ana.cookie, apagado.id], [ana.cookie, "nao-existe"]]) {
      const res = await createShare(cookie, id);
      expect(res.status, id).toBe(404);
      expect(await res.json()).toMatchObject({ error: "file_not_found" });
    }
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM shares").first<{ n: number }>())?.n).toBe(0);
  });

  it("no máximo 20 links ativos por ficheiro; os revogados e os expirados não contam", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "x");
    const shares: ShareItem[] = [];
    for (let i = 0; i < 20; i++) shares.push((await created(cookie, file.id)).share);

    const tooMany = await createShare(cookie, file.id);
    expect(tooMany.status).toBe(409);
    expect(await tooMany.json()).toMatchObject({ error: "too_many_shares" });

    await api(`/api/shares/${shares[0].id}`, { method: "DELETE", cookie });
    await env.DB.prepare("UPDATE shares SET expires_at = 1 WHERE id = ?1").bind(shares[1].id).run();
    expect((await createShare(cookie, file.id)).status).toBe(201);
    expect((await createShare(cookie, file.id)).status).toBe(201);
    expect((await createShare(cookie, file.id)).status).toBe(409);
  });

  it("25 pedidos em paralelo criam exatamente 20 links e os outros 5 dão 409 (o teto é atómico)", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "x");

    const responses = await Promise.all(Array.from({ length: 25 }, () => createShare(cookie, file.id)));

    expect(responses.filter((res) => res.status === 201)).toHaveLength(20);
    const refused = responses.filter((res) => res.status === 409);
    expect(refused).toHaveLength(5);
    for (const res of refused) expect(await res.json()).toMatchObject({ error: "too_many_shares" });
    expect(await listShares(cookie, file.id)).toHaveLength(20);
  });

  it("recusa com 413 um corpo acima de 64 KiB", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "x");
    const res = await createShare(cookie, file.id, { expiresAt: null, lixo: "x".repeat(JSON_BODY_LIMIT_BYTES) });
    expect(res.status).toBe(413);
  });
});

describe("GET /api/files/:id/shares", () => {
  it("lista só os links ativos, do mais recente para o mais antigo, sem o token", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "x");
    const first = await created(cookie, file.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await created(cookie, file.id, { expiresAt: Date.now() + HOUR_MS });
    const expired = await created(cookie, file.id, { expiresAt: Date.now() + HOUR_MS });
    const revoked = await created(cookie, file.id);
    await env.DB.prepare("UPDATE shares SET expires_at = 1 WHERE id = ?1").bind(expired.share.id).run();
    await api(`/api/shares/${revoked.share.id}`, { method: "DELETE", cookie });

    const res = await api(`/api/files/${file.id}/shares`, { cookie });
    const text = await res.text();

    const { shares } = JSON.parse(text) as { shares: ShareItem[] };
    expect(shares.map((s) => s.id)).toEqual([second.share.id, first.share.id]);
    expect(text).not.toContain(first.token);
    expect(text).not.toContain("token");
  });

  it("os links de outro utilizador ou de um ficheiro que não existe dão 404", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const file = await uploadOk(ana.cookie, "a.txt", "x");
    await created(ana.cookie, file.id);
    expect((await api(`/api/files/${file.id}/shares`, { cookie: bob.cookie })).status).toBe(404);
    expect((await api("/api/files/nao-existe/shares", { cookie: ana.cookie })).status).toBe(404);
    expect(await listShares(ana.cookie, file.id)).toHaveLength(1);
  });
});

describe("DELETE /api/shares/:id", () => {
  it("revoga o link: desaparece da lista e uma segunda revogação dá 404", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "x");
    const { share } = await created(cookie, file.id);

    const res = await api(`/api/shares/${share.id}`, { method: "DELETE", cookie });

    expect(res.status).toBe(204);
    expect(await listShares(cookie, file.id)).toEqual([]);
    const again = await api(`/api/shares/${share.id}`, { method: "DELETE", cookie });
    expect(again.status).toBe(404);
    expect(await again.json()).toMatchObject({ error: "share_not_found" });
  });

  it("um utilizador não revoga links de outro (404) e o link continua ativo", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const file = await uploadOk(ana.cookie, "a.txt", "x");
    const { share } = await created(ana.cookie, file.id);

    expect((await api(`/api/shares/${share.id}`, { method: "DELETE", cookie: bob.cookie })).status).toBe(404);
    expect((await api("/api/shares/nao-existe", { method: "DELETE", cookie: ana.cookie })).status).toBe(404);
    expect(await listShares(ana.cookie, file.id)).toHaveLength(1);
  });
});
