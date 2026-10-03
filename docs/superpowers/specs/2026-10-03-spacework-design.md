# SpaceWork — Design

Data: 2026-10-03 · Estado: **rascunho para revisão**

## 1. Objetivo

Aplicação web, alojada na Cloudflare, para gerir espaço em disco na cloud (ao estilo do Google Drive ou Dropbox): cada utilizador autentica-se com email e senha, organiza os seus ficheiros (imagens, PDF, Word, CSV, etc.) em pastas, e pode carregar, descarregar, mover, excluir, pesquisar e partilhar por link. Existe um utilizador **master (admin)** que gere contas e quotas.

### Decisões já tomadas com o utilizador

| Tema | Decisão |
|---|---|
| Tipo de app | Web app (browser, desktop e telemóvel). Sem app nativa. |
| Hospedagem | Cloudflare: Worker + assets estáticos, D1 (base de dados), R2 (ficheiros). |
| Master | Admin com painel de utilizadores: ver utilização, definir quota, suspender/reativar, apagar contas. Não vê o conteúdo dos ficheiros dos outros. |
| Registo | Aberto. Quota inicial de 1 GiB por defeito, editável pelo master. Sem confirmação de email. |
| Tamanho máximo de ficheiro | 100 MB (upload simples pelo Worker). |
| Extras na v1 | Lixeira com restauro, pré-visualização de imagens e PDF, pesquisa por nome, partilha por link público. |
| Eliminar pasta | Só se estiver **vazia**. |
| Idioma da interface | Português europeu. |
| Conta Cloudflare | Já existe, com R2 ativo. |

## 2. Arquitetura

Um **único Worker** (Hono, TypeScript) que:

- serve a API em `/api/*`;
- serve a SPA React (build do Vite) como assets estáticos, com *fallback* para `index.html` nas rotas do cliente;
- tem um *cron* de manutenção (hora a hora).

Bindings: `DB` (D1), `FILES` (R2). Variáveis de configuração:

| Variável | Valor por defeito |
|---|---|
| `DEFAULT_QUOTA_BYTES` | 1073741824 (1 GiB) |
| `MAX_UPLOAD_BYTES` | 104857600 (100 MiB) |
| `TRASH_RETENTION_DAYS` | 30 |
| `SESSION_TTL_DAYS` | 14 |

Mesma origem para frontend e API: não há CORS e os cookies de sessão são simples.

**Decisão central:** no R2 a chave de cada ficheiro é opaca, `u/{userId}/{fileId}`, sem nome nem caminho. Pastas, nomes e hierarquia vivem só na D1. Mover e renomear são, por isso, operações exclusivamente na base de dados, sem copiar bytes.

### Stack

TypeScript em todo o código. Backend: Hono. Frontend: React, React Router, TanStack Query, Tailwind CSS, Vite (com `@cloudflare/vite-plugin`). Testes: Vitest com `@cloudflare/vitest-pool-workers` e Playwright. As versões exatas escolhem-se no arranque do projeto, usando as atuais.

## 3. Modelo de dados (D1)

IDs: `crypto.randomUUID()` (texto). Datas: inteiros (milissegundos Unix). As chaves estrangeiras estão ativas (por defeito na D1) e servem de rede de segurança.

**`users`**: `id`, `email` (único, minúsculas), `password_hash`, `role` (`admin` | `user`), `status` (`active` | `suspended` | `deleting`), `quota_bytes`, `used_bytes` (por defeito 0), `created_at`.
`password_hash` tem o formato `pbkdf2-sha256$<iterações>$<salt_b64>$<hash_b64>`.

**`sessions`**: `token_hash` (PK, SHA-256 do token), `user_id`, `created_at`, `expires_at`.

**`login_failures`**: `email`, `failed_at` (índice por `email`).

**`folders`**: `id`, `user_id`, `parent_id` (nulo = raiz, FK para `folders`), `name`, `name_norm`, `created_at`.
Índice único em `(user_id, COALESCE(parent_id, ''), name)`.

**`files`**: `id`, `user_id`, `folder_id` (nulo = raiz, FK para `folders`), `name`, `name_norm`, `size`, `mime`, `r2_key`, `status` (`pending` | `ready`), `created_at`, `deleted_at` (nulo = não está na lixeira).
Índice único parcial em `(user_id, COALESCE(folder_id, ''), name)` onde `deleted_at IS NULL`.

**`shares`**: `id`, `token_hash` (único), `file_id` (FK para `files`, `ON DELETE CASCADE`), `user_id`, `created_at`, `expires_at` (opcional), `revoked_at` (opcional).

`name_norm` é o nome em minúsculas e sem acentos, calculado no Worker, usado na pesquisa.

### Regras de nomes

