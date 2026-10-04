# SpaceWork — Planos de implementação

A [especificação](../specs/2026-10-03-spacework-design.md) é implementada em cinco planos sequenciais. Cada plano entrega software que funciona e se testa sozinho. Os planos 2 a 5 só são escritos depois de o anterior estar concluído, porque dependem do que se aprende ao executá-lo (versões reais, comportamento das ferramentas).

| # | Plano | Entrega | Estado |
|---|---|---|---|
| 1 | [Fundação](2026-10-03-01-fundacao.md) | Projeto Cloudflare, esquema D1, autenticação completa (registo, login, logout, alterar senha), master, interface de login/registo/conta | Concluído |
| 2A | [API de pastas e ficheiros](2026-10-03-02a-api-pastas-ficheiros.md) | Pastas (listar, criar, renomear, mover, excluir vazias), upload com quota atómica, descarregar, pré-visualizar, renomear, mover e excluir ficheiros; isolamento entre utilizadores | Escrito |
| 2B | Interface "Meu espaço" | Lista, caminho (*breadcrumb*), nova pasta, upload com progresso, menu de ações, mover, pré-visualização | Por escrever |
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

## Pendentes herdados do Plano 1

Resultado da revisão final do ramo do Plano 1 (achados diferidos de propósito). Cada plano seguinte deve tratar o que lhe cabe:

