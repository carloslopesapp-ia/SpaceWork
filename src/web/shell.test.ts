import { describe, expect, it } from "vitest";
import css from "./index.css?raw";
import html from "../../index.html?raw";
import headers from "../../public/_headers?raw";

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
});