- 1 a 255 caracteres, sem `/`, sem caracteres de controlo, diferentes de `.` e `..`, com espaços nas pontas removidos.
- Nomes únicos dentro da mesma pasta (entre itens não apagados). Um conflito devolve 409.

## 4. Autenticação e segurança

### Registo e login

- Email normalizado (trim + minúsculas, máx. 254 caracteres). Senha de 8 a 128 caracteres.
- O registo cria sempre `role = user`, `status = active`, `quota_bytes = DEFAULT_QUOTA_BYTES`, e inicia sessão. Um email já existente devolve 409 (a enumeração de emails pelo registo é um compromisso aceite na v1).
- O login devolve sempre o erro genérico "email ou senha inválidos". Quando o email não existe, é feita na mesma uma verificação de hash "falsa", para não haver diferença de tempo. Só depois de a senha estar correta se revela que a conta está suspensa (403). Contas `deleting` tratam-se como inexistentes.
- Bloqueio: com 5 ou mais falhas do mesmo email nos últimos 15 minutos, o login é recusado (429). Uma entrada bem-sucedida apaga as falhas desse email. (Compromisso aceite: alguém pode bloquear o login de um email alheio durante 15 minutos.)

### Senhas

PBKDF2-SHA256 via WebCrypto, salt aleatório de 16 bytes, 100 000 iterações (o máximo aceite pelo Workers). As iterações ficam guardadas com o hash, para permitir reforçar depois.

### Sessões

- Token de 32 bytes aleatórios em cookie `sw_session`: `HttpOnly; SameSite=Lax; Path=/; Max-Age=<SESSION_TTL>`, com `Secure` quando o pedido é HTTPS (em desenvolvimento local em HTTP não se põe `Secure`).
- A D1 guarda só o hash do token. O logout apaga a sessão. Suspender ou apagar um utilizador e alterar a senha apagam as sessões em causa.
- Pedidos POST/PUT/PATCH/DELETE: o cabeçalho `Origin` tem de existir e coincidir com a origem do pedido, caso contrário 403 (proteção CSRF, em conjunto com `SameSite=Lax`).

### Isolamento de dados

Todas as consultas filtram pelo utilizador da sessão. Um id que pertença a outro utilizador devolve 404. O admin tem rotas de gestão de contas e quotas e **nenhuma rota para ver ou descarregar ficheiros alheios**.

### Servir ficheiros com segurança

- Descarregar: `Content-Disposition: attachment` com `filename*=UTF-8''…`.
- Pré-visualizar inline: só para extensões `png`, `jpg`, `jpeg`, `gif`, `webp` e `pdf`. O `Content-Type` vem de um mapa fixo por extensão (não do valor guardado). Tudo o resto, incluindo SVG e HTML, só se serve como download.
- Todas as respostas levam `X-Content-Type-Options: nosniff`. A aplicação envia `X-Frame-Options: SAMEORIGIN` e `Referrer-Policy: same-origin`.

### Utilizador master

`npm run seed:master` (com `--local` ou `--remote`) lê `MASTER_EMAIL`, `MASTER_PASSWORD` e, opcionalmente, `MASTER_QUOTA_BYTES` (por defeito 10 GiB) das variáveis de ambiente, calcula o hash e insere o utilizador com `role = admin`. É idempotente: se o email já existir, não faz nada. **A senha e o email do master nunca são escritos no código, na configuração ou no repositório.** O ecrã "Alterar senha" permite trocar a senha inicial.

## 5. Ficheiros, quotas e upload

### Upload

`PUT /api/files?name=<nome>&folder=<id|omitido>`, com o ficheiro no corpo. O `Content-Length` é obrigatório e tem de ser inferior ou igual a `MAX_UPLOAD_BYTES`. O corpo passa em *stream* para o R2, sem ser carregado em memória.

1. Validar sessão, estado da conta, propriedade da pasta e nome.
2. **Reserva atómica**, numa única *batch* (transação) da D1:
   - inserir a linha do ficheiro com `status = pending`, de forma condicional (só se `used_bytes + size <= quota_bytes` e a conta estiver `active`);
   - só então incrementar `used_bytes`.
   Sem quota, devolve 413 "sem espaço". Nome já existente: a transação falha por violação do índice único e devolve 409.
3. Gravar no R2 (`FILES.put(r2_key, request.body)`).
4. Passar a linha a `status = ready` e responder 201.
5. Se o passo 3 ou 4 falhar: em *batch*, apagar a linha e devolver `used_bytes`, e apagar a chave no R2 (melhor esforço).

Itens `pending` nunca aparecem nas listagens. O cron apaga os `pending` com mais de 1 hora e liberta a quota correspondente (cobre falhas do Worker a meio).

