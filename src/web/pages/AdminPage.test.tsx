import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AdminUser } from "../../shared/types";
import { apiError, json, ME, mockApi, SESSION } from "../test/mock-api";
import { renderApp } from "../test/render";

const CREATED = new Date(2026, 9, 3, 12).getTime();
const ADMIN_ME = { ...ME, id: "adm", email: "admin@example.com", role: "admin" as const, quotaBytes: 10_737_418_240 };

const ADMIN: AdminUser = { id: "adm", email: "admin@example.com", role: "admin", status: "active", quotaBytes: 10_737_418_240, usedBytes: 0, createdAt: CREATED };
const ANA: AdminUser = { id: "u1", email: "ana@example.com", role: "user", status: "active", quotaBytes: 1_073_741_824, usedBytes: 536_870_912, createdAt: CREATED + 1000 };
const BOB: AdminUser = { id: "u2", email: "bob@example.com", role: "user", status: "suspended", quotaBytes: 1_073_741_824, usedBytes: 1536, createdAt: CREATED + 2000 };
const EVA: AdminUser = { id: "u3", email: "eva@example.com", role: "user", status: "deleting", quotaBytes: 1_073_741_824, usedBytes: 0, createdAt: CREATED + 3000 };

function serve(users: AdminUser[], extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    ...SESSION,
    "GET /api/auth/me": () => json({ user: ADMIN_ME }),
    "GET /api/folders/:id/contents": () => json({ folder: null, breadcrumb: [], folders: [], files: [] }),
    "GET /api/admin/users": () => json({ users }),
    ...extra,
  });
}

describe("AdminPage", () => {
  it("lista as contas com o espaço usado, o estado e a data, e marca o administrador e a própria conta", async () => {
    serve([ADMIN, ANA, BOB, EVA]);
    renderApp("/admin");

    expect(await screen.findByRole("heading", { name: "Utilizadores" })).toBeInTheDocument();
    expect(screen.getByText("4 contas.", { exact: false })).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1); // sem o cabeçalho
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual([
      "admin@example.com Admin (você)",
      "ana@example.com",
      "bob@example.com",
      "eva@example.com",
    ]);
    const ana = rows[1];
    expect(within(ana).getByText("512 MB de 1 GB")).toBeInTheDocument();
    expect(within(ana).getByRole("progressbar", { name: "Espaço usado por ana@example.com" })).toHaveAttribute("aria-valuenow", "50");
    expect(within(ana).getByText("Ativa")).toBeInTheDocument();
    expect(within(ana).getByText("03/10/2026")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Suspensa")).toBeInTheDocument();
    expect(within(rows[3]).getByText("A remover")).toBeInTheDocument();
  });

  it("«Admin» está na barra lateral só para o administrador, e fica ativo no painel", async () => {
    serve([ADMIN]);
    renderApp("/admin");
    const link = await screen.findByRole("link", { name: "Admin" });
    expect(link).toHaveAttribute("href", "/admin");
    expect(link.className).toContain("bg-indigo-50");
  });

  it("um utilizador normal não vê «Admin» e, se for a /admin, volta a «Meu espaço» sem pedir a lista", async () => {
    const server = mockApi({
      ...SESSION,
      "GET /api/folders/:id/contents": () => json({ folder: null, breadcrumb: [], folders: [], files: [] }),
      "GET /api/admin/users": () => apiError(403, "forbidden", "Só o administrador pode fazer isto."),
    });
    renderApp("/admin");

    expect(await screen.findByRole("heading", { name: "Meu espaço" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    expect(server.callsTo("GET /api/admin/users")).toHaveLength(0);
  });

  it("um erro do servidor mostra a mensagem e deixa tentar de novo", async () => {
    let calls = 0;
    serve([], {
      "GET /api/admin/users": () => (++calls === 1 ? apiError(500, "internal_error", "Erro interno do servidor.") : json({ users: [ADMIN] })),
    });
    renderApp("/admin");
    expect(await screen.findByText("Erro interno do servidor.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByRole("cell", { name: /admin@example\.com/ })).toBeInTheDocument();
  });

  it("«Atualizar» volta a pedir as contas", async () => {
    const server = serve([ADMIN]);
    renderApp("/admin");
    await screen.findByRole("heading", { name: "Utilizadores" });
    await userEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await screen.findByRole("button", { name: "Atualizar" });
    expect(server.callsTo("GET /api/admin/users").length).toBeGreaterThanOrEqual(2);
  });
});
