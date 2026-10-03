// Cria o utilizador master (admin) na D1. Uso:
//   npm run seed:master -- --local     (base de dados de desenvolvimento)
//   npm run seed:master -- --remote    (base de dados de produção)
// Variáveis de ambiente: MASTER_EMAIL, MASTER_PASSWORD e, opcionalmente, MASTER_QUOTA_BYTES (por defeito 10 GiB).
// A senha nunca é escrita em ficheiros nem passada ao wrangler: só o hash chega à base de dados.
import { execFileSync } from "node:child_process";
import { hashPassword } from "../src/worker/lib/crypto.ts";
import { isValidEmail, isValidPassword, normalizeEmail } from "../src/worker/lib/validation.ts";

const DEFAULT_MASTER_QUOTA_BYTES = 10 * 1024 ** 3;

function fail(message: string): never {
  console.error(`Erro: ${message}`);
  process.exit(1);
}

function parseTarget(args: string[]): "--local" | "--remote" {
  const flags = args.filter((arg) => arg === "--local" || arg === "--remote");
  if (flags.length !== 1) fail("indique exatamente um destino: --local ou --remote.");
  return flags[0] as "--local" | "--remote";
}

function d1Execute(target: string, sql: string): Array<{ results: unknown[] }> {
  const stdout = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", target, "--json", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  return JSON.parse(stdout.slice(stdout.indexOf("[")));
}

const target = parseTarget(process.argv.slice(2));
const email = normalizeEmail(process.env.MASTER_EMAIL ?? "");
const password = process.env.MASTER_PASSWORD ?? "";
const quotaBytes = Number.parseInt(process.env.MASTER_QUOTA_BYTES ?? "", 10) || DEFAULT_MASTER_QUOTA_BYTES;

if (!isValidEmail(email) || email.includes("'")) fail("MASTER_EMAIL em falta ou inválido.");
if (!isValidPassword(password)) fail("MASTER_PASSWORD em falta (tem de ter entre 8 e 128 caracteres).");

const existing = d1Execute(target, `SELECT id FROM users WHERE email = '${email}'`);
if (existing[0]?.results.length) {
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
