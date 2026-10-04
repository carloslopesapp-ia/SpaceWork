import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { r2KeyFor } from "../src/worker/lib/files";
import { registerUser } from "./auth-helpers";
import { silenceErrors } from "./db-helpers";
import { bodyText, uploadOk } from "./file-helpers";
import { api, resetState } from "./helpers";

beforeEach(resetState);
afterEach(() => vi.restoreAllMocks());

async function trash(fileId: string): Promise<void> {
  await env.DB.prepare("UPDATE files SET deleted_at = 5 WHERE id = ?1").bind(fileId).run();
}

describe("GET /api/files/:id/download", () => {
  it("devolve os bytes como anexo, com cabeçalhos seguros", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "nota.txt", "olá mundo", { type: "text/plain" });
    const res = await api(`/api/files/${file.id}/download`, { cookie });
    expect(res.status).toBe(200);
    expect(await bodyText(res)).toBe("olá mundo");
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="nota.txt"; filename*=UTF-8''nota.txt`,
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]+"$/);
  });

  it("codifica nomes com acentos e aspas no Content-Disposition", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const accented = await uploadOk(cookie, "Relatório ção.pdf", "x");
    const res = await api(`/api/files/${accented.id}/download`, { cookie });
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="Relat_rio __o.pdf"; filename*=UTF-8''Relat%C3%B3rio%20%C3%A7%C3%A3o.pdf`,
    );
    const quoted = await uploadOk(cookie, `a"b (1).txt`, "x");
    const res2 = await api(`/api/files/${quoted.id}/download`, { cookie });
    expect(res2.headers.get("content-disposition")).toBe(
      `attachment; filename="a_b (1).txt"; filename*=UTF-8''a%22b%20%281%29.txt`,
    );
  });

  it("não interpreta HTML: continua a ser anexo", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "pagina.html", "<script>alert(1)</script>", { type: "text/html" });
    const res = await api(`/api/files/${file.id}/download`, { cookie });
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("devolve 404 para ficheiros inexistentes, de outro utilizador, na lixeira ou ainda a ser carregados", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await uploadOk(bob.cookie, "privado.txt", "segredo");
    const naLixeira = await uploadOk(ana.cookie, "lixo.txt", "x");
    await trash(naLixeira.id);
    await env.DB.prepare(
      `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at)
       VALUES ('p1', ?1, NULL, 'pending.txt', 'pending.txt', 1, 'text/plain', 'u/x/p1', 'pending', 1)`,
    )
      .bind((await env.DB.prepare("SELECT id FROM users WHERE email = 'ana@example.com'").first<{ id: string }>())?.id)
      .run();
    for (const id of ["nao-existe", doBob.id, naLixeira.id, "p1"]) {
      const res = await api(`/api/files/${id}/download`, { cookie: ana.cookie });
      expect(res.status, id).toBe(404);
      expect(await res.json(), id).toMatchObject({ error: "file_not_found" });
    }
  });

  it("devolve 404 file_missing quando a linha existe mas o objeto desapareceu do R2", async () => {
    const errors = silenceErrors();
    const { cookie, user } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "x");
    await env.FILES.delete(r2KeyFor(user.id, file.id));
    const res = await api(`/api/files/${file.id}/download`, { cookie });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "file_missing" });
    expect(errors).toHaveBeenCalledWith(`O ficheiro ${file.id} existe na D1 mas não tem objeto no R2.`);
  });

  it("exige sessão", async () => {
    expect((await api("/api/files/qualquer/download")).status).toBe(401);
  });
});

