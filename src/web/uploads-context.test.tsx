import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { useMe } from "./auth";
import { useConfig } from "./space";
import { useUploads, UploadsProvider } from "./uploads-context";
import { stubXhr } from "./test/fake-xhr";
import { json, ME, mockApi } from "./test/mock-api";
import { queryWrapper, testQueryClient } from "./test/render";

const FILE_ITEM = { id: "f1", name: "a.txt", folderId: null, size: 3, mime: "text/plain", createdAt: 1 };

function setup(maxUploadBytes = 1000) {
  const Xhr = stubXhr();
  let usedBytes = 0;
  const server = mockApi({
    "GET /api/config": () => json({ maxUploadBytes }),
    "GET /api/auth/me": () => json({ user: { ...ME, usedBytes } }),
  });
  const Query = queryWrapper(testQueryClient());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Query>
      <UploadsProvider>{children}</UploadsProvider>
    </Query>
  );
  const hook = renderHook(() => ({ uploads: useUploads(), me: useMe(), config: useConfig() }), { wrapper });
  return { hook, server, Xhr, setUsed: (bytes: number) => (usedBytes = bytes) };
}

const isBlocked = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

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
});