Uploads de um nome já existente na pasta devolvem 409 na v1; o utilizador pode renomear o ficheiro e tentar de novo.

### Quotas

`used_bytes` inclui os ficheiros na lixeira, até à remoção definitiva. O master pode definir uma quota inferior ao uso atual: isso só impede novos uploads. A interface mostra a barra de uso na barra lateral.

### Operações

- **Renomear e mover** (ficheiros e pastas): só D1. Mover uma pasta para dentro de si própria ou de uma descendente devolve 400 (verificação por consulta recursiva).
- **Excluir ficheiro**: define `deleted_at`. Os links públicos desse ficheiro deixam de funcionar enquanto estiver na lixeira.
- **Restaurar**: limpa `deleted_at`. Se o nome já existir no destino, restaura com o sufixo " (restaurado)", ou " (restaurado 2)", etc. Se a pasta original já não existir, restaura para a raiz.
- **Eliminar definitivamente** (um ficheiro ou esvaziar a lixeira): apaga o objeto do R2, a linha da D1 e desconta o tamanho em `used_bytes`. O cron faz o mesmo aos itens com mais de `TRASH_RETENTION_DAYS`.
- **Excluir pasta**: só se não tiver subpastas nem ficheiros com `deleted_at IS NULL` (incluindo `pending`). Caso contrário, 409. Se só tiver ficheiros na lixeira, a *batch* faz primeiro `folder_id = NULL` neles e depois apaga a pasta (a FK é a rede de segurança contra uploads concorrentes). A pasta apagada não vai para a lixeira.
- **Listar**: devolve o conteúdo de uma pasta (pastas primeiro, depois ficheiros), por ordem de nome. Sem paginação na v1.
- **Pesquisa**: `name_norm LIKE %q%`, com `%` e `_` escapados, mínimo 2 caracteres, máximo 50 resultados, só itens não apagados e `ready`. Cada resultado traz o caminho completo.

### Partilha por link

Token de 32 bytes aleatórios; a D1 guarda só o hash. **O link completo só é mostrado uma vez, na criação**; depois a lista mostra os links ativos (com data de criação e validade) e permite revogar. A validade é opcional. A página pública `/s/:token` mostra o nome e o tamanho e tem o botão "Descarregar". Só é válido se o ficheiro estiver `ready`, não estiver na lixeira, e o link não estiver expirado nem revogado.

## 6. API

Todas as rotas autenticadas exigem sessão, exceto as de registo, login e as públicas. Erros em JSON `{ "error": "<código>", "message": "<texto>" }`.

