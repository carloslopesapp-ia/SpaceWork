import { describe, expect, it } from "vitest";
import type { FolderItem } from "../shared/types";
import { folderOptions, ROOT_LABEL, subtreeIds } from "./tree";

const folder = (id: string, name: string, parentId: string | null): FolderItem => ({ id, name, parentId, createdAt: 0 });

// Fotos > Férias > Praia; Fotos > Natal; Docs (a API manda-as por nome)
const FOLDERS = [
  folder("docs", "Docs", null),
  folder("fotos", "Fotos", null),
  folder("ferias", "Férias", "fotos"),
  folder("natal", "Natal", "fotos"),
  folder("praia", "Praia", "ferias"),
];

describe("folderOptions", () => {
  it("lista a raiz e as pastas em pré-ordem, com o recuo de cada uma", () => {
    expect(folderOptions(FOLDERS)).toEqual([
      { id: null, name: ROOT_LABEL, depth: 0 },
      { id: "docs", name: "Docs", depth: 1 },
      { id: "fotos", name: "Fotos", depth: 1 },
      { id: "ferias", name: "Férias", depth: 2 },
      { id: "praia", name: "Praia", depth: 3 },
      { id: "natal", name: "Natal", depth: 2 },
    ]);
  });

  it("só tem a raiz quando não há pastas", () => {
    expect(folderOptions([])).toEqual([{ id: null, name: ROOT_LABEL, depth: 0 }]);
  });

  it("não fica preso num ciclo", () => {
    const options = folderOptions([folder("a", "A", "b"), folder("b", "B", "a")]);
    expect(options).toEqual([{ id: null, name: ROOT_LABEL, depth: 0 }]); // nenhuma chega à raiz
  });
});

describe("subtreeIds", () => {
  it("inclui a própria pasta e todas as descendentes", () => {
    expect([...subtreeIds(FOLDERS, "fotos")].sort()).toEqual(["ferias", "fotos", "natal", "praia"]);
    expect([...subtreeIds(FOLDERS, "praia")]).toEqual(["praia"]);
  });

  it("termina mesmo com um ciclo", () => {
    const cyclic = [folder("a", "A", "b"), folder("b", "B", "a")];
    expect([...subtreeIds(cyclic, "a")].sort()).toEqual(["a", "b"]);
  });
});