**Plano 2 (pastas e ficheiros): resolvido no Plano 2A**
- Resolvido: `requireAuth` ao nível do router (`createAuthedRouter()`), com uma varredura (`test/authz.test.ts`) que testa que todas as rotas registadas em `app`, exceto as públicas listadas (`GET /api/health`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`), dão 401 sem cookie. Um router novo criado com `new Hono()` sem autenticação faz o teste falhar, seja qual for o prefixo.
- Resolvido: reserva de quota numa só `batch` (o `UPDATE users` só corre se o `INSERT` aconteceu; o 413 deteta-se por `meta.changes`), sem usar o `usedBytes` da sessão.
- Resolvido: `isUniqueViolation` e `isForeignKeyViolation` testadas com `batch`, e o helper `rethrowConstraint` (409 e 404) nas quatro escritas; `onError` trata `HTTPException`; corpos JSON limitados a 64 KiB (`jsonBodyLimit`).
- Resolvido: migração `0002` com os índices de `files.folder_id`, `folders.parent_id` e `shares.user_id`.
- Resolvido: regras de nomes decididas e registadas na spec, secção 3 (NFC, 255 em unidades UTF-16, maiúsculas distintas, pasta e ficheiro com o mesmo nome permitidos, `pending` a ocupar o nome, sem controlos C0/C1, bidi nem *surrogates* isolados).
- Resolvido: `validation.ts` e `names.ts` em `src/shared`; o `tsconfig.node.json` usa `module: NodeNext` (o seed importa `crypto.ts` e `validation.ts` com extensão `.ts`: esses ficheiros não podem importar nada sem extensão).
- Resolvido: testes de esquema em falta (`used_bytes >= 0`, `CHECK` de `status`) em `test/schema-constraints.test.ts`.
- Resolvido em parte: as respostas de descarga e de pré-visualização levam `Cache-Control: no-store` (cabeçalho global da API). O CSP `sandbox` ficou feito só na pré-visualização de imagens (o PDF precisa do leitor do browser). **Falta decidir o caso do descarregamento** (`Content-Disposition: attachment`): confirmar no Plano 5, com o Playwright.

**Plano 2B (interface "Meu espaço")**
- Herdado do Plano 1 (frontend): tratamento central do 401 (invalidar `ME_KEY`), mensagem de falha de rede em português (hoje aparece "Failed to fetch"), "Sair" com feedback de erro, botão de repetir no estado de erro do layout, testes do contrato `apiFetch`/`useMe`, invalidar `ME_KEY` depois de uploads e exclusões, substituir o marcador de posição da `HomePage`.
- Novo (revisão final do 2A): expor `maxUploadBytes` (em `/api/auth/me` ou num `GET /api/config`) e validar o tamanho no cliente antes do XHR: um corpo acima do limite da Cloudflare recebe da *edge* um 413 que não é JSON.
- Novo: construir o URL do upload com `URLSearchParams`/`encodeURIComponent` (o Hono decodifica `+` como espaço).
- Novo: mover `PREVIEW_TYPES`/`previewContentType` para `src/shared`, para o menu só mostrar "Pré-visualizar" quando o servidor a aceita.
- Novo: exportar uma união `ApiErrorCode` em `src/shared/types.ts` e mapeá-la para mensagens em português.
- Novo: invalidar `ME_KEY` e as consultas de `contents` e `tree` depois de cada mutação.
- Novo: evitar miniaturas via `/preview` (o `no-store` impede a cache).
- Novo: um 409 `name_taken` pode vir de um upload `pending` invisível: a mensagem deve sugerir isso.
- Novo: no diálogo "Mover", desativar a própria pasta e as suas descendentes.

**Plano 3 (lixeira, pesquisa, partilha)**
- Decrementos de quota com `MAX(used_bytes - ?, 0)`, para um desvio de contabilidade não fazer falhar a `batch` para sempre.
- Testes de `shares` (`token_hash` único, `ON DELETE CASCADE` de `file_id`).
- Novo (revisão final do 2A): montar o `jsonBodyLimit` por construção (global em `/api/*`, exceto `PUT /api/files`), em vez de rota a rota.
- Novo: na pesquisa, calcular os caminhos dos até 50 resultados numa só consulta (nunca um `breadcrumbFor` por resultado: o limite do plano gratuito é 50 subpedidos por invocação).
- Novo: nos decrementos de quota, preferir `UPDATE ... WHERE EXISTS (linha)` antes do `DELETE` a depender de `changes()` entre instruções da `batch`.
- Novo: extrair de `routes/files.ts` os helpers de servir ficheiros (cabeçalhos, `parseRange`, `missingObject`) para o descarregamento público.
- Novo: no restauro com sufixo, respeitar o limite de 255 e as linhas `pending`.

**Plano 4 (admin e manutenção)**
- Suspender uma conta tem de **apagar as suas sessões** (o filtro por `status` não chega: ao reativar, as sessões antigas voltariam a valer).
- Troca de senha: `UPDATE` da senha e revogação das outras sessões numa só `db.batch`.
- O cron purga `login_failures` com mais de 1 dia; uma conta `deleting` continua a ocupar o email no registo até ser removida; apagar as pastas depois dos ficheiros (chaves estrangeiras); índices para as varreduras do cron (`pending` por `created_at`, lixeira por `deleted_at`).
- Teste que fixe a forma exata do `user` nas respostas (sem `password_hash`), sobretudo em `GET /api/admin/users`; correr `npm run cf-typegen` quando o cron entrar em `wrangler.jsonc`.
- Novo (revisão final do 2A): no cron dos `pending`, o corte de idade tem de ser maior do que a duração máxima de um upload, e o `UPDATE ... 'ready'` (em `routes/files.ts`) passa a `AND status = 'pending'` com `meta.changes` verificado.
- Novo: índice parcial `files (created_at) WHERE status = 'pending'`.
- Novo: apagar os objetos de uma conta pelo prefixo `u/<userId>/` (apanha também os órfãos de `releaseReservation`).
- Novo: as pastas de uma conta apagam-se com um só `DELETE ... WHERE user_id = ?`, depois dos ficheiros.

**Plano 5 (deploy)**
- Medir o CPU do PBKDF2 no plano gratuito (10 ms): login, registo e troca de senha (esta faz 2 PBKDF2); trocar `getDummyHash` por uma constante pré-calculada; ativar `observability`.
- `/api/health` com `try/catch`; `Cache-Control: no-store` e CSP nas respostas da API/SPA; no seed, a dica de migrações escolhida pelo destino (`db:migrate:remote` com `--remote`).
- README: os comandos `--remote` só funcionam depois de criar a D1 de produção (o `database_id` do `wrangler.jsonc` é provisório).
- Novo (revisão final do 2A): confirmar se o limite de 100 MB do corpo na Cloudflare é decimal ou binário face a `MAX_UPLOAD_BYTES = 104857600`.
- Novo: medir na D1 de produção o efeito de uma consulta longa (cada base processa uma consulta de cada vez).
- Novo: decidir o CSP `sandbox` no descarregamento (ver Plano 2) e confirmá-lo com o Playwright.

**Decisão do dono (spec)**
- O registo é aberto e cada conta traz 1 GiB de R2 e um PBKDF2: não há limite de ritmo. Opções: regra de *rate limiting* da Cloudflare em `/api/auth/*` ou uma variável para fechar o registo.
