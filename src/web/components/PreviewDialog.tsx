import { useState } from "react";
import { previewContentType } from "../../shared/preview";
import type { FileItem } from "../../shared/types";
import { Button } from "./Button";
import { Message } from "./Message";
import { Modal } from "./Modal";

/**
 * Pré-visualização de uma imagem (`<img>`) ou de um PDF (`<iframe>`), servida por `/api/files/:id/preview`, que só aceita
 * estes tipos. Abre-se ao clicar. O mosaico só mostra miniaturas das imagens pequenas (`thumbnails.ts`): a API responde com
 * `no-store`, por isso cada miniatura é um pedido novo a cada visita a uma pasta.
 */
export function PreviewDialog({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  const type = previewContentType(file.name);
  const id = encodeURIComponent(file.id);

  return (
    <Modal title={file.name} onClose={onClose} wide>
      {type === null || failed ? (
        <Message kind="error">
          {type === null ? "Este tipo de ficheiro não tem pré-visualização." : "Não foi possível carregar a pré-visualização."}
        </Message>
      ) : type.startsWith("image/") ? (
        <img
          src={`/api/files/${id}/preview`}
          alt={file.name}
          onError={() => setFailed(true)}
          className="mx-auto max-h-[70vh] max-w-full object-contain"
        />
      ) : (
        <iframe
          src={`/api/files/${id}/preview`}
          title={`Pré-visualização de ${file.name}`}
          className="h-[70vh] w-full rounded-lg border border-slate-200"
        />
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
