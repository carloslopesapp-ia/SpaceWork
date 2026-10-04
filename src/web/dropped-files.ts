export interface DroppedFiles {
  files: File[];
  /** Quantas pastas vieram no que se largou (não se enviam pastas, só ficheiros). */
  skippedFolders: number;
}

/** Separa os ficheiros das pastas num arrastar-e-largar (uma pasta, como `File`, não se consegue ler). */
export function filesFromDrop(data: DataTransfer): DroppedFiles {
  const files: File[] = [];
  let skippedFolders = 0;
  for (const item of [...data.items]) {
    if (item.kind !== "file") continue;
    // `webkitGetAsEntry` existe em todos os browsers atuais (apesar do nome) e distingue uma pasta de um ficheiro.
    if (item.webkitGetAsEntry?.()?.isDirectory) {
      skippedFolders++;
      continue;
    }
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return { files, skippedFolders };
}
