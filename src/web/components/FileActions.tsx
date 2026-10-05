import type { FileItem } from "../../shared/types";
import { errorMessage } from "../api";
import { useDeleteFile, useUpdateFile } from "../space";
import { ConfirmDialog } from "./ConfirmDialog";
import { MoveDialog } from "./MoveDialog";
import { NameDialog } from "./NameDialog";
import { RowMenu, type MenuAction } from "./RowMenu";
import { ShareDialog } from "./ShareDialog";
import { useDialog } from "./useDialog";

type Dialog = "rename" | "move" | "delete" | "share";

/** O menu «⋮» de um ficheiro: descarregar e os diálogos de partilhar, renomear, mover e excluir. */
export function FileActions({ file, onPreview }: { file: FileItem; onPreview?: () => void }) {
  const update = useUpdateFile();
  const remove = useDeleteFile();
  const { dialog, open, close } = useDialog<Dialog>(update, remove);

  const actions: MenuAction[] = [
    ...(onPreview ? [{ label: "Pré-visualizar", onSelect: onPreview }] : []),
    { label: "Descarregar", href: `/api/files/${encodeURIComponent(file.id)}/download` },
    { label: "Partilhar…", onSelect: () => open("share") },
    { label: "Renomear", onSelect: () => open("rename") },
    { label: "Mover…", onSelect: () => open("move") },
    { label: "Excluir", danger: true, onSelect: () => open("delete") },
  ];
  const updateError = update.error ? errorMessage(update.error) : null;

  return (
    <>
      <RowMenu label={`Ações para o ficheiro ${file.name}`} actions={actions} />
      {dialog === "share" && <ShareDialog file={file} onClose={close} />}
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
