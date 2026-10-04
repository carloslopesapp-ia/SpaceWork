import { beforeEach, describe, expect, it } from "vitest";
import type { FileItem } from "../src/shared/types";
import { NAME_MAX_LENGTH } from "../src/shared/names";
import { registerUser } from "./auth-helpers";
import { insertFileRow, uploadOk, usedBytes } from "./file-helpers";
import { createFolder, getContents } from "./folder-helpers";
import { api, resetState } from "./helpers";

beforeEach(resetState);

async function trashFile(cookie: string, id: string): Promise<void> {
  expect((await api(`/api/files/${id}`, { method: "DELETE", cookie })).status).toBe(204);
}

const restore = (cookie: string, id: string) => api(`/api/trash/${id}/restore`, { method: "POST", cookie });

async function trashedCount(cookie: string): Promise<number> {
  return ((await (await api("/api/trash", { cookie })).json()) as { total: number }).total;
}

describe("POST /api/trash/:id/restore", () => {
  it("exige sessão", async () => {
    expect((await api("/api/trash/x/restore", { method: "POST" })).status).toBe(401);
  });

  it("devolve o ficheiro à pasta onde estava, com o mesmo nome, sem mexer na quota", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const folder = await createFolder(cookie, "Fotos");
    const file = await uploadOk(cookie, "praia.png", "12345", { folder: folder.id });
    await trashFile(cookie, file.id);

    const res = await restore(cookie, file.id);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { file: FileItem }).file).toMatchObject({ id: file.id, name: "praia.png", folderId: folder.id });
    expect((await getContents(cookie, folder.id)).files.map((f) => f.name)).toEqual(["praia.png"]);
    expect(await trashedCount(cookie)).toBe(0);
    expect(await usedBytes(cookie)).toBe(5);
    expect((await restore(cookie, file.id)).status).toBe(404); // já não está na lixeira
  });

  it("se a pasta original já foi apagada, restaura para a raiz", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const folder = await createFolder(cookie, "Fotos");
    const file = await uploadOk(cookie, "praia.png", "x", { folder: folder.id });
    await trashFile(cookie, file.id);
    expect((await api(`/api/folders/${folder.id}`, { method: "DELETE", cookie })).status).toBe(204);

    const res = await restore(cookie, file.id);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { file: FileItem }).file.folderId).toBeNull();
    expect((await getContents(cookie)).files.map((f) => f.name)).toEqual(["praia.png"]);
  });

  it("se o nome já existe no destino, restaura com o sufixo, e numerado se for preciso", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const first = await uploadOk(cookie, "a.txt", "1");
    await trashFile(cookie, first.id);
    await uploadOk(cookie, "a.txt", "2"); // o nome ficou livre e foi reutilizado

    const second = (await (await restore(cookie, first.id)).json()) as { file: FileItem };
    expect(second.file.name).toBe("a.txt (restaurado)");

    const again = await uploadOk(cookie, "b.txt", "3");
    await trashFile(cookie, again.id);
    await uploadOk(cookie, "b.txt", "4");
    await insertFileRow(user.id, null, { name: "b.txt (restaurado)" });
    const third = (await (await restore(cookie, again.id)).json()) as { file: FileItem };
    expect(third.file.name).toBe("b.txt (restaurado 2)");
  });

  it("um envio `pending` com o nome também conta como ocupado", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "1");
    await trashFile(cookie, file.id);
    await insertFileRow(user.id, null, { name: "a.txt", status: "pending" });

    const res = await restore(cookie, file.id);

    expect(((await res.json()) as { file: FileItem }).file.name).toBe("a.txt (restaurado)");
  });

  it("respeita o limite de 255 caracteres: corta o nome para o sufixo caber", async () => {
    const { cookie } = await registerUser("ana@example.com");
    const name = "a".repeat(NAME_MAX_LENGTH);
    const file = await uploadOk(cookie, name, "1");
    await trashFile(cookie, file.id);
    await uploadOk(cookie, name, "2");

    const restored = ((await (await restore(cookie, file.id)).json()) as { file: FileItem }).file;

    expect(restored.name).toHaveLength(NAME_MAX_LENGTH);
    expect(restored.name.endsWith(" (restaurado)")).toBe(true);
  });

  it("se as 10 tentativas estiverem ocupadas, devolve 409 e o ficheiro continua na lixeira", async () => {
    const { cookie, user } = await registerUser("ana@example.com");
    const file = await uploadOk(cookie, "a.txt", "1");
    await trashFile(cookie, file.id);
    const taken = ["a.txt", "a.txt (restaurado)", ...Array.from({ length: 8 }, (_unused, index) => `a.txt (restaurado ${index + 2})`)];
    for (const name of taken) await insertFileRow(user.id, null, { name });

    const res = await restore(cookie, file.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "name_taken" });
    expect(await trashedCount(cookie)).toBe(1);
  });

  it("só restaura ficheiros que estão na lixeira e que são do utilizador (senão 404)", async () => {
    const ana = await registerUser("ana@example.com");
    const bob = await registerUser("bob@example.com");
    const ativo = await uploadOk(ana.cookie, "ativo.txt", "x");
    const apagado = await uploadOk(ana.cookie, "apagado.txt", "x");
    await trashFile(ana.cookie, apagado.id);

    expect((await restore(ana.cookie, ativo.id)).status).toBe(404);
    expect((await restore(bob.cookie, apagado.id)).status).toBe(404);
    expect((await restore(ana.cookie, "nao-existe")).status).toBe(404);
    expect(await trashedCount(ana.cookie)).toBe(1);
  });
});
