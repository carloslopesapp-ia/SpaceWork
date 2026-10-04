import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/worker/app";
import { registerUser } from "./auth-helpers";
import { uploadOk } from "./file-helpers";
import { createFolder, getContents } from "./folder-helpers";
import { api, resetState } from "./helpers";

beforeEach(resetState);

// As únicas rotas que não exigem sessão. Qualquer outra rota registada em `app` (seja qual for o prefixo, mesmo
// um router criado com `new Hono()` em vez de `createAuthedRouter()`) tem de dar 401 sem cookie.
const PUBLIC_ROUTES = new Set([
  "GET /api/health",
  "POST /api/auth/register",
  "POST /api/auth/login",
  "POST /api/auth/logout",
]);

describe("todas as rotas privadas exigem sessão", () => {
  it("devolve 401 sem cookie em cada rota registada, exceto as públicas", async () => {
    // O middleware de uma rota (ex.: o limite do corpo no PATCH) aparece como uma entrada repetida: deduplica-se.
    const registered = new Map<string, { method: string; path: string }>();
    for (const { method, path } of app.routes) {
      if (method !== "ALL") registered.set(`${method} ${path}`, { method, path });
    }
    for (const key of PUBLIC_ROUTES) expect(registered.has(key), `${key} já não existe: tirá-la da lista`).toBe(true);

    const privateRoutes = [...registered].filter(([key]) => !PUBLIC_ROUTES.has(key));
    expect(privateRoutes.length).toBeGreaterThan(0); // falha se a varredura deixar de apanhar rotas
    for (const [key, { method, path }] of privateRoutes) {
      const res = await api(path.replace(/:\w+/g, "x"), { method, json: method === "GET" ? undefined : {} });
      expect(res.status, key).toBe(401);
    }
  });
});

describe("isolamento entre utilizadores", () => {
  it("o Bob não vê nem altera nada da Ana, em nenhuma rota", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const pasta = await createFolder(ana.cookie, "Pasta da Ana");
    const ficheiro = await uploadOk(ana.cookie, "da-ana.png", "segredo", { folder: pasta.id });
    const doBob = await createFolder(bob.cookie, "Do Bob");

    const attempts: Array<[string, string, unknown?]> = [
      ["GET", `/api/folders/${pasta.id}/contents`],
      ["PATCH", `/api/folders/${pasta.id}`, { name: "roubada" }],
      ["DELETE", `/api/folders/${pasta.id}`],
      ["GET", `/api/files/${ficheiro.id}/download`],
      ["GET", `/api/files/${ficheiro.id}/preview`],
      ["PATCH", `/api/files/${ficheiro.id}`, { name: "roubado.png" }],
      ["PATCH", `/api/files/${ficheiro.id}`, { folderId: doBob.id }],
      ["DELETE", `/api/files/${ficheiro.id}`],
    ];
    for (const [method, path, json] of attempts) {
      const res = await api(path, { method, cookie: bob.cookie, json });
      expect(res.status, `${method} ${path}`).toBe(404);
    }

    // o Bob também não consegue pôr coisas dentro da pasta da Ana
    const upload = await uploadOk(bob.cookie, "b.txt", "x");
    expect((await api(`/api/files/${upload.id}`, { method: "PATCH", cookie: bob.cookie, json: { folderId: pasta.id } })).status).toBe(404);

    // nada mudou do lado da Ana
    const contents = await getContents(ana.cookie, pasta.id);
    expect(contents.folder?.name).toBe("Pasta da Ana");
    expect(contents.files.map((f) => f.name)).toEqual(["da-ana.png"]);
    const download = await api(`/api/files/${ficheiro.id}/download`, { cookie: ana.cookie });
    expect(await download.text()).toBe("segredo");
  });
});
