// Só estes tipos abrem dentro da app. SVG e HTML ficam de fora de propósito: executariam código no nosso domínio.
// Sem imports: serve o Worker (o Content-Type da resposta) e o browser (mostrar ou não "Pré-visualizar").
const PREVIEW_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

/** Content-Type fixo para a pré-visualização, decidido pela extensão do nome; null se não for permitida. */
export function previewContentType(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null; // sem extensão, ou um ficheiro escondido como ".png"
  const extension = name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(PREVIEW_TYPES, extension) ? PREVIEW_TYPES[extension] : null;
}
