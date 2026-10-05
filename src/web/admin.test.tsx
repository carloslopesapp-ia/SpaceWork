import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AdminUser } from "../shared/types";
import { MAX_QUOTA_BYTES } from "../shared/validation";
import { parseQuotaGb, quotaToGbText, useAdminUsers, useDeleteUser, useUpdateUser } from "./admin";
import { useMe } from "./auth";
import { apiError, json, ME, mockApi, noContent } from "./test/mock-api";
import { queryWrapper, testQueryClient } from "./test/render";

const ANA: AdminUser = { id: "u 1", email: "ana@example.com", role: "user", status: "active", quotaBytes: 100, usedBytes: 10, createdAt: 1 };

describe("useAdminUsers", () => {
  it("devolve as contas", async () => {
    mockApi({ "GET /api/admin/users": () => json({ users: [ANA] }) });
    const { result } = renderHook(() => useAdminUsers(), { wrapper: queryWrapper(testQueryClient()) });
    await waitFor(() => expect(result.current.data).toEqual([ANA]));
  });

  it("não pede nada com `enabled: false` (quem não é administrador levaria um 403)", async () => {
    const server = mockApi({ "GET /api/admin/users": () => apiError(403, "forbidden", "Só o administrador pode fazer isto.") });
    const { result } = renderHook(() => useAdminUsers({ enabled: false }), { wrapper: queryWrapper(testQueryClient()) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.fetchStatus).toBe("idle");
    expect(server.calls).toHaveLength(0);
  });
});

describe("mutações do painel", () => {
  it("atualizar uma conta envia só o que mudou, com o id codificado, e refaz a lista e a sessão", async () => {
    const server = mockApi({
      "GET /api/admin/users": () => json({ users: [ANA] }),
      "GET /api/auth/me": () => json({ user: ME }),
      "PATCH /api/admin/users/:id": () => json({ user: { ...ANA, quotaBytes: 200 } }),
    });
    const wrapper = queryWrapper(testQueryClient());
    const hook = renderHook(() => ({ users: useAdminUsers(), me: useMe(), update: useUpdateUser() }), { wrapper });
    await waitFor(() => expect(hook.result.current.users.isSuccess && hook.result.current.me.isSuccess).toBe(true));

    await act(async () => {
      await hook.result.current.update.mutateAsync({ id: "u 1", quotaBytes: 200 });
      await hook.result.current.update.mutateAsync({ id: "u 1", status: "suspended" });
    });

    const [quota, status] = server.callsTo("PATCH /api/admin/users/:id");
    expect(quota).toMatchObject({ path: "/api/admin/users/u%201", body: { quotaBytes: 200 } });
    expect(status.body).toEqual({ status: "suspended" });
    await waitFor(() => {
      expect(server.callsTo("GET /api/admin/users").length).toBeGreaterThanOrEqual(2);
      expect(server.callsTo("GET /api/auth/me").length).toBeGreaterThanOrEqual(2);
    });
  });

  it("apagar usa DELETE com o id codificado e refaz a lista; um erro também a refaz", async () => {
    let fail = false;
    const server = mockApi({
      "GET /api/admin/users": () => json({ users: [ANA] }),
      "DELETE /api/admin/users/:id": () => (fail ? apiError(403, "admin_protected", "Uma conta de administrador não se pode suspender nem apagar.") : noContent()),
    });
    const wrapper = queryWrapper(testQueryClient());
    const hook = renderHook(() => ({ users: useAdminUsers(), remove: useDeleteUser() }), { wrapper });
    await waitFor(() => expect(hook.result.current.users.isSuccess).toBe(true));

    await act(() => hook.result.current.remove.mutateAsync("u 1"));
    expect(server.callsTo("DELETE /api/admin/users/:id")[0]).toMatchObject({ method: "DELETE", path: "/api/admin/users/u%201" });
    await waitFor(() => expect(server.callsTo("GET /api/admin/users")).toHaveLength(2));

    fail = true;
    await act(() => hook.result.current.remove.mutateAsync("u 1").catch(() => undefined));
    await waitFor(() => expect(hook.result.current.remove.error?.message).toBe("Uma conta de administrador não se pode suspender nem apagar."));
    await waitFor(() => expect(server.callsTo("GET /api/admin/users")).toHaveLength(3));
  });
});

describe("quota em GB", () => {
  it("lê o campo com vírgula ou ponto e devolve bytes", () => {
    expect(parseQuotaGb("1")).toBe(1_073_741_824);
    expect(parseQuotaGb(" 2,5 ")).toBe(2_684_354_560);
    expect(parseQuotaGb("0.25")).toBe(268_435_456);
    expect(parseQuotaGb("0")).toBe(0);
    expect(parseQuotaGb("1048576")).toBe(MAX_QUOTA_BYTES); // 1 PiB
  });

  it("recusa o que não é um número, é negativo ou passa o máximo", () => {
    for (const text of ["", " ", "abc", "-1", "1,2,3", "1e3", "1048577", "1 GB", "Infinity", "0x10"]) {
      expect(parseQuotaGb(text), JSON.stringify(text)).toBeNull();
    }
  });

  it("mostra a quota atual com vírgula e até duas casas", () => {
    expect(quotaToGbText(1_073_741_824)).toBe("1");
    expect(quotaToGbText(1_610_612_736)).toBe("1,5");
    expect(quotaToGbText(10_737_418_240)).toBe("10");
    expect(quotaToGbText(0)).toBe("0");
    expect(quotaToGbText(1_000_000_000)).toBe("0,93");
  });
});
