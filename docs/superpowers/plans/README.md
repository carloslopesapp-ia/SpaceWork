# SpaceWork — Planos de implementação

A [especificação](../specs/2026-10-03-spacework-design.md) é implementada em cinco planos sequenciais. Cada plano entrega software que funciona e se testa sozinho. Os planos 2 a 5 só são escritos depois de o anterior estar concluído, porque dependem do que se aprende ao executá-lo (versões reais, comportamento das ferramentas).

| # | Plano | Entrega | Estado |
|---|---|---|---|
| 1 | [Fundação](2026-10-03-01-fundacao.md) | Projeto Cloudflare, esquema D1, autenticação completa (registo, login, logout, alterar senha), master, interface de login/registo/conta | Concluído |
| 2A | [API de pastas e ficheiros](2026-10-03-02a-api-pastas-ficheiros.md) | Pastas (listar, criar, renomear, mover, excluir vazias), upload com quota atómica, descarregar, pré-visualizar, renomear, mover e excluir ficheiros; isolamento entre utilizadores | Concluído |
| 2B | [Interface "Meu espaço"](2026-10-03-02b-interface-meu-espaco.md) | Lista, caminho (*breadcrumb*), nova pasta, upload com progresso (3 em paralelo), menu de ações, mover, pré-visualização de imagens e PDF; API: `GET /api/config`, limite de 100 níveis nas pastas | Concluído |
| 3A | [API da lixeira, pesquisa e partilha](2026-10-03-03a-api-lixeira-pesquisa-partilha.md) | Lixeira (listar, restaurar com sufixo, eliminar de vez, esvaziar), pesquisa por nome com o caminho de cada resultado, links de partilha (criar com validade, listar, revogar) e as rotas públicas de nome, tamanho e descarregamento | Concluído |
| 3B | Interface da lixeira, pesquisa e partilha | Ecrã `/lixeira`, caixa de pesquisa, diálogo «Partilhar» e página pública `/s/:token` | Por escrever |
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

**Plano 2B (interface "Meu espaço"): resolvido no Plano 2B**
- Resolvido: tratamento central do 401 (`setUnauthorizedHandler`: `["me"]` passa a `null` e o layout vai para o login), falha de rede em português, «Sair» com erro, botão de repetir no erro do layout, testes de `apiFetch`/`useMe`, e `["me"]`, as listagens (`["folder", …]`) e a árvore (`["tree"]`) invalidados depois de cada mutação e de cada envio.
- Resolvido: `GET /api/config` (`maxUploadBytes`) e validação do tamanho no cliente antes do XHR; URL do upload com `URLSearchParams`; `previewContentType` em `src/shared` (o menu só mostra «Pré-visualizar» quando o servidor a aceita); sem miniaturas; o 409 `name_taken` de ficheiros diz que pode ser um envio em curso; o diálogo «Mover» desativa a pasta atual e, ao mover uma pasta, ela e as descendentes; `test/names.test.ts` com escapes `\u…`; profundidade máxima de 100 níveis nas pastas (`400 folder_too_deep`; ao mover conta a subárvore).
- Decidido não fazer: a união `ApiErrorCode` e o mapa de mensagens. O servidor já responde em português e a interface só mostra `message`; exportar a união quando a interface precisar de decidir por código.
- Fica para o Plano 5 (Playwright, browser real): no diálogo de pré-visualização de um PDF, o leitor do Chrome fica com o foco depois de carregar e o Esc não fecha o diálogo (o botão «Fechar», o clique no fundo e o Tab funcionam; tentou-se devolver o foco ao botão no `onLoad`, mas o leitor volta a tomá-lo meio segundo depois); confirmar também o arrastar-e-largar e o envio com `Content-Length` num browser real.
- Fica para o Plano 3: o ecrã da lixeira. Até lá, «Excluir» num ficheiro só o manda para a lixeira e o espaço não é libertado.

**Plano 3 (lixeira, pesquisa, partilha): a API ficou no Plano 3A; a interface é o Plano 3B**
- Resolvido no 3A: decrementos de quota com `MAX(used_bytes - ?, 0)` e, ao desfazer uma reserva, `UPDATE ... WHERE EXISTS` antes do `DELETE` (sem depender de `changes()`); testes de `shares` (`token_hash` único, `ON DELETE CASCADE`); o limite do corpo (64 KiB) montado em `/api/*`, menos o upload; os caminhos dos resultados da pesquisa e da lixeira numa só consulta por bloco de 50 pastas (`pathsForFolders`); os ajudantes de servir ficheiros em `lib/serve.ts`; o restauro com sufixo (respeita os 255 caracteres e as linhas `pending`); a mensagem `name_taken` dos ficheiros numa só função, com teste; testes de isolamento de `subtreeHeight`, de pastas largas e da guarda do `UPDATE_FOLDER_SQL`.
- Para o 3B (interface): esvaziar a lixeira repete `DELETE /api/trash` até `remaining` ser 0 (ou `purged` ser 0); a lixeira lista no máximo 200 (`total` conta todos); o link completo só se mostra uma vez, na criação (`token` da resposta de `POST /api/files/:id/shares`); extrair o código comum de `FolderActions`/`FileActions` quando entrar «Partilhar»; dividir o contexto dos envios (itens e ações) para a lista não re-renderizar a cada evento de progresso; um refresh por ficheiro enviado (agrupar quando a fila fica ociosa); «Sair» com envios em curso cancela-os em silêncio: avisar antes; faltam testes dos hooks `useDeleteFolder`/`useUpdateFile`; `formatDate` com `NaN`.
- Fica sem plano: `breadcrumbFor` corre duas vezes por movimento de pasta (uma em `wouldCreateCycle` e outra em `assertFitsBelow`); se outro separador do mesmo browser termina a sessão e entra com outra conta, a fila de um separador antigo pode enviar ficheiros da raiz para a conta nova (solução robusta com `BroadcastChannel` ou com verificação do dono do envio no servidor).