| Área | Rotas |
|---|---|
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` (inclui uso e quota), `POST /api/auth/password` (senha atual + nova; termina as outras sessões) |
| Pastas | `GET /api/folders/:id/contents` (`id` = `root` para a raiz), `GET /api/folders/tree`, `POST /api/folders`, `PATCH /api/folders/:id` (renomear e/ou mover), `DELETE /api/folders/:id` |
| Ficheiros | `PUT /api/files`, `PATCH /api/files/:id` (renomear e/ou mover), `DELETE /api/files/:id` (vai para a lixeira), `GET /api/files/:id/download`, `GET /api/files/:id/preview` (com suporte a `Range`) |
| Lixeira | `GET /api/trash`, `POST /api/trash/:id/restore`, `DELETE /api/trash/:id`, `DELETE /api/trash` |
| Partilha | `POST /api/files/:id/shares`, `GET /api/files/:id/shares`, `DELETE /api/shares/:id` |
| Público | `GET /api/public/shares/:token` (nome e tamanho), `GET /api/public/shares/:token/download` |
| Pesquisa | `GET /api/search?q=` |
| Admin | `GET /api/admin/users`, `PATCH /api/admin/users/:id` (`quota_bytes` e/ou `status` entre `active` e `suspended`), `DELETE /api/admin/users/:id` |

Regras do admin: só `role = admin` acede a `/api/admin/*`. Contas com `role = admin` não podem ser suspensas nem apagadas através da API. Apagar um utilizador define `status = deleting` e termina as sessões dele. A remoção dos ficheiros e das linhas é feita pelo cron.

## 7. Cron de manutenção (hora a hora)

Cada execução é idempotente e trabalha em lotes limitados, para respeitar os limites de chamadas por invocação do Workers. Continua onde ficou na execução seguinte.

1. Itens na lixeira há mais de `TRASH_RETENTION_DAYS`: apagar do R2 e da D1, descontar quota.
2. Ficheiros `pending` com mais de 1 hora: apagar linha, apagar chave no R2 (melhor esforço), libertar quota.
3. Utilizadores `deleting`: apagar os ficheiros do R2 (até 1000 chaves por chamada), depois as linhas de ficheiros, pastas, sessões e partilhas, e por fim o utilizador.
4. Limpar sessões expiradas, `login_failures` com mais de 1 dia e partilhas expiradas ou revogadas há mais de 30 dias.

## 8. Interface (React, português europeu, responsiva)

| Rota | Conteúdo |
|---|---|
| `/login`, `/registo` | Formulários de email e senha (o registo pede confirmação da senha). |
| `/` Meu espaço | Barra lateral: Meu espaço, Lixeira, Conta, Admin (só master), Sair, e barra de uso. Cabeçalho com caminho da pasta (*breadcrumb*), pesquisa, "Nova pasta" e "Carregar". Lista de pastas e ficheiros com menu por item: pré-visualizar, descarregar, renomear, mover, partilhar, excluir. Upload por arrastar e largar e por seleção, com até 3 envios em paralelo e progresso por ficheiro (`XMLHttpRequest`). "Mover" abre um diálogo com a árvore de pastas. |
| `/lixeira` | Ficheiros excluídos: Restaurar, Eliminar definitivamente, Esvaziar lixeira. |
| `/conta` | Alterar senha. |
| `/admin` | Tabela de utilizadores (email, usado/quota, estado, data de criação); editar quota, suspender/reativar, apagar. |
| `/s/:token` | Página pública de download. |

## 9. Estrutura do repositório

```
wrangler.jsonc        bindings (DB, FILES), assets, cron, variáveis
migrations/           SQL da D1 (0001_init.sql, …)
scripts/              seed-master, setup-nosync
src/worker/           Hono: index.ts, routes/ (auth, folders, files, trash, shares, public, search, admin), lib/ (crypto, session, quota, names), cron.ts
src/web/              React: pages, components, api client
src/shared/           tipos partilhados
test/                 integração (worker) e e2e
docs/superpowers/     specs e planos
```

### Git e iCloud

- A pasta do projeto está no iCloud Drive. `.git`, `node_modules`, `.wrangler` e `dist` ficam em pastas `*.nosync` com *symlink* (script `setup-nosync`), para o iCloud não os sincronizar (sincronizar o `.git` pode corromper o repositório).
- `.gitignore`: `node_modules`, `node_modules.nosync`, `.wrangler`, `.wrangler.nosync`, `dist`, `dist.nosync`, `.dev.vars`, `.env*`, artefactos do Playwright.
- Repositório local com ramo `main` e remoto `origin` = `https://github.com/carloslopesapp-ia/SpaceWork.git`. **Nenhum `git push` é feito sem confirmação explícita do utilizador.**

## 10. Testes

- **Integração da API** (Vitest no runtime Workers, D1 e R2 locais): quotas e concorrência (uploads simultâneos que juntos excedem a quota), isolamento entre utilizadores, nomes únicos, mover sem ciclos, regra de pasta vazia, lixeira e restauro com conflito de nome, expiração e revogação de partilhas, permissões de admin, bloqueio de login, proteção de `Origin`.
- **Unitários**: hash de senhas, normalização e validação de nomes.
- **E2E de fumo** (Playwright): registo, login, criar pasta, carregar, mover, excluir, restaurar.

## 11. Deploy

1. Desenvolvimento local: `npm run dev` (D1 e R2 simulados, nada toca na conta Cloudflare).
2. Produção, com passos feitos pelo utilizador onde envolvem a sua conta: `wrangler login`; criar bucket R2 e base D1; atualizar IDs em `wrangler.jsonc`; `wrangler d1 migrations apply --remote`; `seed:master --remote`; `wrangler deploy`.
3. Resultado: URL `*.workers.dev`. Domínio próprio e deploy automático via GitHub ficam para depois.

## 12. Fora do âmbito da v1

Recuperação de senha por email (e, por isso, o admin **não** consegue repor a senha de outro utilizador), confirmação de email, 2FA, criação de outros admins pela interface, uploads acima de 100 MB ou retomáveis, histórico de versões, partilha entre utilizadores, antivírus, paginação das listagens, vista em grelha, arrastar itens para mover, tema escuro, domínio próprio, deploy automático.

## 13. Pontos a confirmar na implementação

1. Custo de CPU do PBKDF2 (100 000 iterações) face ao limite por pedido do plano gratuito do Workers. Se não couber, é preciso o plano pago.
2. Limite exato de corpo de pedido do Workers por plano face a `MAX_UPLOAD_BYTES` (100 MiB), incluindo o comportamento do `put` no R2 com corpo em *stream* e `Content-Length` conhecido.
3. Limites de chamadas por invocação do cron (dimensionar o tamanho dos lotes).
4. Cookies com `Secure` em `localhost` no Safari (decidido por pedido HTTPS ou não).
5. Comportamento transacional e mensagens de erro de violação de unicidade nas *batches* da D1.
