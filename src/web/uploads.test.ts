import { describe, expect, it, vi } from "vitest";
import type { FileItem } from "../shared/types";
import { ApiRequestError } from "./api";
import { ABORTED_CODE, type UploadHandle } from "./upload";
import { MAX_PARALLEL_UPLOADS, UploadManager } from "./uploads";

const FILE_ITEM: FileItem = { id: "f", name: "x", folderId: null, size: 1, mime: "text/plain", createdAt: 1 };
const file = (name: string, size = 10) => new File(["x".repeat(size)], name);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Um `uploadFile` falso em que cada envio fica pendente até o teste o resolver ou rejeitar. */
function fakeUploads() {
  const sent: Array<{
    file: File;
    folderId: string | null;
    progress: (loaded: number, total: number) => void;
    finish: () => void;
    fail: (error: unknown) => void;
    aborted: boolean;
  }> = [];
  const upload = (f: File, folderId: string | null, progress: (loaded: number, total: number) => void): UploadHandle => {
    let resolve!: (value: FileItem) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<FileItem>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const record = { file: f, folderId, progress, finish: () => resolve(FILE_ITEM), fail: reject, aborted: false };
    sent.push(record);
    return {
      promise,
      abort: () => {
        record.aborted = true;
        reject(new ApiRequestError(0, ABORTED_CODE, "Envio cancelado."));
      },
    };
  };
  return { upload, sent };
}

function setup(maxUploadBytes = Infinity) {
  const fake = fakeUploads();
  const onSettled = vi.fn();
  const manager = new UploadManager({ maxUploadBytes: () => maxUploadBytes, onSettled, upload: fake.upload });
  return { manager, onSettled, ...fake };
}

const statuses = (manager: UploadManager) => manager.getSnapshot().map((item) => `${item.name}:${item.status}`);

