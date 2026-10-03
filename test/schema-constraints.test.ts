import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers";

beforeEach(resetDb);

async function insertUser(id = "u1", status = "active"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, role, status, quota_bytes, used_bytes, created_at)
     VALUES (?1, ?2, 'x', 'user', ?3, 1000, 0, 1)`,
  )
    .bind(id, `${id}@example.com`, status)
    .run();
}

async function insertFile(id: string, status = "ready"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO files (id, user_id, folder_id, name, name_norm, size, mime, r2_key, status, created_at)
     VALUES (?1, 'u1', NULL, ?1, ?1, 1, 'text/plain', ?2, ?3, 1)`,
  )
    .bind(id, `u/u1/${id}`, status)
    .run();
}

describe("restrições do esquema", () => {
  it("used_bytes nunca fica negativo", async () => {
    await insertUser();
    await expect(
      env.DB.prepare("UPDATE users SET used_bytes = used_bytes - 1 WHERE id = 'u1'").run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it("status de utilizador e de ficheiro só aceitam os valores previstos", async () => {
    await expect(insertUser("u2", "banido")).rejects.toThrow(/CHECK constraint failed/);
    await insertUser();
    await expect(insertFile("f1", "meio-pronto")).rejects.toThrow(/CHECK constraint failed/);
  });

  it("o token_hash de uma partilha é único", async () => {
    await insertUser();
    await insertFile("f1");
    const share = (id: string) =>
      env.DB.prepare(
        "INSERT INTO shares (id, token_hash, file_id, user_id, created_at) VALUES (?1, 'mesmo-hash', 'f1', 'u1', 1)",
      )
        .bind(id)
        .run();
    await share("s1");
    await expect(share("s2")).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("apagar um ficheiro apaga as suas partilhas", async () => {
    await insertUser();
    await insertFile("f1");
    await env.DB.prepare(
      "INSERT INTO shares (id, token_hash, file_id, user_id, created_at) VALUES ('s1', 'h', 'f1', 'u1', 1)",
    ).run();
    await env.DB.prepare("DELETE FROM files WHERE id = 'f1'").run();
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM shares").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("existem índices nas chaves estrangeiras files.folder_id, folders.parent_id e shares.user_id", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('files_folder_id', 'folders_parent_id', 'shares_user_id') ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(["files_folder_id", "folders_parent_id", "shares_user_id"]);
  });
});
