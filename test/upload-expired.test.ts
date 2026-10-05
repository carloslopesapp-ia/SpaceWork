import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { registerUser } from "./auth-helpers";
import { dbWithStatementHook } from "./db-helpers";
import { countFiles, rawUpload, usedBytes } from "./file-helpers";
import { resetState } from "./helpers";

beforeEach(resetState);

describe("PUT /api/files: a reserva desapareceu antes de o envio acabar", () => {
  it("o objeto sai do R2, a quota não fica a dever nada e a resposta é 409 upload_expired (não 201)", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    // Imediatamente antes do `UPDATE ... 'ready'`, faz o que a manutenção faz a um envio pendente velho: devolve o espaço e apaga a linha.
    const db = dbWithStatementHook(/SET status = 'ready'/, async () => {
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET used_bytes = MAX(used_bytes - 5, 0) WHERE id = ?1").bind(user.id),
        env.DB.prepare("DELETE FROM files WHERE user_id = ?1 AND status = 'pending'").bind(user.id),
      ]);
    });

    const res = await rawUpload("a.txt", new TextEncoder().encode("12345"), cookie, { DB: db });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "upload_expired" });
    expect((await env.FILES.list({ prefix: "u/" })).objects).toHaveLength(0);
    expect(await usedBytes(cookie)).toBe(0);
    expect(await countFiles()).toBe(0);
  });
});
