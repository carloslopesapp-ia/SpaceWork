import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AdminUser } from "../../shared/types";
import { apiError, json, ME, mockApi, SESSION } from "../test/mock-api";
import { renderApp } from "../test/render";

const CREATED = new Date(2026, 9, 3, 12).getTime();
const ADMIN_ME = { ...ME, id: "adm", email: "admin@example.com", role: "admin" as const, quotaBytes: 10_737_418_240 };

const ADMIN: AdminUser = { id: "adm", email: "admin@example.com", role: "admin", status: "active", approved: true, quotaBytes: 10_737_418_240, usedBytes: 0, createdAt: CREATED };
const ANA: AdminUser = { id: "u1", email: "ana@example.com", role: "user", status: "active", approved: true, quotaBytes: 1_073_741_824, usedBytes: 536_870_912, createdAt: CREATED + 1000 };
const BOB: AdminUser = { id: "u2", email: "bob@example.com", role: "user", status: "suspended", approved: true, quotaBytes: 1_073_741_824, usedBytes: 1536, createdAt: CREATED + 2000 };
const EVA: AdminUser = { id: "u3", email: "eva@example.com", role: "user", status: "deleting", approved: true, quotaBytes: 1_073_741_824, usedBytes: 0, createdAt: CREATED + 3000 };

const NOVA: AdminUser = { id: "u4", email: "nova@example.com", role: "user", status: "active", approved: false, quotaBytes: 1_073_741_824, usedBytes: 0, createdAt: CREATED + 4000 };
const OUTRA: AdminUser = { id: "u5", email: "outra@example.com", role: "user", status: "active", approved: false, quotaBytes: 1_073_741_824, usedBytes: 0, createdAt: CREATED + 5000 };

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

