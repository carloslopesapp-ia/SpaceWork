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
| `npm test` | Testes (Vitest no runtime do Workers, com D1 e R2 locais) |
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
test/          testes
```

Não fazer `git push` sem confirmação do dono do projeto.
