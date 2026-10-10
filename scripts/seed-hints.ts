/** O comando que aplica as migrações no destino do seed: o aviso do script manda o utilizador para o certo (`--remote` não é `--local`). */
export function migrateCommand(target: "--local" | "--remote"): string {
  return target === "--remote" ? "npm run db:migrate:remote" : "npm run db:migrate:local";
}
