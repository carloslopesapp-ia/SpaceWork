import { render, renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useMe } from "./auth";
import { useConfig } from "./space";
import {
  UploadsProvider,
  useUploadActions,
  useUploads,
  useUploadsBusy,
  type UploadActions,
} from "./uploads-context";
import { stubXhr } from "./test/fake-xhr";
import { json, ME, mockApi } from "./test/mock-api";
import { queryWrapper, testQueryClient } from "./test/render";

const FILE_ITEM = { id: "f1", name: "a.txt", folderId: null, size: 3, mime: "text/plain", createdAt: 1 };

/** `refreshWindowMs` curto: os testes esperam de verdade por ele (relógios reais). */
function setup(maxUploadBytes = 1000, refreshWindowMs = 20) {
  const Xhr = stubXhr();
  let usedBytes = 0;
  const server = mockApi({
    "GET /api/config": () => json({ maxUploadBytes }),
    "GET /api/auth/me": () => json({ user: { ...ME, usedBytes } }),
  });
  const client = testQueryClient();
  const Query = queryWrapper(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Query>
      <UploadsProvider refreshWindowMs={refreshWindowMs}>{children}</UploadsProvider>
    </Query>
  );
  const hook = renderHook(() => ({ uploads: useUploads(), me: useMe(), config: useConfig() }), { wrapper });
  return { hook, server, Xhr, client, setUsed: (bytes: number) => (usedBytes = bytes) };
}

const isBlocked = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

afterEach(() => vi.restoreAllMocks());

describe("UploadsProvider", () => {
  it("envia, mostra o estado e, quando termina, atualiza o espaço usado", async () => {
    const { hook, Xhr, setUsed } = setup();
    await waitFor(() => expect(hook.result.current.me.data?.usedBytes).toBe(0));

    act(() => hook.result.current.uploads.add([new File(["abc"], "a.txt")], "pasta-1"));
    expect(Xhr.instances[0].url).toBe("/api/files?name=a.txt&folder=pasta-1");
    expect(hook.result.current.uploads.items[0]).toMatchObject({ name: "a.txt", status: "uploading" });

    setUsed(3);
    act(() => Xhr.instances[0].respond(201, { file: FILE_ITEM }));
    await waitFor(() => expect(hook.result.current.uploads.items[0].status).toBe("done"));
    await waitFor(() => expect(hook.result.current.me.data?.usedBytes).toBe(3));
  });

  it("recusa logo um ficheiro acima do limite do servidor (GET /api/config), sem o enviar", async () => {
    const { hook, Xhr } = setup(2);
    await waitFor(() => expect(hook.result.current.config.data).toEqual({ maxUploadBytes: 2 }));

    act(() => hook.result.current.uploads.add([new File(["abc"], "grande.txt")], null));

    expect(hook.result.current.uploads.items[0]).toMatchObject({
      status: "error",
      message: "O ficheiro excede o limite de 2 B.",
    });
    expect(Xhr.instances).toHaveLength(0);
  });

  it("avisa antes de fechar o separador enquanto há envios, e só então", async () => {
    const { hook, Xhr } = setup();
    expect(isBlocked()).toBe(false);
    act(() => hook.result.current.uploads.add([new File(["abc"], "a.txt")], null));
    await waitFor(() => expect(isBlocked()).toBe(true));
    act(() => Xhr.instances[0].respond(201, { file: FILE_ITEM }));
    await waitFor(() => expect(isBlocked()).toBe(false));
  });

  it("`useUploads` fora do provider é um erro claro", () => {
    expect(() => renderHook(() => useUploads())).toThrow("UploadsProvider");
  });

  it("ao desmontar o provider (logout, erro de sessão) aborta os envios em curso e não arranca os que esperavam", async () => {
    const { hook, Xhr } = setup();
    const abort = vi.spyOn(Xhr.prototype, "abort");
    act(() => hook.result.current.uploads.add(["a", "b", "c", "d"].map((name) => new File(["abc"], `${name}.txt`)), null));
    expect(Xhr.instances).toHaveLength(3);
    expect(abort).not.toHaveBeenCalled();

    hook.unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(abort).toHaveBeenCalledTimes(3);
    expect(Xhr.instances).toHaveLength(3); // o 4.º ficheiro, em espera, não arrancou
  });
});

