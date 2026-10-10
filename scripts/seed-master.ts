// Cria o utilizador master (admin) na D1. Uso:
//   npm run seed:master -- --local     (base de dados de desenvolvimento)
//   npm run seed:master -- --remote    (base de dados de produção)
// Variáveis de ambiente: MASTER_EMAIL, MASTER_PASSWORD e, opcionalmente, MASTER_QUOTA_BYTES (por defeito 10 GiB).
// A senha nunca é escrita em ficheiros nem passada ao wrangler: só o hash chega à base de dados.
import { execFileSync } from "node:child_process";
import { hashPassword } from "../src/worker/lib/crypto.ts";
import { migrateCommand } from "./seed-hints.ts";
import { isValidEmail, isValidPassword, normalizeEmail } from "../src/shared/validation.ts";

const DEFAULT_MASTER_QUOTA_BYTES = 10 * 1024 ** 3;
// Build child environment without MASTER_* variables (never pass them to wrangler).
const { MASTER_PASSWORD: _password, MASTER_EMAIL: _email, MASTER_QUOTA_BYTES: _quota, ...childEnv } = process.env;

function fail(message: string): never {
  console.error(`Erro: ${message}`);
  process.exit(1);
}

function parseTarget(args: string[]): "--local" | "--remote" {
  const flags = args.filter((arg) => arg === "--local" || arg === "--remote");
  if (flags.length !== 1) fail("indique exatamente um destino: --local ou --remote.");
  return flags[0] as "--local" | "--remote";
}

function d1Execute(target: "--local" | "--remote", sql: string): Array<{ results: Array<Record<string, unknown>> }> {
  let stdout: string;
  try {
    stdout = execFileSync(
      "npx",
      ["wrangler", "d1", "execute", "DB", target, "--json", "--command", sql],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], env: childEnv },
    );
  } catch {
    // Não imprime a exceção: o stack trace traria a linha de comando completa, com o email e o hash.
    // O stderr do wrangler já foi para o terminal (stdio: inherit).
    fail(
      `O wrangler falhou ao executar a consulta (destino: ${target.slice(2)}). ` +
        `Se a base for nova, aplique primeiro as migrações (${migrateCommand(target)}).`,
    );
  }
  const start = stdout.indexOf("[");
  if (start === -1) fail("Resposta inesperada do wrangler.");
  return JSON.parse(stdout.slice(start));
}

const target = parseTarget(process.argv.slice(2));
const email = normalizeEmail(process.env.MASTER_EMAIL ?? "");
const password = process.env.MASTER_PASSWORD ?? "";

// Validate MASTER_QUOTA_BYTES strictly: if defined, must be a positive safe integer.
let quotaBytes = DEFAULT_MASTER_QUOTA_BYTES;
if (process.env.MASTER_QUOTA_BYTES) {
  const raw = process.env.MASTER_QUOTA_BYTES;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) {
    fail("MASTER_QUOTA_BYTES inválido: tem de ser um número inteiro de bytes maior que 0.");
  }
  quotaBytes = n;
}

if (!isValidEmail(email) || email.includes("'")) fail("MASTER_EMAIL em falta ou inválido.");
if (!isValidPassword(password)) fail("MASTER_PASSWORD em falta (tem de ter entre 8 e 128 caracteres).");

const existing = d1Execute(target, `SELECT id, role FROM users WHERE email = '${email}'`)[0]?.results[0];
if (existing) {
  if (existing.role !== "admin") {
    fail(
      "O email já está registado como utilizador normal (role = user). " +
        "O seed não altera contas existentes: use outro email ou resolva essa conta manualmente.",
    );
  }
  console.log("O utilizador master já existe. Nada foi alterado.");
  process.exit(0);
}

const passwordHash = await hashPassword(password);
d1Execute(
  target,
  `INSERT INTO users (id, email, password_hash, role, status, quota_bytes, used_bytes, created_at)
   VALUES ('${crypto.randomUUID()}', '${email}', '${passwordHash}', 'admin', 'active', ${quotaBytes}, 0, ${Date.now()})`,
);
console.log(`Utilizador master criado (${target.slice(2)}).`);
