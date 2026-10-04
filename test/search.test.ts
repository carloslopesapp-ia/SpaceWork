import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { SearchResult } from "../src/shared/types";
import { registerUser } from "./auth-helpers";
import { dbCountingPrepares, fetchWithEnv } from "./db-helpers";
import { insertFileRow, uploadOk } from "./file-helpers";
import { createFolder } from "./folder-helpers";
import { api, buildRequest, resetState } from "./helpers";

beforeEach(resetState);

async function search(cookie: string, q: string): Promise<Response> {
  return api(`/api/search?q=${encodeURIComponent(q)}`, { cookie });
}

async function results(cookie: string, q: string): Promise<SearchResult[]> {
  const res = await search(cookie, q);
  expect(res.status).toBe(200);
  return ((await res.json()) as { results: SearchResult[] }).results;
}

const names = (found: SearchResult[]) => found.map((r) => (r.kind === "folder" ? r.folder.name : r.file.name));

describe("GET /api/search", () => {
  it("exige sessão", async () => {
    expect((await api("/api/search?q=ab")).status).toBe(401);
  });

  it("recusa pesquisas com menos de 2 caracteres (depois de tirar espaços e acentos) e com mais de 100", async () => {
    const { cookie } = await registerUser("ana@example.com");
    for (const q of ["", " a ", "́"]) {
      const res = await search(cookie, q);
      expect(res.status, JSON.stringify(q)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "query_too_short" });
    }
    const long = await search(cookie, "x".repeat(101));
    expect(long.status).toBe(400);
    expect(await long.json()).toMatchObject({ error: "query_too_long" });
  });

  it("encontra pastas e ficheiros sem distinguir maiúsculas nem acentos, por ordem de nome, com o caminho", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const docs = await createFolder(cookie, "Documentos");
    const contas = await createFolder(cookie, "Contas 2026", docs.id);
    await uploadOk(cookie, "Relatório Final.PDF", "x", { folder: contas.id });
    await uploadOk(cookie, "relatorio-rascunho.txt", "x");
    await createFolder(cookie, "Relatórios antigos", docs.id);
    await uploadOk(cookie, "outra coisa.txt", "x");

    const found = await results(cookie, "RELATORIO");

    expect(names(found)).toEqual(["Relatório Final.PDF", "relatorio-rascunho.txt", "Relatórios antigos"]);
    expect(found[0]).toMatchObject({ kind: "file", path: [{ name: "Documentos" }, { name: "Contas 2026" }] });
    expect(found[1]).toMatchObject({ kind: "file", path: [] });
    expect(found[2]).toMatchObject({ kind: "folder", path: [{ name: "Documentos" }] });
    expect(found[2].kind === "folder" && found[2].folder.parentId).toBe(docs.id);
  });

  it("trata `%`, `_` e `\\` do utilizador como letras, não como padrões", async () => {
    const { cookie } = await registerUser("ana@example.com");
    for (const name of ["desconto 50% hoje.txt", "desconto 500.txt", "a_b.txt", "axb.txt", "c\\d.txt", "cd.txt"]) {
      await uploadOk(cookie, name, "x");
    }
    expect(names(await results(cookie, "50%"))).toEqual(["desconto 50% hoje.txt"]);
    expect(names(await results(cookie, "a_b"))).toEqual(["a_b.txt"]);
    expect(names(await results(cookie, "c\\d"))).toEqual(["c\\d.txt"]);
  });

  it("não devolve ficheiros na lixeira nem envios `pending`, e não mistura utilizadores", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const visivel = await uploadOk(ana.cookie, "projeto-visivel.txt", "x");
    const apagado = await uploadOk(ana.cookie, "projeto-apagado.txt", "x");
    await api(`/api/files/${apagado.id}`, { method: "DELETE", cookie: ana.cookie });
    await insertFileRow(ana.user.id, null, { name: "projeto-pendente.txt", status: "pending" });
    await uploadOk(bob.cookie, "projeto-do-bob.txt", "x");

    expect(names(await results(ana.cookie, "projeto"))).toEqual(["projeto-visivel.txt"]);
    expect((await results(ana.cookie, "projeto"))[0]).toMatchObject({ kind: "file", file: { id: visivel.id } });
    expect(names(await results(bob.cookie, "projeto"))).toEqual(["projeto-do-bob.txt"]);
  });

  it("devolve no máximo 50 resultados e calcula os caminhos de todos numa só consulta recursiva", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const folderIds = Array.from({ length: 60 }, (_unused, index) => `pasta-${index}`);
    await env.DB.batch([
      ...folderIds.map((id) =>
        env.DB.prepare(
          "INSERT INTO folders (id, user_id, parent_id, name, name_norm, created_at) VALUES (?1, ?2, NULL, ?1, ?1, 0)",
        ).bind(id, user.id),
      ),
      ...folderIds.map((id, index) =>
        env.DB.prepare(
          `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at)
           VALUES (?1, ?2, ?3, ?4, ?4, 1, 'text/plain', ?5, 'ready', 0)`,
        ).bind(`ficheiro-${index}`, user.id, id, `relatorio-${String(index).padStart(2, "0")}.txt`, `u/${user.id}/ficheiro-${index}`),
      ),
    ]);

    const { db, sql } = dbCountingPrepares();
    const res = await fetchWithEnv(buildRequest("/api/search?q=relatorio", { cookie }), { DB: db });
    const found = ((await res.json()) as { results: SearchResult[] }).results;

    expect(found).toHaveLength(50);
    expect(names(found)[0]).toBe("relatorio-00.txt");
    expect(sql.filter((query) => query.includes("WITH RECURSIVE"))).toHaveLength(1);
  });
});
