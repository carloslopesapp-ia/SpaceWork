import { beforeEach, describe, expect, it } from "vitest";
import type { FolderItem } from "../src/shared/types";
import { registerUser } from "./auth-helpers";
import { createFolder, getContents } from "./folder-helpers";
import { api, resetDb } from "./helpers";

beforeEach(resetDb);

describe("POST /api/folders", () => {
  it("cria uma pasta na raiz", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const res = await api("/api/folders", { method: "POST", cookie, json: { name: "Fotos" } });
    expect(res.status).toBe(201);
    const { folder } = (await res.json()) as { folder: FolderItem };
    expect(folder).toMatchObject({ name: "Fotos", parentId: null });
    expect(folder.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof folder.createdAt).toBe("number");
    expect((await getContents(cookie)).folders.map((f) => f.name)).toEqual(["Fotos"]);
  });

  it("cria uma pasta dentro de outra e devolve o caminho no breadcrumb", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const fotos = await createFolder(cookie, "Fotos");
    const ano = await createFolder(cookie, "2026", fotos.id);
    expect(ano.parentId).toBe(fotos.id);
    const contents = await getContents(cookie, ano.id);
    expect(contents.folder?.name).toBe("2026");
    expect(contents.breadcrumb.map((b) => b.name)).toEqual(["Fotos", "2026"]);
  });

  it("normaliza o nome (NFC e sem espaços nas pontas)", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const input = "  Fe\u0301rias  "; // e + acento combinado (NFD), escrito com escape para o editor não o compor
    expect(input).not.toBe(input.normalize("NFC")); // guarda: se alguém o compor, o teste deixa de provar a normalização
    const folder = await createFolder(cookie, input);
    expect(folder.name).toBe("Férias");
  });

  it("recusa nomes inválidos com 400 invalid_name", async () => {
    const { cookie } = await registerUser("ana@example.com");
    for (const name of ["", "   ", ".", "..", "a/b", "a\u0000b", "a".repeat(256)]) {
      const res = await api("/api/folders", { method: "POST", cookie, json: { name } });
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_name" });
    }
    const missing = await api("/api/folders", { method: "POST", cookie, json: {} });
    expect(missing.status).toBe(400);
  });

  it("recusa um nome repetido no mesmo sítio (409) mas aceita-o noutra pasta", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const fotos = await createFolder(cookie, "Fotos");
    const dup = await api("/api/folders", { method: "POST", cookie, json: { name: "Fotos" } });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "name_taken" });
    await createFolder(cookie, "Fotos", fotos.id); // outra pasta-mãe: permitido
    const dupNested = await api("/api/folders", {
      method: "POST",
      cookie,
      json: { name: "Fotos", parentId: fotos.id },
    });
    expect(dupNested.status).toBe(409);
  });

  it("distingue maiúsculas de minúsculas nos nomes (como o índice único da spec)", async () => {
    const { cookie } = await registerUser("ana@example.com");
    await createFolder(cookie, "Fotos");
    await createFolder(cookie, "fotos");
    expect((await getContents(cookie)).folders).toHaveLength(2);
  });

  it("devolve 404 se a pasta-mãe não existir ou for de outro utilizador", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await createFolder(bob.cookie, "Privada");
    for (const parentId of ["nao-existe", doBob.id]) {
      const res = await api("/api/folders", {
        method: "POST",
        cookie: ana.cookie,
        json: { name: "X", parentId },
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "folder_not_found" });
    }
  });
});

describe("GET /api/folders/:id/contents", () => {
  it("a raiz tem folder null e breadcrumb vazio", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const contents = await getContents(cookie, "root");
    expect(contents).toEqual({ folder: null, breadcrumb: [], folders: [], files: [] });
  });

  it("ordena as pastas por nome sem acentos nem maiúsculas", async () => {
    const { cookie } = await registerUser("ana@example.com");
    for (const name of ["Zeta", "álbum", "Beta", "Acordos"]) await createFolder(cookie, name);
    expect((await getContents(cookie)).folders.map((f) => f.name)).toEqual([
      "Acordos",
      "álbum",
      "Beta",
      "Zeta",
    ]);
  });

  it("só mostra as pastas do próprio nível", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const a = await createFolder(cookie, "A");
    await createFolder(cookie, "B", a.id);
    expect((await getContents(cookie)).folders.map((f) => f.name)).toEqual(["A"]);
    expect((await getContents(cookie, a.id)).folders.map((f) => f.name)).toEqual(["B"]);
  });

  it("devolve 404 para pastas inexistentes e para pastas de outro utilizador", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await createFolder(bob.cookie, "Privada");
    for (const id of ["nao-existe", doBob.id]) {
      const res = await api(`/api/folders/${id}/contents`, { cookie: ana.cookie });
      expect(res.status).toBe(404);
    }
  });
});

describe("GET /api/folders/tree", () => {
  it("devolve todas as pastas do utilizador e só as dele", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const a = await createFolder(ana.cookie, "A");
    await createFolder(ana.cookie, "B", a.id);
    await createFolder(bob.cookie, "Do Bob");
    const res = await api("/api/folders/tree", { cookie: ana.cookie });
    expect(res.status).toBe(200);
    const { folders } = (await res.json()) as { folders: FolderItem[] };
    expect(folders.map((f) => f.name)).toEqual(["A", "B"]);
    expect(folders.find((f) => f.name === "B")?.parentId).toBe(a.id);
  });
});

describe("autenticação", () => {
  it("todas estas rotas exigem sessão", async () => {
    expect((await api("/api/folders/root/contents")).status).toBe(401);
    expect((await api("/api/folders/tree")).status).toBe(401);
    expect((await api("/api/folders", { method: "POST", json: { name: "X" } })).status).toBe(401);
  });
});
