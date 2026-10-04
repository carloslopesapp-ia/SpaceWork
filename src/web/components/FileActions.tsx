import { useState } from "react";
import type { FileItem } from "../../shared/types";
import { errorMessage } from "../api";
import { useDeleteFile, useUpdateFile } from "../space";
import { ConfirmDialog } from "./ConfirmDialog";
import { MoveDialog } from "./MoveDialog";
import { NameDialog } from "./NameDialog";
import { RowMenu, type MenuAction } from "./RowMenu";

type Dialog = "rename" | "move" | "delete";

/** O menu «⋮» de um ficheiro: descarregar e os diálogos de renomear, mover e excluir. */
export function FileActions({ file, onPreview }: { file: FileItem; onPreview?: () => void }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const update = useUpdateFile();
  const remove = useDeleteFile();

  function close() {
    setDialog(null);
    update.reset();
    remove.reset();
  }

  const actions: MenuAction[] = [
    ...(onPreview ? [{ label: "Pré-visualizar", onSelect: onPreview }] : []),
    { label: "Descarregar", href: `/api/files/${encodeURIComponent(file.id)}/download` },
    { label: "Renomear", onSelect: () => setDialog("rename") },
    { label: "Mover…", onSelect: () => setDialog("move") },
    { label: "Excluir", danger: true, onSelect: () => setDialog("delete") },
  ];
  const updateError = update.error ? errorMessage(update.error) : null;

  return (
    <>
      <RowMenu label={`Ações para o ficheiro ${file.name}`} actions={actions} />
      {dialog === "rename" && (
        <NameDialog
          title="Renomear ficheiro"
          label="Nome do ficheiro"
          initialValue={file.name}
          confirmLabel="Renomear"
          pending={update.isPending}
          error={updateError}
          onSubmit={(name) => update.mutate({ id: file.id, name }, { onSuccess: close })}
          onClose={close}
        />
      )}
      {dialog === "move" && (
        <MoveDialog
          title={`Mover o ficheiro ${file.name}`}
          currentFolderId={file.folderId}
          pending={update.isPending}
          error={updateError}
          onSubmit={(folderId) => update.mutate({ id: file.id, folderId }, { onSuccess: close })}
          onClose={close}
        />
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title="Excluir ficheiro"
          message={`Excluir o ficheiro «${file.name}»? Vai para a lixeira.`}
          confirmLabel="Excluir"
          pending={remove.isPending}
          error={remove.error ? errorMessage(remove.error) : null}
          onConfirm={() => remove.mutate(file.id, { onSuccess: close })}
          onClose={close}
        />
      )}
    </>
  );
}