**Plano 4 (admin e manutenção)**
- Suspender uma conta tem de **apagar as suas sessões** (o filtro por `status` não chega: ao reativar, as sessões antigas voltariam a valer).
- Troca de senha: `UPDATE` da senha e revogação das outras sessões numa só `db.batch`.
- O cron purga `login_failures` com mais de 1 dia; uma conta `deleting` continua a ocupar o email no registo até ser removida; apagar as pastas depois dos ficheiros (chaves estrangeiras); índices para as varreduras do cron (`pending` por `created_at`, lixeira por `deleted_at`).
- Teste que fixe a forma exata do `user` nas respostas (sem `password_hash`), sobretudo em `GET /api/admin/users`; correr `npm run cf-typegen` quando o cron entrar em `wrangler.jsonc`.
- Novo (revisão final do 2A): no cron dos `pending`, o corte de idade tem de ser maior do que a duração máxima de um upload, e o `UPDATE ... 'ready'` (em `routes/files.ts`) passa a `AND status = 'pending'` com `meta.changes` verificado.
- Novo: índice parcial `files (created_at) WHERE status = 'pending'`.
- Novo: apagar os objetos de uma conta pelo prefixo `u/<userId>/` (apanha também os órfãos de `releaseReservation`).
- Novo: as pastas de uma conta apagam-se com um só `DELETE ... WHERE user_id = ?`, depois dos ficheiros.
- Novo (3A): o cron da lixeira usa `purgeTrashed` (`lib/trash.ts`, no máximo 50 ficheiros por chamada), que já desconta a quota e tira os objetos do R2; se o R2 falhar o objeto fica órfão e só aparece no registo (a varredura pelo prefixo `u/<userId>/` também os apanha). O cron apaga ainda as partilhas revogadas ou expiradas há mais de 30 dias (as de ficheiros eliminados saem em cascata).

**Plano 5 (deploy)**
- Medir o CPU do PBKDF2 no plano gratuito (10 ms): login, registo e troca de senha (esta faz 2 PBKDF2); trocar `getDummyHash` por uma constante pré-calculada; ativar `observability`.
- `/api/health` com `try/catch`; `Cache-Control: no-store` e CSP nas respostas da API/SPA; no seed, a dica de migrações escolhida pelo destino (`db:migrate:remote` com `--remote`).
- README: os comandos `--remote` só funcionam depois de criar a D1 de produção (o `database_id` do `wrangler.jsonc` é provisório).
- Novo (revisão final do 2A): confirmar se o limite de 100 MB do corpo na Cloudflare é decimal ou binário face a `MAX_UPLOAD_BYTES = 104857600`.
- Novo: medir na D1 de produção o efeito de uma consulta longa (cada base processa uma consulta de cada vez).
- Novo: decidir o CSP `sandbox` no descarregamento (ver Plano 2) e confirmá-lo com o Playwright.
- Novo (revisão final do 2B), passagem de acessibilidade e de browser real (Playwright): as cargas que não passam pelo `apiFetch` (a imagem e o `<iframe>` da pré-visualização, a ligação «Descarregar») não passam pelo tratamento do 401: com a sessão expirada ou um ficheiro apagado mostram um erro genérico ou o JSON; `Modal` sem alternativa quando o botão de origem desaparece (depois de mover ou excluir o foco cai para `<body>`) e sem bloqueio do scroll nem `inert`; `ConfirmDialog` sem `aria-describedby` e com «A excluir…» fixo; `NameDialog` com o erro local a persistir e sem testes de Esc/Enter; `RowMenu` sem Home/End nem abrir com ArrowDown e a rebentar com `actions` vazio; `Breadcrumb` sem `break-all` (rolagem horizontal no telemóvel); botão `danger` com o anel de foco índigo; «A carregar…» sem `role="status"` e a lista pisca ao mudar de pasta; `PreviewDialog` deixa o Tab sair do `<iframe>`.
- Novo: zona de largar — texto largado num diálogo é engolido e um ficheiro largado sobre um diálogo é enviado; faltam testes do contador e do realce; sem limite de tamanho (`Infinity`) enquanto `GET /api/config` não chega (o servidor impõe-no na mesma); verificar o arrastar-e-largar e o envio com `Content-Length` num browser real.
- Novo (manutenção dos testes): `test:watch` só vigia o Worker; `mockApi` casa a primeira rota; `errorMessage` mostra o texto de qualquer `Error`; `UploadManager` sem proteção se o `upload` injetado lançar em modo síncrono, e o `onSettled` recebe o estado «uploading» num cancelamento; `isFileBody` fraco; o teste do ciclo em `tree.test.ts` não alcança a guarda `seen`; o teste «sem tentar de novo» só passa porque o cliente de teste não repete (usar `createQueryClient()`); o teste ligado à classe `bg-indigo-50`; `pathname.startsWith("/pasta/")` repetido no layout.

**Decisão do dono (spec)**
- O registo é aberto e cada conta traz 1 GiB de R2 e um PBKDF2: não há limite de ritmo. Opções: regra de *rate limiting* da Cloudflare em `/api/auth/*` ou uma variável para fechar o registo.