describe("UploadsProvider: um refresh por intervalo", () => {
  /** A sessão (`GET /api/auth/me`) é pedida uma vez ao início e outra por cada refresh do espaço. */
  const sessionCalls = (server: ReturnType<typeof setup>["server"]) => server.callsTo("GET /api/auth/me").length;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("vários envios que terminam juntos dão um só refresh, e só depois do intervalo", async () => {
    const { hook, server, Xhr } = setup(1000, 150);
    await waitFor(() => expect(hook.result.current.me.data).toBeDefined());
    expect(sessionCalls(server)).toBe(1);

    act(() => hook.result.current.uploads.add(["a", "b", "c"].map((name) => new File(["abc"], `${name}.txt`)), null));
    act(() => Xhr.instances.forEach((xhr) => xhr.respond(201, { file: FILE_ITEM })));
    await waitFor(() => expect(hook.result.current.uploads.items.every((item) => item.status === "done")).toBe(true));
    expect(sessionCalls(server)).toBe(1); // o intervalo ainda não acabou: nenhum refresh

    await waitFor(() => expect(sessionCalls(server)).toBe(2));
    await sleep(300);
    expect(sessionCalls(server)).toBe(2); // um só para os três
  });

  it("um envio que termina depois do refresh arma outro", async () => {
    const { hook, server, Xhr } = setup(1000, 50);
    await waitFor(() => expect(hook.result.current.me.data).toBeDefined());

    act(() => hook.result.current.uploads.add([new File(["abc"], "a.txt")], null));
    act(() => Xhr.instances[0].respond(201, { file: FILE_ITEM }));
    await waitFor(() => expect(sessionCalls(server)).toBe(2));

    act(() => hook.result.current.uploads.add([new File(["abc"], "b.txt")], null));
    act(() => Xhr.instances[1].respond(201, { file: FILE_ITEM }));
    await waitFor(() => expect(sessionCalls(server)).toBe(3));
  });

  it("um envio que falha também conta (a quota e as listagens podem ter mudado)", async () => {
    const { hook, server, Xhr } = setup(1000, 50);
    await waitFor(() => expect(hook.result.current.me.data).toBeDefined());

    act(() => hook.result.current.uploads.add([new File(["abc"], "a.txt")], null));
    act(() => Xhr.instances[0].respond(413, { error: "quota_exceeded", message: "Sem espaço suficiente na sua quota." }));
    await waitFor(() => expect(sessionCalls(server)).toBe(2));
  });

  it("ao desmontar o provider não fica um refresh agendado", async () => {
    const { hook, server, Xhr, client } = setup(1000, 100);
    await waitFor(() => expect(hook.result.current.me.data).toBeDefined());
    // Outro observador da sessão, fora do provider, para um refresh agendado se notar nos pedidos.
    const observer = renderHook(() => useMe(), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(observer.result.current.isFetching).toBe(false));
    const before = sessionCalls(server);

    act(() => hook.result.current.uploads.add([new File(["abc"], "a.txt")], null));
    act(() => Xhr.instances[0].respond(201, { file: FILE_ITEM }));
    await waitFor(() => expect(hook.result.current.uploads.items[0].status).toBe("done"));
    hook.unmount();
    await sleep(300);

    expect(sessionCalls(server)).toBe(before);
  });
});

describe("UploadsProvider: ações, «ocupado» e lista em contextos separados", () => {
  it("as ações são sempre as mesmas e não re-renderizam com o progresso; «ocupado» só quando muda; a lista a cada passo", async () => {
    const Xhr = stubXhr();
    mockApi({ "GET /api/config": () => json({ maxUploadBytes: 1000 }), "GET /api/auth/me": () => json({ user: ME }) });
    const renders = { actions: 0, busy: 0, items: 0 };
    let actions!: UploadActions;
    let busy = false;
    function ActionsConsumer() {
      renders.actions++;
      actions = useUploadActions();
      return null;
    }
    function BusyConsumer() {
      renders.busy++;
      busy = useUploadsBusy();
      return null;
    }
    function ItemsConsumer() {
      renders.items++;
      useUploads();
      return null;
    }
    const Query = queryWrapper(testQueryClient());
    render(
      <Query>
        <UploadsProvider>
          <ActionsConsumer />
          <BusyConsumer />
          <ItemsConsumer />
        </UploadsProvider>
      </Query>,
    );
    const first = actions;
    const base = { ...renders };
    expect(busy).toBe(false);

    act(() => actions.add([new File(["abc"], "a.txt")], null));
    expect(busy).toBe(true);
    const afterAdd = renders.items;
    act(() => Xhr.instances[0].progress(1, 3));
    act(() => Xhr.instances[0].progress(2, 3));

    expect(renders.items).toBeGreaterThan(afterAdd); // a lista re-renderiza com o progresso
    expect(renders.busy - base.busy).toBe(1); // «ocupado» passou de falso a verdadeiro, e só isso
    expect(renders.actions).toBe(base.actions); // as ações não re-renderizaram
    act(() => Xhr.instances[0].respond(201, { file: FILE_ITEM }));
    await waitFor(() => expect(busy).toBe(false));
    expect(renders.busy - base.busy).toBe(2);
    expect(renders.actions).toBe(base.actions);
    expect(actions).toBe(first);
  });

  it("os hooks fora do provider são um erro claro", () => {
    expect(() => renderHook(() => useUploadActions())).toThrow("UploadsProvider");
    expect(() => renderHook(() => useUploadsBusy())).toThrow("UploadsProvider");
  });
});
