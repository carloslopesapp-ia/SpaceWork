import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FolderItem } from "../../shared/types";
import { apiError, json, mockApi, noContent } from "../test/mock-api";
import { queryWrapper, testQueryClient } from "../test/render";
import { FolderActions } from "./FolderActions";

const FOLDER: FolderItem = { id: "f1", name: "Fotos", parentId: null, createdAt: 0 };
const TREE = [
  FOLDER,
  { id: "f2", name: "Docs", parentId: null, createdAt: 0 },
  { id: "f3", name: "Férias", parentId: "f1", createdAt: 0 },
];

async function openMenu(item: string) {
  const user = userEvent.setup();
  const Wrapper = queryWrapper(testQueryClient());
  render(
    <Wrapper>
      <FolderActions folder={FOLDER} />
    </Wrapper>,
  );
  await user.click(screen.getByRole("button", { name: "Ações para a pasta Fotos" }));
  await user.click(screen.getByRole("menuitem", { name: item }));
  return user;
}

describe("FolderActions", () => {
  it("renomear: envia o novo nome e fecha o diálogo", async () => {
    const server = mockApi({
      "PATCH /api/folders/:id": () => json({ folder: { ...FOLDER, name: "Álbuns" } }),
    });
    const user = await openMenu("Renomear");
    expect(screen.getByLabelText("Nome da pasta")).toHaveValue("Fotos");
    await user.clear(screen.getByLabelText("Nome da pasta"));
    await user.type(screen.getByLabelText("Nome da pasta"), "Álbuns");
    await user.click(screen.getByRole("button", { name: "Renomear" }));

    await screen.findByRole("button", { name: "Ações para a pasta Fotos" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.callsTo("PATCH /api/folders/:id")[0]).toMatchObject({ params: { id: "f1" }, body: { name: "Álbuns" } });
  });

  it("renomear para um nome que já existe mostra o erro e o diálogo fica aberto", async () => {
    mockApi({
      "PATCH /api/folders/:id": () => apiError(409, "name_taken", "Já existe uma pasta com esse nome neste local."),
    });
    const user = await openMenu("Renomear");
    await user.type(screen.getByLabelText("Nome da pasta"), "x");
    await user.click(screen.getByRole("button", { name: "Renomear" }));
    expect(await screen.findByText("Já existe uma pasta com esse nome neste local.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Renomear pasta" })).toBeInTheDocument();
  });

  it("mover: o diálogo não deixa escolher a própria pasta nem as suas subpastas e envia o destino", async () => {
    const server = mockApi({
      "GET /api/folders/tree": () => json({ folders: TREE }),
      "PATCH /api/folders/:id": () => json({ folder: { ...FOLDER, parentId: "f2" } }),
    });
    const user = await openMenu("Mover…");
    await screen.findByRole("combobox", { name: "Pasta de destino" });
    expect(screen.getByRole("option", { name: /Fotos/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: /Férias/ })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox"), "f2");
    await user.click(screen.getByRole("button", { name: "Mover" }));

    await screen.findByRole("button", { name: "Ações para a pasta Fotos" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.callsTo("PATCH /api/folders/:id")[0].body).toEqual({ parentId: "f2" });
  });

  it("excluir: confirma e apaga a pasta", async () => {
    const server = mockApi({ "DELETE /api/folders/:id": () => noContent() });
    const user = await openMenu("Excluir");
    expect(screen.getByRole("dialog", { name: "Excluir pasta" })).toHaveTextContent("Só é possível se estiver vazia.");
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    await screen.findByRole("button", { name: "Ações para a pasta Fotos" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.callsTo("DELETE /api/folders/:id")[0].params.id).toBe("f1");
  });

  it("excluir uma pasta com conteúdo mostra o erro do servidor e o diálogo fica aberto", async () => {
    mockApi({
      "DELETE /api/folders/:id": () =>
        apiError(409, "folder_not_empty", "A pasta não está vazia. Mova ou exclua primeiro o conteúdo."),
    });
    const user = await openMenu("Excluir");
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A pasta não está vazia.");
    expect(screen.getByRole("dialog", { name: "Excluir pasta" })).toBeInTheDocument();
  });
});