describe("GET /api/files/:id/preview", () => {
  it("mostra imagens inline com o Content-Type decidido pela extensão, não pelo valor guardado", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "falsa.png", "<html>nao sou uma imagem</html>", { type: "text/html" });
    const res = await api(`/api/files/${file.id}/preview`, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(await bodyText(res)).toBe("<html>nao sou uma imagem</html>");
  });

  it("mostra PDF inline, sem a política sandbox (o leitor de PDF do browser precisa dele)", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "doc.pdf", "%PDF-1.4", { type: "application/pdf" });
    const res = await api(`/api/files/${file.id}/preview`, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("reconhece todas as extensões permitidas, sem distinguir maiúsculas", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const expected: Record<string, string> = {
      "a.jpg": "image/jpeg",
      "b.JPEG": "image/jpeg",
      "c.gif": "image/gif",
      "d.WebP": "image/webp",
      "e.PNG": "image/png",
      "f.Pdf": "application/pdf",
    };
    for (const [name, type] of Object.entries(expected)) {
      const file = await uploadOk(cookie, name, "x");
      const res = await api(`/api/files/${file.id}/preview`, { cookie });
      expect(res.headers.get("content-type"), name).toBe(type);
    }
  });

  it("recusa com 415 SVG, HTML, texto e nomes sem extensão", async () => {
    const { cookie } = await registerUser("ana@example.com");
    for (const name of ["a.svg", "b.html", "c.txt", "png", ".png", "d.png.exe", "e.constructor", "f.__proto__"]) {
      const file = await uploadOk(cookie, name, "x");
      const res = await api(`/api/files/${file.id}/preview`, { cookie });
      expect(res.status, name).toBe(415);
      expect(await res.json()).toMatchObject({ error: "preview_unsupported" });
    }
  });

  describe("intervalos (Range)", () => {
    async function setup() {
      const { cookie } = await registerUser("ana@example.com");
      const file = await uploadOk(cookie, "dez.pdf", "0123456789", { type: "application/pdf" });
      const get = (range?: string) =>
        api(`/api/files/${file.id}/preview`, { cookie, headers: range ? { Range: range } : {} });
      return { get };
    }

    it("sem Range devolve tudo (200) e anuncia que aceita intervalos", async () => {
      const { get } = await setup();
      const res = await get();
      expect(res.status).toBe(200);
      expect(res.headers.get("content-length")).toBe("10");
      expect(res.headers.get("accept-ranges")).toBe("bytes");
      expect(await bodyText(res)).toBe("0123456789");
    });

    it("bytes=0-3 devolve 206 com Content-Range", async () => {
      const { get } = await setup();
      const res = await get("bytes=0-3");
      expect(res.status).toBe(206);
      expect(res.headers.get("content-range")).toBe("bytes 0-3/10");
      expect(res.headers.get("content-length")).toBe("4");
      expect(await bodyText(res)).toBe("0123");
    });

    it("bytes=4- devolve do 4 até ao fim e bytes=-3 devolve os últimos 3", async () => {
      const { get } = await setup();
      const rest = await get("bytes=4-");
      expect(rest.status).toBe(206);
      expect(rest.headers.get("content-range")).toBe("bytes 4-9/10");
      expect(await bodyText(rest)).toBe("456789");
      const tail = await get("bytes=-3");
      expect(tail.status).toBe(206);
      expect(tail.headers.get("content-range")).toBe("bytes 7-9/10");
      expect(await bodyText(tail)).toBe("789");
    });

    it("um intervalo que começa depois do fim dá 416", async () => {
      const { get } = await setup();
      const res = await get("bytes=50-");
      expect(res.status).toBe(416);
      expect(res.headers.get("content-range")).toBe("bytes */10");
    });

    it("um fim para lá do tamanho é limitado ao último byte, tal como um sufixo maior do que o ficheiro", async () => {
      const { get } = await setup();
      for (const range of ["bytes=0-100", "bytes=-100"]) {
        const res = await get(range);
        expect(res.status, range).toBe(206);
        expect(res.headers.get("content-range"), range).toBe("bytes 0-9/10");
        expect(res.headers.get("content-length"), range).toBe("10");
        expect(await bodyText(res), range).toBe("0123456789");
      }
    });

    it("um intervalo invertido (bytes=5-2) é ignorado e devolve o ficheiro todo", async () => {
      const { get } = await setup();
      const res = await get("bytes=5-2");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-range")).toBeNull();
      expect(await bodyText(res)).toBe("0123456789");
    });

    it("um sufixo de zero bytes e um início no fim do ficheiro dão 416", async () => {
      const { get } = await setup();
      for (const range of ["bytes=-0", "bytes=10-", "bytes=10-12"]) {
        const res = await get(range);
        expect(res.status, range).toBe(416);
        expect(res.headers.get("content-range"), range).toBe("bytes */10");
      }
    });

    it("números enormes: um início assim dá 416; um fim ou um sufixo assim contam como 'até ao fim'", async () => {
      const { get } = await setup();
      const huge = "99999999999999999999";
      expect((await get(`bytes=${huge}-`)).status).toBe(416);
      for (const range of [`bytes=0-${huge}`, `bytes=-${huge}`]) {
        const res = await get(range);
        expect(res.status, range).toBe(206);
        expect(res.headers.get("content-range"), range).toBe("bytes 0-9/10");
      }
    });

    it("num ficheiro vazio qualquer intervalo dá 416 com Content-Range bytes */0", async () => {
      const { cookie } = await registerUser("ana@example.com");
      const empty = await uploadOk(cookie, "vazio.pdf", "", { type: "application/pdf" });
      for (const range of ["bytes=-5", "bytes=0-", "bytes=0-0"]) {
        const res = await api(`/api/files/${empty.id}/preview`, { cookie, headers: { Range: range } });
        expect(res.status, range).toBe(416);
        expect(res.headers.get("content-range"), range).toBe("bytes */0");
      }
      expect((await api(`/api/files/${empty.id}/preview`, { cookie })).status).toBe(200); // sem Range, o ficheiro vazio
    });

    it("formatos não suportados são ignorados e devolvem o ficheiro todo", async () => {
      const { get } = await setup();
      for (const range of ["bytes=abc", "bytes=0-1,3-4", "items=0-1", "bytes=-"]) {
        const res = await get(range);
        expect(res.status, range).toBe(200);
        expect(await bodyText(res)).toBe("0123456789");
      }
    });
  });

  it("devolve 404 para ficheiros de outro utilizador ou na lixeira e exige sessão", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const doBob = await uploadOk(bob.cookie, "a.png", "x");
    const minha = await uploadOk(ana.cookie, "b.png", "x");
    await trash(minha.id);
    expect((await api(`/api/files/${doBob.id}/preview`, { cookie: ana.cookie })).status).toBe(404);
    expect((await api(`/api/files/${minha.id}/preview`, { cookie: ana.cookie })).status).toBe(404);
    expect((await api(`/api/files/${doBob.id}/preview`)).status).toBe(401);
  });
});
