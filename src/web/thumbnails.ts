import { previewContentType } from "../shared/preview";
import type { FileItem } from "../shared/types";

/**
 * Até este tamanho, a imagem de um ficheiro serve de miniatura no mosaico. A API responde com `no-store`, por isso cada miniatura é uma
 * descarga completa e nova a cada visita a uma pasta: as imagens maiores mostram o ícone.
 */
export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

/** Se o quadrado do ficheiro mostra a própria imagem: um tipo de imagem que se pré-visualiza (não um PDF nem um SVG) e dentro do limite. */
export function showsThumbnail(file: FileItem): boolean {
  return previewContentType(file.name)?.startsWith("image/") === true && file.size <= THUMBNAIL_MAX_BYTES;
}

/** A extensão do nome, em maiúsculas e até 5 caracteres («relatório.pdf» → «PDF»), para o quadrado de um ficheiro sem miniatura; vazia se não houver. */
export function extensionLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toUpperCase().slice(0, 5);
}
