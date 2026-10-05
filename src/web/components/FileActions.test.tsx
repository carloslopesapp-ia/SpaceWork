import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FileItem } from "../../shared/types";
import { apiError, json, mockApi, noContent } from "../test/mock-api";
import { queryWrapper, testQueryClient } from "../test/render";
import { FileActions } from "./FileActions";

const FILE: FileItem = { id: "a1", name: "relatório.pdf", folderId: "f1", size: 10, mime: "application/pdf", createdAt: 0 };
const TREE = [
  { id: "f1", name: "Fotos", parentId: null, createdAt: 0 },
  { id: "f2", name: "Docs", parentId: null, createdAt: 0 },
];
const MENU = "Ações para o ficheiro relatório.pdf";

function setup() {
  const user = userEvent.setup();
  const Wrapper = queryWrapper(testQueryClient());
  render(
    <Wrapper>
      <FileActions file={FILE} />
    </Wrapper>,
  );
  return user;
}

async function choose(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(screen.getByRole("button", { name: MENU }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

describe("FileActions", () => {
  it("o menu tem Descarregar (uma ligação para o servidor), Renomear, Mover e Excluir", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: MENU }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Descarregar",
      "Partilhar…",
      "Renomear",
      "Mover…",
      "Excluir",
    ]);
    expect(screen.getByRole("menuitem", { name: "Descarregar" })).toHaveAttribute("href", "/api/files/a1/download");
  });

  it("renomear: envia o novo nome", async () => {
    const server = mockApi({ "PATCH /api/files/:id": () => json({ file: { ...FILE, name: "final.pdf" } }) });
    const user = setup();
    await choose(user, "Renomear");
    await user.clear(screen.getByLabelText("Nome do ficheiro"));
    await user.type(screen.getByLabelText("Nome do ficheiro"), "final.pdf");
    await user.click(screen.getByRole("button", { name: "Renomear" }));
    await screen.findByRole("button", { name: MENU });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.callsTo("PATCH /api/files/:id")[0]).toMatchObject({ params: { id: "a1" }, body: { name: "final.pdf" } });
  });

  it("mover: a pasta atual está desativada e o destino vai como `folderId`", async () => {
    const server = mockApi({
      "GET /api/folders/tree": () => json({ folders: TREE }),
      "PATCH /api/files/:id": () => json({ file: { ...FILE, folderId: null } }),
    });
    const user = setup();
    await choose(user, "Mover…");
    await screen.findByRole("combobox", { name: "Pasta de destino" });
    expect(screen.getByRole("option", { name: /Fotos/ })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox"), "root");
    await user.click(screen.getByRole("button", { name: "Mover" }));
    await screen.findByRole("button", { name: MENU });
    expect(server.callsTo("PATCH /api/files/:id")[0].body).toEqual({ folderId: null });
  });

  it("mover para uma pasta onde já há um ficheiro com esse nome mostra o erro", async () => {
    mockApi({
      "GET /api/folders/tree": () => json({ folders: TREE }),
      "PATCH /api/files/:id": () => apiError(409, "name_taken", "Já existe um ficheiro com esse nome neste local (pode ser um envio ainda em curso)."),
    });
    const user = setup();
    await choose(user, "Mover…");
    await user.selectOptions(await screen.findByRole("combobox"), "f2");
    await user.click(screen.getByRole("button", { name: "Mover" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("pode ser um envio ainda em curso");
  });

  it("partilhar: abre o diálogo da partilha deste ficheiro e fecha-o com «Fechar»", async () => {
    const server = mockApi({ "GET /api/files/:id/shares": () => json({ shares: [] }) });
    const user = setup();
    await choose(user, "Partilhar…");
    expect(screen.getByRole("dialog", { name: "Partilhar «relatório.pdf»" })).toBeInTheDocument();
    expect(await screen.findByText("Ainda não há links ativos.")).toBeInTheDocument();
    expect(server.callsTo("GET /api/files/:id/shares")[0].params.id).toBe("a1");
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: MENU })).toHaveFocus();
  });

  it("excluir: pede confirmação, avisa que vai para a lixeira e apaga", async () => {
    const server = mockApi({ "DELETE /api/files/:id": () => noContent() });
    const user = setup();
    await choose(user, "Excluir");
    expect(screen.getByRole("dialog", { name: "Excluir ficheiro" })).toHaveTextContent("Vai para a lixeira.");
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    await screen.findByRole("button", { name: MENU });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.callsTo("DELETE /api/files/:id")[0].params.id).toBe("a1");
  });
});

describe("FileActions: pré-visualizar", () => {
  it("«Pré-visualizar» só aparece quando a linha o pede, e é a primeira ação", async () => {
    const onPreview = vi.fn();
    const Wrapper = queryWrapper(testQueryClient());
    render(
      <Wrapper>
        <FileActions file={FILE} onPreview={onPreview} />
      </Wrapper>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: MENU }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Pré-visualizar",
      "Descarregar",
      "Partilhar…",
      "Renomear",
      "Mover…",
      "Excluir",
    ]);
    await user.click(screen.getByRole("menuitem", { name: "Pré-visualizar" }));
    expect(onPreview).toHaveBeenCalledTimes(1);
  });
});
