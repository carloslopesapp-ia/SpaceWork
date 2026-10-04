import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FolderItem } from "../../shared/types";
import { apiError, json, mockApi } from "../test/mock-api";
import { queryWrapper, testQueryClient } from "../test/render";
import { MoveDialog } from "./MoveDialog";

const folder = (id: string, name: string, parentId: string | null): FolderItem => ({ id, name, parentId, createdAt: 0 });

// Docs; Fotos > Férias > Praia
const TREE = [folder("docs", "Docs", null), folder("fotos", "Fotos", null), folder("ferias", "Férias", "fotos"), folder("praia", "Praia", "ferias")];

function setup(props: Partial<Parameters<typeof MoveDialog>[0]> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const Wrapper = queryWrapper(testQueryClient());
  render(
    <Wrapper>
      <MoveDialog
        title="Mover"
        currentFolderId={null}
        pending={false}
        error={null}
        onSubmit={onSubmit}
        onClose={onClose}
        {...props}
      />
    </Wrapper>,
  );
  return { onSubmit, onClose, user: userEvent.setup() };
}

const optionTexts = () => screen.getAllByRole("option").map((option) => (option.textContent ?? "").replace(/ /g, "·"));

describe("MoveDialog", () => {
  it("lista a raiz e as pastas recuadas, com a pasta atual desativada", async () => {
    mockApi({ "GET /api/folders/tree": () => json({ folders: TREE }) });
    setup({ currentFolderId: "docs" });
    await screen.findByRole("combobox", { name: "Pasta de destino" });
    expect(optionTexts()).toEqual([
      "Escolha a pasta de destino…",
      "Meu espaço",
      "··Docs (pasta atual)",
      "··Fotos",
      "····Férias",
      "······Praia",
    ]);
    expect(screen.getByRole("option", { name: /Docs/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: /Fotos/ })).toBeEnabled();
  });

  it("ao mover uma pasta, ela própria e as suas descendentes ficam desativadas (e a raiz, onde ela já está)", async () => {
    mockApi({ "GET /api/folders/tree": () => json({ folders: TREE }) });
    setup({ currentFolderId: null, movingFolderId: "fotos" });
    await screen.findByRole("combobox", { name: "Pasta de destino" });
    const disabled = screen.getAllByRole("option").filter((option) => (option as HTMLOptionElement).disabled);
    expect(disabled.map((option) => option.textContent?.trim())).toEqual([
      "Escolha a pasta de destino…",
      "Meu espaço (pasta atual)",
      "Fotos",
      "Férias",
      "Praia",
    ]);
    expect(screen.getByRole("option", { name: "Docs" })).toBeEnabled();
  });

  it("só deixa mover depois de escolher, e entrega o id (ou null para a raiz)", async () => {
    mockApi({ "GET /api/folders/tree": () => json({ folders: TREE }) });
    const { onSubmit, user } = setup({ currentFolderId: "docs" });
    await screen.findByRole("combobox", { name: "Pasta de destino" });
    expect(screen.getByRole("button", { name: "Mover" })).toBeDisabled();

    await user.selectOptions(screen.getByRole("combobox"), "ferias");
    await user.click(screen.getByRole("button", { name: "Mover" }));
    expect(onSubmit).toHaveBeenLastCalledWith("ferias");

    await user.selectOptions(screen.getByRole("combobox"), "root");
    await user.click(screen.getByRole("button", { name: "Mover" }));
    expect(onSubmit).toHaveBeenLastCalledWith(null);
  });

  it("mostra o erro do servidor", async () => {
    mockApi({ "GET /api/folders/tree": () => json({ folders: TREE }) });
    setup({ error: "Já existe uma pasta com esse nome neste local." });
    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe uma pasta com esse nome neste local.");
  });

  it("se a lista de pastas falhar, mostra o erro e deixa tentar de novo", async () => {
    let calls = 0;
    mockApi({
      "GET /api/folders/tree": () => (++calls === 1 ? apiError(500, "internal_error", "Erro interno do servidor.") : json({ folders: TREE })),
    });
    const { user } = setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("Erro interno do servidor.");
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByRole("combobox", { name: "Pasta de destino" })).toBeInTheDocument();
  });
});