describe("UploadManager", () => {
  it(`envia no máximo ${MAX_PARALLEL_UPLOADS} ficheiros ao mesmo tempo e arranca o seguinte quando um termina`, async () => {
    const { manager, sent } = setup();
    manager.add(["a", "b", "c", "d", "e"].map((name) => file(name)), null);
    expect(sent.map((s) => s.file.name)).toEqual(["a", "b", "c"]);
    expect(statuses(manager)).toEqual(["a:uploading", "b:uploading", "c:uploading", "d:queued", "e:queued"]);

    sent[1].finish();
    await flush();
    expect(sent.map((s) => s.file.name)).toEqual(["a", "b", "c", "d"]);
    expect(statuses(manager)).toEqual(["a:uploading", "b:done", "c:uploading", "d:uploading", "e:queued"]);
  });

  it("regista o progresso e marca o ficheiro como concluído com todos os bytes", async () => {
    const { manager, sent } = setup();
    manager.add([file("a", 10)], null);
    sent[0].progress(4, 10);
    expect(manager.getSnapshot()[0]).toMatchObject({ status: "uploading", loaded: 4, size: 10 });
    sent[0].finish();
    await flush();
    expect(manager.getSnapshot()[0]).toMatchObject({ status: "done", loaded: 10 });
  });

  it("um erro fica no item com a mensagem e não pára os outros; onSettled avisa de todos", async () => {
    const { manager, sent, onSettled } = setup();
    manager.add([file("a"), file("b")], "pasta");
    sent[0].fail(new ApiRequestError(409, "name_taken", "Já existe um ficheiro com esse nome neste local."));
    sent[1].finish();
    await flush();
    expect(manager.getSnapshot()).toMatchObject([
      { name: "a", status: "error", message: "Já existe um ficheiro com esse nome neste local." },
      { name: "b", status: "done" },
    ]);
    expect(onSettled).toHaveBeenCalledTimes(2);
    expect(onSettled.mock.calls.map(([item]) => item.name)).toEqual(["a", "b"]);
  });

  it("recusa logo, sem enviar, um ficheiro acima do limite", () => {
    const { manager, sent } = setup(5);
    manager.add([file("grande", 6), file("pequeno", 5)], null);
    expect(statuses(manager)).toEqual(["grande:error", "pequeno:uploading"]);
    expect(manager.getSnapshot()[0].message).toBe("O ficheiro excede o limite de 5 B.");
    expect(sent.map((s) => s.file.name)).toEqual(["pequeno"]);
  });

  it("fixa a pasta de destino quando o ficheiro entra na fila", () => {
    const { manager, sent } = setup();
    manager.add([file("a")], "pasta-1");
    manager.add([file("b")], null);
    expect(sent.map((s) => s.folderId)).toEqual(["pasta-1", null]);
  });

  it("cancelar um ficheiro em espera tira-o da fila", () => {
    const { manager, sent } = setup();
    manager.add(["a", "b", "c", "d"].map((name) => file(name)), null);
    manager.cancel(manager.getSnapshot()[3].id);
    expect(statuses(manager)).toEqual(["a:uploading", "b:uploading", "c:uploading"]);
    expect(sent).toHaveLength(3);
  });

  it("cancelar um envio em curso aborta-o, tira-o da lista e deixa arrancar o seguinte", async () => {
    const { manager, sent, onSettled } = setup();
    manager.add(["a", "b", "c", "d"].map((name) => file(name)), null);
    manager.cancel(manager.getSnapshot()[0].id);
    await flush();
    expect(sent[0].aborted).toBe(true);
    expect(statuses(manager)).toEqual(["b:uploading", "c:uploading", "d:uploading"]);
    expect(onSettled).toHaveBeenCalledTimes(1); // o servidor pode ter mexido na quota: atualizar na mesma
  });

  it("limpar os terminados mantém o que está em curso ou em espera", async () => {
    const { manager, sent } = setup();
    manager.add(["a", "b", "c", "d"].map((name) => file(name)), null);
    sent[0].finish();
    sent[1].fail(new ApiRequestError(500, "internal_error", "Erro interno do servidor."));
    await flush();
    manager.clearFinished();
    expect(statuses(manager)).toEqual(["c:uploading", "d:uploading"]);
  });

  it("avisa os ouvintes a cada mudança e só troca o snapshot quando algo mudou", () => {
    const { manager } = setup();
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    const before = manager.getSnapshot();
    expect(manager.getSnapshot()).toBe(before);
    manager.add([file("a")], null);
    expect(listener).toHaveBeenCalled();
    expect(manager.getSnapshot()).not.toBe(before);
    unsubscribe();
    listener.mockClear();
    manager.clearFinished();
    expect(listener).not.toHaveBeenCalled();
  });

  it("um onSettled que lança não pára a fila: os itens em espera arrancam na mesma", async () => {
    const fake = fakeUploads();
    const onSettled = vi.fn(() => {
      throw new Error("Falha ao atualizar quota");
    });
    const manager = new UploadManager({ maxUploadBytes: () => Infinity, onSettled, upload: fake.upload });
    manager.add(["a", "b", "c", "d"].map((name) => file(name)), null);
    expect(statuses(manager)).toEqual(["a:uploading", "b:uploading", "c:uploading", "d:queued"]);
    fake.sent[0].finish(); // o 1.º termina e onSettled lança
    await flush();
    expect(statuses(manager)).toEqual(["a:done", "b:uploading", "c:uploading", "d:uploading"]); // o 4.º arrancou apesar do erro
  });

  it("cancelAll aborta o que está a decorrer, tira o que espera e nada arranca depois", async () => {
    const { manager, sent, onSettled } = setup();
    manager.add(["a", "b", "c", "d"].map((name) => file(name)), null);
    expect(sent).toHaveLength(3);

    manager.cancelAll();
    await flush();

    expect(sent.map((s) => s.aborted)).toEqual([true, true, true]);
    expect(manager.getSnapshot()).toEqual([]);
    expect(sent).toHaveLength(3); // o 4.º, que estava em espera, não arrancou quando os outros foram abortados
    expect(onSettled).toHaveBeenCalledTimes(3); // só os abortados avisam; o que esperava nunca chegou a enviar
  });

  it("cancelAll numa fila vazia não faz nada nem lança", () => {
    const { manager, sent } = setup();
    const listener = vi.fn();
    manager.subscribe(listener);
    expect(() => manager.cancelAll()).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
    expect(manager.getSnapshot()).toEqual([]);
    expect(sent).toHaveLength(0);
  });
});
