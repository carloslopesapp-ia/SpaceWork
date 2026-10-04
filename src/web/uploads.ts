import { formatBytes } from "../shared/format";
import { ApiRequestError, errorMessage } from "./api";
import { ABORTED_CODE, uploadFile, type UploadHandle } from "./upload";

export type UploadStatus = "queued" | "uploading" | "done" | "error";

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  /** Pasta de destino, fixada quando o ficheiro entra na fila (o utilizador pode mudar de pasta entretanto). */
  folderId: string | null;
  status: UploadStatus;
  /** Bytes já enviados. */
  loaded: number;
  /** O que correu mal, quando `status` é "error". */
  message?: string;
}

/** Envios em simultâneo: mais do que isto só reparte a mesma largura de banda e gasta ligações. */
export const MAX_PARALLEL_UPLOADS = 3;

export interface UploadManagerOptions {
  /** Tamanho máximo de um ficheiro (`Infinity` enquanto não se conhece). Um ficheiro maior nem sai do browser. */
  maxUploadBytes: () => number;
  /** Chamado quando um envio termina, com êxito, erro ou cancelado: serve para atualizar listagens e quota. */
  onSettled: (item: UploadItem) => void;
  /** Só os testes trocam isto. */
  upload?: typeof uploadFile;
}

/**
 * Fila de envios com no máximo `MAX_PARALLEL_UPLOADS` a decorrer. Vive fora do React para sobreviver à navegação
 * entre pastas; a interface lê-a com `useSyncExternalStore` (`subscribe` e `getSnapshot`).
 */
export class UploadManager {
  private items: readonly UploadItem[] = [];
  private readonly files = new Map<string, File>();
  private readonly handles = new Map<string, UploadHandle>();
  private readonly listeners = new Set<() => void>();
  private readonly options: UploadManagerOptions;
  private nextId = 1;

  constructor(options: UploadManagerOptions) {
    this.options = options;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** A lista atual; só muda de identidade quando há alterações (é o que o `useSyncExternalStore` exige). */
  getSnapshot = (): readonly UploadItem[] => this.items;

  /** Põe ficheiros na fila para a pasta indicada (`null` = raiz). */
  add = (files: File[], folderId: string | null): void => {
    const max = this.options.maxUploadBytes();
    const added: UploadItem[] = [];
    for (const file of files) {
      const base = { id: `upload-${this.nextId++}`, name: file.name, size: file.size, folderId, loaded: 0 };
      if (file.size > max) {
        added.push({ ...base, status: "error", message: `O ficheiro excede o limite de ${formatBytes(max)}.` });
      } else {
        this.files.set(base.id, file);
        added.push({ ...base, status: "queued" });
      }
    }
    this.set([...this.items, ...added]);
    this.pump();
  };

  /** Tira da fila um ficheiro em espera ou aborta o que está a ser enviado (em ambos os casos o item desaparece). */
  cancel = (id: string): void => {
    const handle = this.handles.get(id);
    if (handle) {
      handle.abort(); // a promessa falha com `aborted` e `finish` remove o item
      return;
    }
    if (this.items.find((item) => item.id === id)?.status === "queued") {
      this.files.delete(id);
      this.set(this.items.filter((item) => item.id !== id));
    }
  };

  /**
   * Cancela tudo: tira da fila os ficheiros em espera e aborta os envios em curso (todos desaparecem da lista), para que
   * uma fila órfã (o provider foi desmontado, por exemplo no fim da sessão) não continue a enviar ficheiros.
   */
  cancelAll = (): void => {
    // Primeiro os que esperam: cada `abort` acaba em `finish` -> `pump()`, que senão arrancava um deles.
    const waiting = this.items.filter((item) => item.status === "queued");
    if (waiting.length > 0) {
      for (const item of waiting) this.files.delete(item.id);
      this.set(this.items.filter((item) => item.status !== "queued"));
    }
    for (const handle of [...this.handles.values()]) handle.abort();
  };

  /** Tira da lista os envios terminados (com êxito ou com erro). */
  clearFinished = (): void => {
    const running = this.items.filter((item) => item.status === "queued" || item.status === "uploading");
    if (running.length !== this.items.length) this.set(running);
  };

  private set(items: readonly UploadItem[]): void {
    this.items = items;
    for (const listener of this.listeners) listener();
  }

  private update(id: string, changes: Partial<UploadItem>): void {
    this.set(this.items.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }

  private pump(): void {
    while (this.handles.size < MAX_PARALLEL_UPLOADS) {
      const next = this.items.find((item) => item.status === "queued");
      if (!next) return;
      this.start(next);
    }
  }

  private start(item: UploadItem): void {
    const file = this.files.get(item.id)!;
    this.update(item.id, { status: "uploading" });
    const upload = this.options.upload ?? uploadFile;
    const handle = upload(file, item.folderId, (loaded) => this.update(item.id, { loaded }));
    this.handles.set(item.id, handle);
    handle.promise.then(
      () => this.finish(item.id, { status: "done", loaded: file.size }),
      (error: unknown) => {
        const aborted = error instanceof ApiRequestError && error.code === ABORTED_CODE;
        this.finish(item.id, aborted ? null : { status: "error", message: errorMessage(error) });
      },
    );
  }

  /** `changes` a `null` = envio cancelado: o item desaparece. */
  private finish(id: string, changes: Partial<UploadItem> | null): void {
    this.handles.delete(id);
    this.files.delete(id);
    const before = this.items.find((item) => item.id === id);
    if (changes === null) this.set(this.items.filter((item) => item.id !== id));
    else this.update(id, changes);
    try {
      if (before) this.options.onSettled({ ...before, ...changes });
    } catch {
      // Um aviso de atualização falhado não deve parar a fila: a atualização de quota ou
      // listagem é secundária ao progresso do envio. Engolir o erro aqui evita uma promessa
      // rejeitada não tratada e garante que a fila continua com os itens seguintes.
    } finally {
      this.pump();
    }
  }
}