describe("AdminPage: ações", () => {
  it("suspender uma conta atualiza o estado na tabela e o menu passa a oferecer «Reativar»", async () => {
    let suspended = false;
    const server = serve([ADMIN, ANA], {
      "GET /api/admin/users": () => json({ users: [ADMIN, suspended ? { ...ANA, status: "suspended" } : ANA] }),
      "PATCH /api/admin/users/:id": () => {
        suspended = true;
        return json({ user: { ...ANA, status: "suspended" } });
      },
    });
    const user = userEvent.setup();
    renderApp("/admin");
    await user.click(await screen.findByRole("button", { name: "Ações para a conta ana@example.com" }));
    await user.click(screen.getByRole("menuitem", { name: "Suspender…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Suspender" }));

    const row = (await screen.findByText("Suspensa")).closest("tr")!;
    expect(within(row).getByText("ana@example.com")).toBeInTheDocument();
    expect(server.callsTo("PATCH /api/admin/users/:id")[0].body).toEqual({ status: "suspended" });
    await user.click(within(row).getByRole("button", { name: "Ações para a conta ana@example.com" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toContain("Reativar");
  });

  it("apagar uma conta passa-a a «A remover», sem menu de ações", async () => {
    let deleting = false;
    serve([ADMIN, ANA], {
      "GET /api/admin/users": () => json({ users: [ADMIN, deleting ? { ...ANA, status: "deleting" } : ANA] }),
      "DELETE /api/admin/users/:id": () => {
        deleting = true;
        return new Response(null, { status: 204 });
      },
    });
    const user = userEvent.setup();
    renderApp("/admin");
    await user.click(await screen.findByRole("button", { name: "Ações para a conta ana@example.com" }));
    await user.click(screen.getByRole("menuitem", { name: "Apagar conta…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Apagar conta" }));

    const row = (await screen.findByText("A remover")).closest("tr")!;
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a conta de administrador só tem «Alterar quota…», e mudar a própria quota atualiza a barra lateral", async () => {
    let quota = 10_737_418_240;
    const server = serve([], {
      "GET /api/auth/me": () => json({ user: { ...ADMIN_ME, quotaBytes: quota } }),
      "GET /api/admin/users": () => json({ users: [{ ...ADMIN, quotaBytes: quota }] }),
      "PATCH /api/admin/users/:id": ({ body }) => {
        quota = (body as { quotaBytes: number }).quotaBytes;
        return json({ user: { ...ADMIN, quotaBytes: quota } });
      },
    });
    const user = userEvent.setup();
    renderApp("/admin");
    await user.click(await screen.findByRole("button", { name: "Ações para a conta admin@example.com" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Alterar quota…"]);
    await user.click(screen.getByRole("menuitem", { name: "Alterar quota…" }));
    await user.clear(screen.getByLabelText("Quota (GB)"));
    await user.type(screen.getByLabelText("Quota (GB)"), "20");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.callsTo("PATCH /api/admin/users/:id")[0].body).toEqual({ quotaBytes: 21_474_836_480 });
    // a barra lateral (a sessão foi refeita) e a tabela mostram a quota nova
    await waitFor(() => expect(screen.getAllByText("0 B de 20 GB")).toHaveLength(2));
  });
});

describe("AdminPage: contas por aprovar", () => {
  it("mostra «Aguarda aprovação» e só «Aprovar» e «Rejeitar…» nessas contas, e diz quantas são", async () => {
    serve([NOVA, OUTRA, ADMIN, ANA]);
    renderApp("/admin");

    expect(await screen.findByText("2 contas aguardam a sua aprovação.")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    const nova = rows[0];
    expect(within(nova).getByText("nova@example.com")).toBeInTheDocument();
    expect(within(nova).getByText("Aguarda aprovação")).toBeInTheDocument();
    expect(within(nova).getByRole("button", { name: "Aprovar a conta nova@example.com" })).toBeInTheDocument();
    expect(within(nova).getByRole("button", { name: "Rejeitar o pedido de nova@example.com" })).toBeInTheDocument();
    expect(within(nova).queryByRole("button", { name: /^Ações para a conta/ })).not.toBeInTheDocument();
    // as outras contas continuam com o menu de sempre
    expect(within(rows[3]).getByRole("button", { name: "Ações para a conta ana@example.com" })).toBeInTheDocument();
  });

  it("no singular a mensagem concorda", async () => {
    serve([NOVA, ADMIN]);
    renderApp("/admin");
    expect(await screen.findByText("1 conta aguarda a sua aprovação.")).toBeInTheDocument();
  });

  it("sem contas por aprovar não aparece a mensagem", async () => {
    serve([ADMIN, ANA]);
    renderApp("/admin");
    await screen.findByRole("heading", { name: "Utilizadores" });
    expect(screen.queryByText(/aguarda(m)? a sua aprovação/)).not.toBeInTheDocument();
  });

  it("aprovar passa a conta a «Ativa», com o menu normal, e o contador da barra lateral baixa", async () => {
    let approved = false;
    const server = serve([], {
      "GET /api/auth/me": () => json({ user: { ...ADMIN_ME, pendingApprovals: approved ? 0 : 1 } }),
      "GET /api/admin/users": () => json({ users: [approved ? { ...NOVA, approved: true } : NOVA, ADMIN] }),
      "PATCH /api/admin/users/:id": () => {
        approved = true;
        return json({ user: { ...NOVA, approved: true } });
      },
    });
    const user = userEvent.setup();
    renderApp("/admin");
    expect(await screen.findByRole("link", { name: "Admin, 1 conta por aprovar" })).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Aprovar a conta nova@example.com" }));

    const row = (await screen.findByRole("button", { name: "Ações para a conta nova@example.com" })).closest("tr")!;
    expect(within(row).getByText("Ativa")).toBeInTheDocument();
    expect(within(row).queryByText("Aguarda aprovação")).not.toBeInTheDocument();
    expect(server.callsTo("PATCH /api/admin/users/:id")[0].body).toEqual({ approved: true });
    expect(screen.queryByText(/aguarda(m)? a sua aprovação/)).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Admin" })).toBeInTheDocument();
  });

  it("rejeitar pede confirmação e a conta desaparece da lista", async () => {
    let rejected = false;
    const server = serve([], {
      "GET /api/admin/users": () => json({ users: rejected ? [ADMIN] : [NOVA, ADMIN] }),
      "DELETE /api/admin/users/:id": () => {
        rejected = true;
        return new Response(null, { status: 204 });
      },
    });
    const user = userEvent.setup();
    renderApp("/admin");
    await user.click(await screen.findByRole("button", { name: "Rejeitar o pedido de nova@example.com" }));
    await user.click(within(screen.getByRole("dialog", { name: "Rejeitar pedido" })).getByRole("button", { name: "Rejeitar" }));

    await waitFor(() => expect(screen.queryByText("nova@example.com")).not.toBeInTheDocument());
    expect(server.callsTo("DELETE /api/admin/users/:id")[0].params).toEqual({ id: "u4" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
