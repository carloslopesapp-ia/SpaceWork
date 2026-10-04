import { vi } from "vitest";

interface ProgressLike {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

/** `XMLHttpRequest` falso: o jsdom não simula o envio nem o progresso. Os testes comandam-no com `progress`, `respond` e `fail`. */
export class FakeXhr {
  static instances: FakeXhr[] = [];

  method = "";
  url = "";
  sent: unknown = undefined;
  status = 0;
  responseText = "";
  upload: { onprogress: ((event: ProgressLike) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  send(body: unknown): void {
    this.sent = body;
  }

  abort(): void {
    this.onabort?.();
  }

  progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }

  respond(status: number, body: unknown): void {
    this.status = status;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    this.onload?.();
  }

  fail(): void {
    this.onerror?.();
  }
}

/** Põe o `FakeXhr` no lugar do `XMLHttpRequest` (o `setup.ts` repõe o real no fim de cada teste). */
export function stubXhr(): typeof FakeXhr {
  FakeXhr.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return FakeXhr;
}
