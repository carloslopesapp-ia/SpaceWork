import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers";

beforeEach(resetDb);

async function insertUser(id: string, email: string, role = "user"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, role, status, quota_bytes, used_bytes, created_at)
     VALUES (?1, ?2, 'x', ?3, 'active', 1000, 0, 1)`,
  )
    .bind(id, email, role)
    .run();
}

describe("esquema da D1", () => {
  it("cria todas as tabelas da especificação", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND substr(name, 1, 1) != '_' ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual([
      "files",
      "folders",
      "login_failures",
      "sessions",
      "shares",
      "users",
    ]);
  });

  it("impede emails repetidos", async () => {
    await insertUser("u1", "ana@example.com");
    await expect(insertUser("u2", "ana@example.com")).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("só aceita os papéis admin e user", async () => {
    await expect(insertUser("u1", "ana@example.com", "root")).rejects.toThrow(
      /CHECK constraint failed/,
    );
  });

  it("impede nomes de pasta repetidos na mesma pasta, incluindo na raiz", async () => {
    await insertUser("u1", "ana@example.com");
    const insertFolder = (id: string, parent: string | null, name: string) =>
      env.DB.prepare(
        "INSERT INTO folders (id, user_id, parent_id, name, name_norm, created_at) VALUES (?1, 'u1', ?2, ?3, ?3, 1)",
      )
        .bind(id, parent, name)
        .run();
    await insertFolder("f1", null, "Fotos");
    await expect(insertFolder("f2", null, "Fotos")).rejects.toThrow(/UNIQUE constraint failed/);
    await insertFolder("f3", "f1", "Fotos"); // outra pasta-mãe: permitido
  });

  it("só aplica a unicidade de nomes de ficheiro aos que não estão na lixeira", async () => {
    await insertUser("u1", "ana@example.com");
    const insertFile = (id: string, deletedAt: number | null) =>
      env.DB.prepare(
        `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at, deleted_at)
         VALUES (?1, 'u1', NULL, 'a.pdf', 'a.pdf', 1, 'application/pdf', ?2, 'ready', 1, ?3)`,
      )
        .bind(id, `u/u1/${id}`, deletedAt)
        .run();
    await insertFile("x1", null);
    await expect(insertFile("x2", null)).rejects.toThrow(/UNIQUE constraint failed/);
    await insertFile("x3", 5); // na lixeira: permitido
  });

  it("aplica chaves estrangeiras", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO folders (id, user_id, parent_id, name, name_norm, created_at) VALUES ('f1', 'inexistente', NULL, 'a', 'a', 1)",
      ).run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it("apaga as sessões quando o utilizador é apagado", async () => {
    await insertUser("u1", "ana@example.com");
    await env.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('h', 'u1', 1, 2)",
    ).run();
    await env.DB.prepare("DELETE FROM users WHERE id = 'u1'").run();
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
