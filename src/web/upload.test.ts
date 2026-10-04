import { describe, expect, it, vi } from "vitest";
import { ApiRequestError, NETWORK_ERROR_MESSAGE, setUnauthorizedHandler } from "./api";
import { ABORTED_CODE, uploadFile } from "./upload";
import { stubXhr } from "./test/fake-xhr";

const FILE_ITEM = { id: "f1", name: "a.txt", folderId: null, size: 3, mime: "text/plain", createdAt: 1 };

function start(name = "a.txt", folderId: string | null = null, onProgress = vi.fn()) {
  const Xhr = stubXhr();
  const file = new File(["abc"], name, { type: "text/plain" });
  const handle = uploadFile(file, folderId, onProgress);
  return { handle, xhr: Xhr.instances[0], file, onProgress };
}

describe("uploadFile", () => {
  it("faz PUT /api/files com o ficheiro no corpo e a pasta no URL", () => {
    const { xhr, file } = start("a.txt", "pasta-1");
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe("/api/files?name=a.txt&folder=pasta-1");
    expect(xhr.sent).toBe(file);
  });

  it("não mete `folder` no URL quando o destino é a raiz", () => {
    expect(start("a.txt", null).xhr.url).toBe("/api/files?name=a.txt");
  });

  it("codifica o nome: `+`, `&`, `%` e `#` não podem mudar o significado do URL", () => {
    const { xhr } = start("a+b & c%d#e.txt");
    const query = new URL(xhr.url, "http://localhost").searchParams;
    expect(query.get("name")).toBe("a+b & c%d#e.txt");
    expect(xhr.url).toContain("name=a%2Bb+%26+c%25d%23e.txt");
  });

  it("devolve o progresso do envio", () => {
    const { xhr, onProgress } = start();
    xhr.progress(1, 3);
    xhr.progress(3, 3);
    expect(onProgress.mock.calls).toEqual([
      [1, 3],
      [3, 3],
    ]);
  });

  it("resolve com o ficheiro criado quando a API responde 201", async () => {
    const { handle, xhr } = start();
    xhr.respond(201, { file: FILE_ITEM });
    await expect(handle.promise).resolves.toEqual(FILE_ITEM);
  });

  it("falha com o código e a mensagem em português da API", async () => {
    const { handle, xhr } = start();
    xhr.respond(409, { error: "name_taken", message: "Já existe um ficheiro com esse nome neste local." });
    await expect(handle.promise).rejects.toBeInstanceOf(ApiRequestError);
    await expect(handle.promise).rejects.toMatchObject({ status: 409, code: "name_taken" });
  });

  it("um 413 sem JSON (o da Cloudflare) dá a mensagem de ficheiro grande", async () => {
    const { handle, xhr } = start();
    xhr.respond(413, "<html>Request Entity Too Large</html>");
    await expect(handle.promise).rejects.toMatchObject({
      status: 413,
      code: "unknown_error",
      message: "O ficheiro é demasiado grande.",
    });
  });

  it("uma resposta 201 sem o ficheiro é um erro, não um sucesso", async () => {
    const { handle, xhr } = start();
    xhr.respond(201, "isto não é JSON");
    await expect(handle.promise).rejects.toMatchObject({ code: "unknown_error" });
  });

  it("avisa o handler quando a sessão expirou durante o envio", async () => {
    const handler = vi.fn();
    const { handle, xhr } = start();
    setUnauthorizedHandler(handler);
    xhr.respond(401, { error: "unauthorized", message: "Sessão inválida ou expirada." });
    await expect(handle.promise).rejects.toMatchObject({ code: "unauthorized" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("uma falha de rede dá a mensagem de ligação", async () => {
    const { handle, xhr } = start();
    xhr.fail();
    await expect(handle.promise).rejects.toMatchObject({ status: 0, message: NETWORK_ERROR_MESSAGE });
  });

  it("cancelar faz a promessa falhar com o código `aborted`", async () => {
    const { handle } = start();
    handle.abort();
    await expect(handle.promise).rejects.toMatchObject({ code: ABORTED_CODE });
  });
});
