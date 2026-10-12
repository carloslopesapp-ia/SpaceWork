import { useEffect, useState } from "react";
import { previewContentType } from "../../shared/preview";
import type { FileItem } from "../../shared/types";
import { Button } from "./Button";
import { Message } from "./Message";
import { Modal } from "./Modal";

/** Onde o ficheiro está na lista dos que se pré-visualizam, e como passar ao anterior e ao seguinte. */
export interface PreviewNavigation {
  /** A posição do ficheiro aberto (a contar de 0) e quantos há. */
  index: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}

/** O que mostra o diálogo: a imagem ou o PDF. Tem a sua `key` (o id do ficheiro), para um aviso de falha não passar ao ficheiro seguinte. */
function PreviewBody({ file }: { file: FileItem }) {
  const [failed, setFailed] = useState(false);
  const type = previewContentType(file.name);
  const id = encodeURIComponent(file.id);

  if (type === null || failed) {
    return (
      <Message kind="error">
        {type === null ? "Este tipo de ficheiro não tem pré-visualização." : "Não foi possível carregar a pré-visualização."}
      </Message>
    );
  }
  if (type.startsWith("image/")) {
    return (
      <img
        src={`/api/files/${id}/preview`}
        alt={file.name}
        onError={() => setFailed(true)}
        className="mx-auto max-h-[70vh] max-w-full object-contain"
      />
    );
  }
  return (
    <iframe
      src={`/api/files/${id}/preview`}
      title={`Pré-visualização de ${file.name}`}
      className="h-[70vh] w-full rounded-lg border border-slate-200"
    />
  );
}

function Arrow({ direction, disabled, onClick }: { direction: "previous" | "next"; disabled: boolean; onClick: () => void }) {
  const previous = direction === "previous";
  // `aria-disabled` e não `disabled`: no primeiro e no último ficheiro a seta continua focável, e o foco não se perde (o Esc continua a fechar o diálogo).
  return (
    <button
      type="button"
      aria-label={previous ? "Ficheiro anterior" : "Ficheiro seguinte"}
      aria-disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={`absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border bg-white/90 shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
        previous ? "left-1" : "right-1"
      } ${disabled ? "cursor-not-allowed border-slate-200 text-slate-300" : "border-slate-300 text-slate-700 hover:bg-white"}`}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={previous ? "M12 4l-6 6 6 6" : "M8 4l6 6-6 6"} />
      </svg>
    </button>
  );
}

/**
 * Pré-visualização de uma imagem (`<img>`) ou de um PDF (`<iframe>`), servida por `/api/files/:id/preview`, que só aceita
 * estes tipos. Abre-se ao clicar. O mosaico só mostra miniaturas das imagens pequenas (`thumbnails.ts`): a API responde com
 * `no-store`, por isso cada miniatura é um pedido novo a cada visita a uma pasta.
 *
 * Com `navigation`, tem setas para o ficheiro anterior e o seguinte (e as teclas ← e →) e diz onde está («2 de 5»). As teclas ouvem-se no
 * documento e por isso calam-se quando o foco está dentro do leitor de PDF, que usa as setas para mudar de página.
 *
 * O foco não se move ao mudar de ficheiro, por isso o contador é o único aviso a quem usa um leitor de ecrã: `aria-atomic` para ler «2 de 5»
 * inteiro (e não só o algarismo que mudou) e o nome do ficheiro, escondido da vista, para dizer qual é. A seta desativada esbate-se sem
 * `opacity` (que apagava também o anel de foco, e o foco fica ali quando se chega ao fim).
 */
export function PreviewDialog({ file, onClose, navigation }: { file: FileItem; onClose: () => void; navigation?: PreviewNavigation }) {
  const id = encodeURIComponent(file.id);
  const atStart = navigation !== undefined && navigation.index === 0;
  const atEnd = navigation !== undefined && navigation.index === navigation.total - 1;

  useEffect(() => {
    if (!navigation) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "ArrowLeft" && !atStart) navigation.onPrevious();
      else if (event.key === "ArrowRight" && !atEnd) navigation.onNext();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navigation, atStart, atEnd]);

  return (
    <Modal title={file.name} onClose={onClose} wide>
      <div className="relative">
        {navigation && (
          <>
            <Arrow direction="previous" disabled={atStart} onClick={navigation.onPrevious} />
            <Arrow direction="next" disabled={atEnd} onClick={navigation.onNext} />
          </>
        )}
        <div className={navigation ? "sm:px-12" : ""}>
          <PreviewBody key={file.id} file={file} />
        </div>
      </div>
      {navigation && (
        <p aria-live="polite" aria-atomic="true" className="mt-3 text-center text-sm text-slate-500">
          {`${navigation.index + 1} de ${navigation.total}`}
          <span className="sr-only">: {file.name}</span>
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <a
          href={`/api/files/${id}/download`}
          className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Descarregar
        </a>
        <Button onClick={onClose}>Fechar</Button>
      </div>
    </Modal>
  );
}
