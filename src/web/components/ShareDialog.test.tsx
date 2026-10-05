import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FileItem, ShareItem } from "../../shared/types";
import { apiError, json, mockApi, noContent } from "../test/mock-api";
import { queryWrapper, testQueryClient } from "../test/render";
import { ShareDialog } from "./ShareDialog";

const DAY = 86_400_000;
const FILE: FileItem = { id: "a1", name: "relatório.pdf", folderId: null, size: 10, mime: "application/pdf", createdAt: 0 };
const CREATED = new Date(2026, 9, 3, 12).getTime();
const FOREVER: ShareItem = { id: "s1", fileId: "a1", createdAt: CREATED, expiresAt: null };
const UNTIL: ShareItem = { id: "s2", fileId: "a1", createdAt: CREATED, expiresAt: new Date(2026, 10, 2, 12).getTime() };

/** Os links que o servidor falso lista; os testes mudam-no nos handlers de criar e de revogar. */
let listed: ShareItem[] = [];

function setup(shares: ShareItem[] = [], extra: Parameters<typeof mockApi>[0] = {}) {
  listed = shares;
  const server = mockApi({
    "GET /api/files/:id/shares": () => json({ shares: listed }),
    ...extra,
  });
  const onClose = vi.fn();
  const user = userEvent.setup();
  const Wrapper = queryWrapper(testQueryClient());
  render(
    <Wrapper>
      <ShareDialog file={FILE} onClose={onClose} />
    </Wrapper>,
  );
  return { server, onClose, user };
}

