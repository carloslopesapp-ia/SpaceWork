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

**Plano 2 (pastas e ficheiros)**
- Aplicar `requireAuth` ao nível do router (`use("*", requireAuth)`) e testar que todas as rotas privadas dão 401 sem cookie.
- Reserva de quota numa só `batch`: o `UPDATE users SET used_bytes` só corre se o `INSERT` do ficheiro aconteceu (`WHERE EXISTS (SELECT 1 FROM files WHERE id = ?)`); o 413 deteta-se por `meta.changes === 0`. Nunca decidir a quota a partir de `c.get("user").usedBytes`.
- Testar `isUniqueViolation` com uma `batch`; fazer o `onError` tratar `HTTPException` do Hono e só depois acrescentar `bodyLimit`; limitar o tamanho do corpo JSON.
- Migração `0002` com índices nas chaves estrangeiras `files.folder_id`, `folders.parent_id` e `shares.user_id`.
- Decidir: normalização NFC e distinção de maiúsculas nos nomes; colisão entre pasta e ficheiro com o mesmo nome (o esquema não a impede); `pending` ocupa o nome até o cron o limpar (até 1 h).
- Mover `validation.ts` (ou pelo menos `PASSWORD_MIN/MAX_LENGTH`) para `src/shared`. Atenção: o `scripts/seed-master.ts` importa `crypto.ts` e `validation.ts` **com extensão `.ts`** diretamente em Node; se algum deles passar a importar algo sem extensão, o seed só rebenta em execução. Usar `module: nodenext` no `tsconfig.node.json` ou manter esses ficheiros sem imports.
- Frontend: tratamento central do 401 (invalidar `ME_KEY`), mensagem de falha de rede em português (hoje aparece "Failed to fetch"), "Sair" com feedback de erro, botão de repetir no estado de erro do layout, testes do contrato `apiFetch`/`useMe`, invalidar `ME_KEY` depois de uploads e exclusões, substituir o marcador de posição da `HomePage`.
- Respostas de descarga e pré-visualização: `Cache-Control: private, no-store` e `Content-Security-Policy: sandbox`.
- Testes de esquema em falta (`used_bytes >= 0`, `CHECK` de `status`).

**Plano 3 (lixeira, pesquisa, partilha)**
- Decrementos de quota com `MAX(used_bytes - ?, 0)`, para um desvio de contabilidade não fazer falhar a `batch` para sempre.
- Testes de `shares` (`token_hash` único, `ON DELETE CASCADE` de `file_id`).

**Plano 4 (admin e manutenção)**
- Suspender uma conta tem de **apagar as suas sessões** (o filtro por `status` não chega: ao reativar, as sessões antigas voltariam a valer).
- Troca de senha: `UPDATE` da senha e revogação das outras sessões numa só `db.batch`.
- O cron purga `login_failures` com mais de 1 dia; uma conta `deleting` continua a ocupar o email no registo até ser removida; apagar as pastas depois dos ficheiros (chaves estrangeiras); índices para as varreduras do cron (`pending` por `created_at`, lixeira por `deleted_at`).
- Teste que fixe a forma exata do `user` nas respostas (sem `password_hash`), sobretudo em `GET /api/admin/users`; correr `npm run cf-typegen` quando o cron entrar em `wrangler.jsonc`.

**Plano 5 (deploy)**
- Medir o CPU do PBKDF2 no plano gratuito (10 ms): login, registo e troca de senha (esta faz 2 PBKDF2); trocar `getDummyHash` por uma constante pré-calculada; ativar `observability`.
- `/api/health` com `try/catch`; `Cache-Control: no-store` e CSP nas respostas da API/SPA; no seed, a dica de migrações escolhida pelo destino (`db:migrate:remote` com `--remote`).
- README: os comandos `--remote` só funcionam depois de criar a D1 de produção (o `database_id` do `wrangler.jsonc` é provisório).

**Decisão do dono (spec)**
- O registo é aberto e cada conta traz 1 GiB de R2 e um PBKDF2: não há limite de ritmo. Opções: regra de *rate limiting* da Cloudflare em `/api/auth/*` ou uma variável para fechar o registo.
