import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { PublicShare, ShareItem } from "../src/shared/types";
import { registerUser, setUserStatus } from "./auth-helpers";
import { silenceErrors } from "./db-helpers";
import { bodyText, uploadOk } from "./file-helpers";
import { api, resetState } from "./helpers";

beforeEach(resetState);

async function share(cookie: string, fileId: string, json: unknown = {}): Promise<{ share: ShareItem; token: string }> {
  const res = await api(`/api/files/${fileId}/shares`, { method: "POST", cookie, json });
  expect(res.status).toBe(201);
  return (await res.json()) as { share: ShareItem; token: string };
}

const info = (token: string) => api(`/api/public/shares/${token}`);
const download = (token: string) => api(`/api/public/shares/${token}/download`);

/** Cria um ficheiro partilhado e devolve tudo o que os testes precisam. */
async function setup(content = "conteúdo secreto") {
  const ana = await registerUser("ana@example.com");
  const file = await uploadOk(ana.cookie, "relatório.txt", content);
  return { ana, file, ...(await share(ana.cookie, file.id)) };
}

const NOT_FOUND = { error: "share_not_found", message: "Este link não existe ou já não está disponível." };

describe("páginas públicas de partilha", () => {
  it("mostra o nome e o tamanho a quem tem o link, sem sessão", async () => {
    const { token, file } = await setup("12345");

    const res = await info(token); // sem cookie

    expect(res.status).toBe(200);
    expect((await res.json()) as PublicShare).toEqual({ name: "relatório.txt", size: file.size });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("descarrega o ficheiro como anexo, sem sessão", async () => {
    const { token } = await setup("conteúdo secreto");

    const res = await download(token);

    expect(res.status).toBe(200);
    expect(await bodyText(res)).toBe("conteúdo secreto");
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''relat%C3%B3rio.txt");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("um link que nunca existiu e um ativo falham do mesmo modo que um link revogado, expirado ou de um ficheiro na lixeira (404 igual, sem pistas)", async () => {
    const { ana, file, token } = await setup();
    const expired = await share(ana.cookie, file.id, { expiresAt: Date.now() + 3_600_000 });
    const revoked = await share(ana.cookie, file.id);
    await env.DB.prepare("UPDATE shares SET expires_at = 1 WHERE id = ?1").bind(expired.share.id).run();
    await api(`/api/shares/${revoked.share.id}`, { method: "DELETE", cookie: ana.cookie });

    for (const dead of ["nunca-existiu", expired.token, revoked.token]) {
      for (const get of [info, download]) {
        const res = await get(dead);
        expect(res.status, dead).toBe(404);
        expect(await res.json()).toEqual(NOT_FOUND);
      }
    }
    expect((await info(token)).status).toBe(200); // o link ativo não foi afetado
  });

  it("enquanto o ficheiro está na lixeira o link não funciona, e volta a funcionar depois do restauro", async () => {
    const { ana, file, token } = await setup();
    await api(`/api/files/${file.id}`, { method: "DELETE", cookie: ana.cookie });

    for (const get of [info, download]) {
      const res = await get(token);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }

    expect((await api(`/api/trash/${file.id}/restore`, { method: "POST", cookie: ana.cookie })).status).toBe(200);
    expect((await info(token)).status).toBe(200);
    expect((await download(token)).status).toBe(200);
  });

  it("depois de eliminar o ficheiro de vez, o link nunca mais funciona (as partilhas saem em cascata)", async () => {
    const { ana, file, token } = await setup();
    await api(`/api/files/${file.id}`, { method: "DELETE", cookie: ana.cookie });
    await api(`/api/trash/${file.id}`, { method: "DELETE", cookie: ana.cookie });

    expect((await info(token)).status).toBe(404);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM shares").first<{ n: number }>())?.n).toBe(0);
  });

  it("os links de uma conta suspensa deixam de funcionar", async () => {
    const { token } = await setup();
    await setUserStatus("ana@example.com", "suspended");
    const res = await info(token);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    await setUserStatus("ana@example.com", "active");
    expect((await info(token)).status).toBe(200);
  });

  it("se o objeto falta no R2, o descarregamento responde 404 `file_missing` e regista o problema", async () => {
    const errors = silenceErrors();
    const { token } = await setup();
    const { results } = await env.DB.prepare("SELECT r2_key FROM files").all<{ r2_key: string }>();
    await env.FILES.delete(results.map((row) => row.r2_key));

    const res = await download(token);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "file_missing" });
    expect(errors).toHaveBeenCalled();
  });
});
