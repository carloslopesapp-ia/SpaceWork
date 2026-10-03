# SpaceWork — Planos de implementação

A [especificação](../specs/2026-10-03-spacework-design.md) é implementada em cinco planos sequenciais. Cada plano entrega software que funciona e se testa sozinho. Os planos 2 a 5 só são escritos depois de o anterior estar concluído, porque dependem do que se aprende ao executá-lo (versões reais, comportamento das ferramentas).

| # | Plano | Entrega | Estado |
|---|---|---|---|
| 1 | [Fundação](2026-10-03-01-fundacao.md) | Projeto Cloudflare, esquema D1, autenticação completa (registo, login, logout, alterar senha), master, interface de login/registo/conta | Escrito |
| 2 | Pastas e ficheiros | CRUD de pastas, upload com quota, descarregar, pré-visualizar, renomear, mover; ecrã "Meu espaço" | Por escrever |
| 3 | Lixeira, pesquisa e partilha | Lixeira com restauro, pesquisa por nome, links públicos e página `/s/:token` | Por escrever |
| 4 | Admin e manutenção | Painel de utilizadores e quotas, remoção de contas, cron de limpeza | Por escrever |
| 5 | Deploy e testes de ponta a ponta | Recursos na Cloudflare, `wrangler deploy`, teste Playwright de fumo, medição de CPU do PBKDF2 | Por escrever |

## Factos verificados que os planos seguintes devem respeitar

Verificados a 2026-10-03 com a documentação oficial e um ensaio local (ver spec, secção 13):

- Pacote de testes: `@cloudflare/vitest-plugin` com **Vitest `^4.1`** (o Vitest 5 não é compatível). Configuração com `cloudflareTest(...)` em `vitest.config.ts`. Os testes importam `env` e `exports` de `cloudflare:workers` e chamam a aplicação com `exports.default.fetch(...)`.
- O estado da D1 **não** é isolado entre testes do mesmo ficheiro: cada ficheiro de teste chama `resetDb()` num `beforeEach`.
- `wrangler.jsonc` precisa de `assets.run_worker_first: ["/api/*"]`; sem isso, links de descarga (pedidos de navegação) seriam servidos como `index.html`.
- R2: `put` com *stream* exige comprimento conhecido (`request.body` com `Content-Length`); `delete` aceita até 1000 chaves.
- D1: `batch()` é transacional; uma violação de unicidade tem a mensagem `UNIQUE constraint failed`; chaves estrangeiras ativas.
- Plano gratuito do Workers: 10 ms de CPU e 50 subpedidos por invocação (as chamadas a D1 e R2 contam). Planos Free e Pro: corpo de pedido até 100 MB.
- **Não usar `node_modules` como *symlink*** (o npm 11 substitui-o e o plugin de testes deixa de funcionar). Preferir desenvolver fora do iCloud.
- `npm install` mostra avisos `allow-scripts` (scripts de instalação bloqueados por defeito no npm 11). São inofensivos: testes, build e `vite dev` funcionam.
