import { describe, expect, it } from "vitest";
import { filesFromDrop } from "./dropped-files";

const file = (name: string) => new File(["x"], name);

/** Um item do arrastar-e-largar: ficheiro, pasta ou texto. */
const item = (kind: "file" | "string", options: { file?: File; directory?: boolean } = {}) => ({
  kind,
  getAsFile: () => options.file ?? null,
  webkitGetAsEntry: () => ({ isDirectory: options.directory === true }),
});

const drop = (items: ReturnType<typeof item>[]) => ({ items }) as unknown as DataTransfer;

describe("filesFromDrop", () => {
  it("devolve os ficheiros e conta as pastas que ficam de fora", () => {
    const a = file("a.txt");
    const b = file("b.txt");
    const result = filesFromDrop(
      drop([item("file", { file: a }), item("file", { directory: true }), item("file", { file: b })]),
    );
    expect(result).toEqual({ files: [a, b], skippedFolders: 1 });
  });

  it("ignora o que não é um ficheiro (texto arrastado)", () => {
    expect(filesFromDrop(drop([item("string")]))).toEqual({ files: [], skippedFolders: 0 });
  });

  it("serve num browser sem `webkitGetAsEntry`", () => {
    const a = file("a.txt");
    const bare = { kind: "file", getAsFile: () => a };
    expect(filesFromDrop({ items: [bare] } as unknown as DataTransfer)).toEqual({ files: [a], skippedFolders: 0 });
  });
});
