import { describe, expect, it } from "vitest";
import css from "./index.css?raw";
import html from "../../index.html?raw";
import headers from "../../public/_headers?raw";
import wrangler from "../../wrangler.jsonc?raw";

// A página pública de um link (`/s/:token`) traz o token no endereço: nada do que o browser carrega para a mostrar pode vir de outra origem
// (um pedido a terceiros revelava o endereço no `Referer` e deixava um terceiro saber que o link foi aberto).
const EXTERNAL = /https?:\/\/|=\s*["']\/\//i;

describe("a casca da aplicação", () => {
  it("index.html e o CSS de entrada não carregam nada de outras origens", () => {
    expect(html, "index.html").not.toMatch(EXTERNAL);
    expect(css, "src/web/index.css").not.toMatch(EXTERNAL);
  });

  it("os cabeçalhos estáticos não deixam o endereço da página sair da origem (Referrer-Policy)", () => {
    expect(headers).toMatch(/^\s*Referrer-Policy:\s*(same-origin|no-referrer)\s*$/m);
  });

  it("a política de segurança de conteúdo (CSP) só deixa a página carregar e contactar a própria origem", () => {
    const csp = /^\s*Content-Security-Policy:\s*(.+)$/m.exec(headers)?.[1] ?? "";
    const directives = Object.fromEntries(
      csp
        .split(";")
        .map((part) => part.trim().split(/\s+/))
        .filter((part) => part[0] !== "")
        .map(([name, ...sources]) => [name, sources]),
    );
    expect(directives["default-src"]).toEqual(["'self'"]);
    // Scripts só da própria origem: nada inline e nada de eval (a defesa principal contra um XSS).
    expect(directives["script-src"]).toEqual(["'self'"]);
    // O React escreve os estilos pelo CSSOM, que a CSP não bloqueia: nada de `unsafe-inline` (nem de `unsafe-eval`) em lado nenhum.
    expect(directives["style-src"]).toEqual(["'self'"]);
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(directives["connect-src"]).toEqual(["'self'"]);
    expect(directives["img-src"]).toEqual(["'self'"]);
    expect(directives["frame-src"]).toEqual(["'self'"]);
    expect(directives["form-action"]).toEqual(["'self'"]);
    expect(directives["frame-ancestors"]).toEqual(["'self'"]);
    expect(directives["object-src"]).toEqual(["'none'"]);
    expect(directives["base-uri"]).toEqual(["'none'"]);
    // O conjunto de diretivas é fixo: uma diretiva nova (ou mais larga) tem de ser uma decisão, não um acidente.
    expect(Object.keys(directives).sort()).toEqual([
      "base-uri",
      "connect-src",
      "default-src",
      "form-action",
      "frame-ancestors",
      "frame-src",
      "img-src",
      "object-src",
      "script-src",
      "style-src",
    ]);
    expect(csp, "CSP").not.toMatch(EXTERNAL);
  });
});

describe("a configuração de registos do Worker", () => {
  it("o `observability` está ligado, mas sem os registos de invocação (levariam o token de cada link de partilha, que vai no caminho do URL)", () => {
    const config = JSON.parse(wrangler) as { observability?: { enabled?: boolean; logs?: { invocation_logs?: boolean } } };
    expect(config.observability?.enabled).toBe(true);
    expect(config.observability?.logs?.invocation_logs).toBe(false);
  });
});
