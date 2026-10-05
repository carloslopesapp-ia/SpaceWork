import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AdminUser } from "../shared/types";
import { useAdminUsers, useDeleteUser, useUpdateUser } from "./admin";
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
