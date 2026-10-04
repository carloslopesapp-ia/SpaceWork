# SpaceWork

Aplicação web para gerir espaço em disco na cloud (ao estilo do Google Drive ou Dropbox): pastas, upload, mover, excluir, lixeira, pré-visualização, pesquisa e partilha por link. Alojada na Cloudflare (Worker + D1 + R2).

- Especificação: [docs/superpowers/specs/2026-10-03-spacework-design.md](docs/superpowers/specs/2026-10-03-spacework-design.md)
- Planos de implementação e estado: [docs/superpowers/plans/README.md](docs/superpowers/plans/README.md)

## Requisitos

Node 24 e npm 11. Recomenda-se trabalhar fora do iCloud Drive (o `node_modules` tem dezenas de milhares de ficheiros e **não pode** ser um *symlink*).

## Desenvolvimento

```bash
npm install
npm run db:migrate:local      # cria as tabelas na base de dados local (.wrangler/state)
npm run dev                   # http://localhost:5173 (D1 e R2 simulados, nada toca na Cloudflare)
```

`npm install` mostra avisos `allow-scripts`: são inofensivos.

### Criar o utilizador master (admin)

A senha nunca vai para ficheiros: o script lê-a do ambiente. Em `zsh`, a leitura da senha fica oculta e não entra no histórico:

```bash
export MASTER_EMAIL='<email-do-master>'
read -rs "MASTER_PASSWORD?Senha do master: " && export MASTER_PASSWORD
npm run seed:master -- --local        # --remote para a base de dados de produção
unset MASTER_PASSWORD
```

(Em `bash`: `read -rsp "Senha do master: " MASTER_PASSWORD && export MASTER_PASSWORD`.) O script é idempotente: se o email já existir, não altera nada. Quota do master por defeito: 10 GiB (`MASTER_QUOTA_BYTES` para outro valor).

## Comandos

| Comando | O que faz |
|---|---|
| `npm test` | Todos os testes (`test:worker` e `test:web`) |
| `npm run test:worker` | Testes da API (Vitest no runtime do Workers, com D1 e R2 locais) |
| `npm run test:web` | Testes da interface (Vitest em jsdom, com o Testing Library) |
| `npm run typecheck` | Verifica os tipos de todo o projeto (`tsc -b`) |
| `npm run build` | Build de produção em `dist/` |
| `npm run cf-typegen` | Regenera `worker-configuration.d.ts` (depois de alterar `wrangler.jsonc`) |
| `npm run db:migrate:local` / `db:migrate:remote` | Aplica as migrações da D1 |

## Estrutura

```
migrations/    SQL da D1
scripts/       seed-master
src/worker/    API (Hono): rotas, lib, middleware
src/web/       SPA React
src/shared/    tipos e funções partilhadas
test/          testes do Worker (os da interface ficam ao lado do código, em src/web/**/*.test.{ts,tsx})
```

## API

Todas as rotas desta secção exigem sessão (cookie `sw_session`), exceto as duas de `/api/public/shares/…`. Em toda a API só são públicas `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/health`, `GET /api/public/shares/:token` e `GET /api/public/shares/:token/download`. Os pedidos que alteram dados (`POST`, `PUT`, `PATCH`, `DELETE`) exigem o cabeçalho `Origin`, que tem de coincidir com a origem do pedido (senão 403 `forbidden_origin`). Os erros vêm em `{ "error": "<código>", "message": "<texto>" }`.

`parentId` (pastas) e `folderId` (ficheiros) aceitam `null` ou `"root"` para a raiz; no upload, omitir `folder` também significa a raiz. As pastas têm no máximo 100 níveis (senão 400 `folder_too_deep`).

| Pedido | Descrição |
|---|---|
| `GET /api/folders/:id/contents` | Conteúdo de uma pasta (`root` = raiz): pasta, caminho, subpastas e ficheiros |
| `GET /api/folders/tree` | Todas as pastas do utilizador |
| `POST /api/folders` | Cria uma pasta (`{ name, parentId? }`) |
| `PATCH /api/folders/:id` | Renomeia e/ou move (`{ name?, parentId? }`) |
| `DELETE /api/folders/:id` | Apaga uma pasta, só se estiver vazia |
| `PUT /api/files?name=&folder=` | Upload (ficheiro no corpo, `Content-Length` obrigatório, máx. 100 MiB, configurável por `MAX_UPLOAD_BYTES`) |
| `GET /api/files/:id/download` | Descarrega (sempre como anexo) |
| `GET /api/files/:id/preview` | Pré-visualiza imagens e PDF (suporta `Range`) |
| `PATCH /api/files/:id` | Renomeia e/ou move (`{ name?, folderId? }`) |
| `DELETE /api/files/:id` | Manda o ficheiro para a lixeira |
| `GET /api/config` | Limites do servidor para o browser: `{ maxUploadBytes }` |
| `GET /api/search?q=` | Pesquisa por nome nas pastas e nos ficheiros (sem distinguir maiúsculas nem acentos; 2 a 100 caracteres; até 50 resultados, cada um com o caminho da pasta onde está) |
| `GET /api/trash` | A lixeira: até 200 ficheiros excluídos, os mais recentes primeiro, com a pasta onde estavam e a data da eliminação automática (`total` conta todos) |
| `POST /api/trash/:id/restore` | Restaura um ficheiro; se o nome estiver ocupado acrescenta « (restaurado)», « (restaurado 2)», … |
| `DELETE /api/trash/:id` | Elimina um ficheiro de vez (apaga o objeto do R2 e devolve o espaço) |
| `DELETE /api/trash` | Esvazia a lixeira por blocos de 50 e responde `{ purged, remaining }`: repetir até `remaining` ser 0 |
| `POST /api/files/:id/shares` | Cria um link (`{ expiresAt? }`, em milissegundos Unix). O `token` só vem nesta resposta; no máximo 20 links ativos por ficheiro (409 `too_many_shares`) |
| `GET /api/files/:id/shares` | Os links ativos do ficheiro (sem o token) |
| `DELETE /api/shares/:id` | Revoga um link |
| `GET /api/public/shares/:token` | Público: nome e tamanho do ficheiro partilhado |
| `GET /api/public/shares/:token/download` | Público: descarrega o ficheiro partilhado (sempre como anexo) |

Um link só funciona se não foi revogado nem expirou, o ficheiro está fora da lixeira e a conta do dono está ativa; nos outros casos a resposta é sempre `404 share_not_found`, sem dizer porquê.

## Interface

Depois do login, «Meu espaço» (`/`, e `/pasta/:id` dentro de uma pasta) mostra o caminho, as pastas e os ficheiros. Tem «Nova pasta», «Carregar ficheiros» (ou arrastar ficheiros para a página) e, em cada linha, o menu «⋮»: o das pastas tem renomear, mover e excluir; o dos ficheiros tem também pré-visualizar (imagens e PDF) e descarregar. Os envios correm até 3 em paralelo, com progresso, e continuam se mudar de pasta; um ficheiro acima de `maxUploadBytes` nem sai do browser. Não há miniaturas (a API responde com `no-store`, por isso cada miniatura seria um pedido novo a cada listagem). A API da lixeira, da pesquisa e da partilha já existe, mas só o Plano 3B lhes dá ecrãs: até lá os ficheiros excluídos continuam a ocupar quota até serem eliminados de vez.

Não fazer `git push` sem confirmação do dono do projeto.