describe("ShareDialog", () => {
  it("mostra o nome do ficheiro e avisa que qualquer pessoa com o link pode descarregá-lo", async () => {
    setup();
    expect(await screen.findByRole("dialog", { name: "Partilhar «relatório.pdf»" })).toHaveTextContent(
      "Qualquer pessoa com o link pode descarregar este ficheiro, sem iniciar sessão.",
    );
    expect(await screen.findByText("Ainda não há links ativos.")).toBeInTheDocument();
  });

  it("lista os links ativos com a data de criação e a validade, sem endereço", async () => {
    setup([FOREVER, UNTIL]);
    const list = within(await screen.findByRole("region", { name: "Links ativos" }));
    expect(await list.findByText("Link 1: criado a 03/10/2026, sem validade")).toBeInTheDocument();
    expect(list.getByText("Link 2: criado a 03/10/2026, válido até 02/11/2026")).toBeInTheDocument();
    expect(screen.queryByLabelText("Link de partilha")).not.toBeInTheDocument();
  });

  it("criar um link sem validade envia um corpo vazio e mostra o link completo uma vez, com o aviso", async () => {
    const state = setup([], {
      "POST /api/files/:id/shares": () => {
        listed = [FOREVER];
        return json({ share: FOREVER, token: "tok-123" }, 201);
      },
    });
    await screen.findByText("Ainda não há links ativos.");

    await state.user.click(screen.getByRole("button", { name: "Criar link" }));

    const created = within(await screen.findByRole("region", { name: "Link criado" }));
    expect(created.getByLabelText("Link de partilha")).toHaveValue(`${window.location.origin}/s/tok-123`);
    expect(created.getByText(/não voltará a ser mostrado/)).toBeInTheDocument();
    expect(created.getByText(/sem validade/)).toBeInTheDocument();
    expect(state.server.callsTo("POST /api/files/:id/shares")[0]).toMatchObject({ params: { id: "a1" }, body: {} });
    expect(await screen.findByText("Link 1: criado a 03/10/2026, sem validade")).toBeInTheDocument(); // a lista atualizou-se
  });

  it("com validade de 7 dias envia o instante em que o link expira", async () => {
    const state = setup([], {
      "POST /api/files/:id/shares": () => json({ share: UNTIL, token: "tok-7" }, 201),
    });
    const before = Date.now();
    await state.user.selectOptions(await screen.findByLabelText("Validade do link"), "7 dias");
    await state.user.click(screen.getByRole("button", { name: "Criar link" }));
    await screen.findByRole("region", { name: "Link criado" });
    const after = Date.now();

    const { expiresAt } = state.server.callsTo("POST /api/files/:id/shares")[0].body as { expiresAt: number };
    expect(expiresAt).toBeGreaterThanOrEqual(before + 7 * DAY);
    expect(expiresAt).toBeLessThanOrEqual(after + 7 * DAY);
    expect(screen.getByText(/válido até 02\/11\/2026/)).toBeInTheDocument();
  });

  it("as validades são sem validade, 1, 7 e 30 dias", async () => {
    setup();
    const select = await screen.findByLabelText("Validade do link");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["Sem validade", "1 dia", "7 dias", "30 dias"]);
  });

  it("«Copiar» põe o link na área de transferência e avisa", async () => {
    const state = setup([], { "POST /api/files/:id/shares": () => json({ share: FOREVER, token: "tok-c" }, 201) });
    await state.user.click(await screen.findByRole("button", { name: "Criar link" }));
    await screen.findByRole("region", { name: "Link criado" });

    await state.user.click(screen.getByRole("button", { name: "Copiar" }));

    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/s/tok-c`);
    expect(await screen.findByText("Link copiado.")).toBeInTheDocument();
  });

  it("se não consegue copiar, seleciona o link e explica como copiar à mão", async () => {
    const state = setup([], { "POST /api/files/:id/shares": () => json({ share: FOREVER, token: "tok-f" }, 201) });
    await state.user.click(await screen.findByRole("button", { name: "Criar link" }));
    await screen.findByRole("region", { name: "Link criado" });
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("negado"));

    await state.user.click(screen.getByRole("button", { name: "Copiar" }));

    expect(await screen.findByText(/Não foi possível copiar sozinho/)).toBeInTheDocument();
    const field = screen.getByLabelText("Link de partilha") as HTMLInputElement;
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });

  it("o erro de links a mais (409) mostra a mensagem da API e não cria nada", async () => {
    const state = setup([], {
      "POST /api/files/:id/shares": () => apiError(409, "too_many_shares", "Este ficheiro já tem 20 links ativos. Revogue algum antes de criar outro."),
    });
    await state.user.click(await screen.findByRole("button", { name: "Criar link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Este ficheiro já tem 20 links ativos.");
    expect(screen.queryByRole("region", { name: "Link criado" })).not.toBeInTheDocument();
  });

  it("revogar tira o link da lista", async () => {
    const state = setup([FOREVER], {
      "DELETE /api/shares/:id": () => {
        listed = [];
        return noContent();
      },
    });
    await state.user.click(await screen.findByRole("button", { name: "Revogar o link 1, criado a 03/10/2026" }));

    expect(await screen.findByText("Ainda não há links ativos.")).toBeInTheDocument();
    expect(state.server.callsTo("DELETE /api/shares/:id")[0].params.id).toBe("s1");
  });

  it("depois de revogar com o teclado o foco continua no diálogo e o Esc fecha-o", async () => {
    const state = setup([FOREVER], {
      "DELETE /api/shares/:id": () => {
        listed = [];
        return noContent();
      },
    });
    const revoke = await screen.findByRole("button", { name: "Revogar o link 1, criado a 03/10/2026" });
    revoke.focus();
    await state.user.keyboard("{Enter}");
    expect(await screen.findByText("Ainda não há links ativos.")).toBeInTheDocument();

    await state.user.keyboard("{Escape}");

    expect(state.onClose).toHaveBeenCalledTimes(1);
  });

  it("enquanto cria o link, Esc, o fundo e «Fechar» não fecham o diálogo (o endereço só aparece uma vez)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const state = setup([], {
      "POST /api/files/:id/shares": async () => {
        await gate;
        listed = [FOREVER];
        return json({ share: FOREVER, token: "tok-p" }, 201);
      },
    });
    await state.user.click(await screen.findByRole("button", { name: "Criar link" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("button", { name: "A criar…" });

    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.mouseDown(screen.getByTestId("modal-backdrop"));

    expect(state.onClose).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Fechar" })).toBeDisabled();
    release();
    const created = within(await screen.findByRole("region", { name: "Link criado" }));
    expect(created.getByLabelText("Link de partilha")).toHaveValue(`${window.location.origin}/s/tok-p`);
    expect(within(dialog).getByRole("button", { name: "Fechar" })).toBeEnabled();
    expect(state.onClose).not.toHaveBeenCalled();
  });

  it("revogar o link que acabou de ser criado esconde o endereço, que já não funciona", async () => {
    const state = setup([], {
      "POST /api/files/:id/shares": () => {
        listed = [FOREVER];
        return json({ share: FOREVER, token: "tok-r" }, 201);
      },
      "DELETE /api/shares/:id": () => {
        listed = [];
        return noContent();
      },
    });
    await state.user.click(await screen.findByRole("button", { name: "Criar link" }));
    await screen.findByRole("region", { name: "Link criado" });

    await state.user.click(await screen.findByRole("button", { name: "Revogar o link 1, criado a 03/10/2026" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "Link criado" })).not.toBeInTheDocument());
    expect(await screen.findByText("Ainda não há links ativos.")).toBeInTheDocument();
  });

  it("revogar outro link não esconde o que acabou de ser criado", async () => {
    const state = setup([UNTIL], {
      "POST /api/files/:id/shares": () => {
        listed = [FOREVER, UNTIL];
        return json({ share: FOREVER, token: "tok-n" }, 201);
      },
      "DELETE /api/shares/:id": () => {
        listed = [FOREVER];
        return noContent();
      },
    });
    await state.user.click(await screen.findByRole("button", { name: "Criar link" }));
    await screen.findByRole("region", { name: "Link criado" });

    await state.user.click(await screen.findByRole("button", { name: "Revogar o link 2, criado a 03/10/2026" }));

    await waitFor(() => expect(state.server.callsTo("DELETE /api/shares/:id")[0].params.id).toBe("s2"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Revogar o link 2/ })).not.toBeInTheDocument());
    expect(screen.getByLabelText("Link de partilha")).toHaveValue(`${window.location.origin}/s/tok-n`);
  });

  it("um erro ao revogar mostra a mensagem e o link continua na lista", async () => {
    const state = setup([FOREVER], {
      "DELETE /api/shares/:id": () => apiError(404, "share_not_found", "Link não encontrado."),
    });
    await state.user.click(await screen.findByRole("button", { name: "Revogar o link 1, criado a 03/10/2026" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Link não encontrado.");
  });

  it("um erro a listar os links deixa tentar de novo", async () => {
    let calls = 0;
    const user = userEvent.setup();
    mockApi({
      "GET /api/files/:id/shares": () => (++calls === 1 ? apiError(500, "internal_error", "Erro interno do servidor.") : json({ shares: [FOREVER] })),
    });
    const Wrapper = queryWrapper(testQueryClient());
    render(
      <Wrapper>
        <ShareDialog file={FILE} onClose={() => undefined} />
      </Wrapper>,
    );
    expect(await screen.findByText("Erro interno do servidor.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Link 1: criado a 03/10/2026, sem validade")).toBeInTheDocument();
  });

  it("«Fechar» e Esc fecham o diálogo", async () => {
    const { onClose, user } = setup();
    await screen.findByText("Ainda não há links ativos.");
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });
});
