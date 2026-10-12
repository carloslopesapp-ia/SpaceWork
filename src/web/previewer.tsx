import { useEffect, useRef, useState, type ReactNode } from "react";
import { previewContentType } from "../shared/preview";
import type { FileItem } from "../shared/types";
import { PreviewDialog } from "./components/PreviewDialog";

/**
 * A pré-visualização de uma lista de ficheiros (uma pasta, os resultados de uma pesquisa). `open(file)` abre o diálogo nesse ficheiro e as
 * setas passam ao anterior e ao seguinte **dos que se pré-visualizam**, pela ordem da lista. O diálogo é da página e não de cada linha
 * ou quadrado, para conhecer a lista toda. O ficheiro aberto guarda-se pelo id: se a lista muda à volta dele o diálogo continua nele e se
 * ele sai da lista (foi excluído, ou renomeado para um tipo sem pré-visualização) o diálogo fecha-se.
 *
 * Ao fechar, o foco volta ao botão que abriu o diálogo (o menu «⋮», por exemplo); mas se se passou a outro ficheiro, vai para o botão do ficheiro
 * que está à vista (o que tem `data-preview-id`: o nome de uma linha, o rosto de um quadrado), porque o que abriu já não tem a ver com o que se vê.
 */
export function usePreviewer(files: FileItem[]): { open: (file: FileItem) => void; dialog: ReactNode } {
  const [currentId, setCurrentId] = useState<string | null>(null);
  const shown = useRef<string | null>(null);
  const opened = useRef<string | null>(null);
  const previewable = files.filter((file) => previewContentType(file.name) !== null);
  const index = currentId === null ? -1 : previewable.findIndex((file) => file.id === currentId);

  useEffect(() => {
    if (index !== -1) {
      shown.current = currentId;
      return;
    }
    const id = shown.current;
    shown.current = null;
    if (id === null || id === opened.current) return; // o Modal já devolveu o foco a quem o abriu
    [...document.querySelectorAll<HTMLElement>("[data-preview-id]")].find((element) => element.dataset.previewId === id)?.focus();
  }, [index, currentId]);

  const dialog =
    index === -1 ? null : (
      <PreviewDialog
        file={previewable[index]}
        onClose={() => setCurrentId(null)}
        navigation={
          previewable.length > 1
            ? {
                index,
                total: previewable.length,
                onPrevious: () => index > 0 && setCurrentId(previewable[index - 1].id),
                onNext: () => index < previewable.length - 1 && setCurrentId(previewable[index + 1].id),
              }
            : undefined
        }
      />
    );

  return {
    open: (file) => {
      opened.current = file.id;
      setCurrentId(file.id);
    },
    dialog,
  };
}
