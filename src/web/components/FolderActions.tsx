import { useState } from "react";
import type { FolderItem } from "../../shared/types";
import { errorMessage } from "../api";
import { useDeleteFolder, useUpdateFolder } from "../space";
import { ConfirmDialog } from "./ConfirmDialog";
import { MoveDialog } from "./MoveDialog";
import { NameDialog } from "./NameDialog";
import { RowMenu, type MenuAction } from "./RowMenu";

type Dialog = "rename" | "move" | "delete";

/** O menu «⋮» de uma pasta e os diálogos das suas ações (renomear, mover e excluir). */
export function FolderActions({ folder }: { folder: FolderItem }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const update = useUpdateFolder();
  const remove = useDeleteFolder();

  function close() {
    setDialog(null);
    update.reset();
    remove.reset();
  }

  const actions: MenuAction[] = [
    { label: "Renomear", onSelect: () => setDialog("rename") },
    { label: "Mover…", onSelect: () => setDialog("move") },
    { label: "Excluir", danger: true, onSelect: () => setDialog("delete") },
  ];
  const updateError = update.error ? errorMessage(update.error) : null;

  return (
    <>
      <RowMenu label={`Ações para a pasta ${folder.name}`} actions={actions} />
      {dialog === "rename" && (
        <NameDialog
          title="Renomear pasta"
          label="Nome da pasta"
          initialValue={folder.name}
          confirmLabel="Renomear"
          pending={update.isPending}
          error={updateError}
          onSubmit={(name) => update.mutate({ id: folder.id, name }, { onSuccess: close })}
          onClose={close}
        />
      )}
      {dialog === "move" && (
        <MoveDialog
          title={`Mover a pasta ${folder.name}`}
          currentFolderId={folder.parentId}
          movingFolderId={folder.id}
          pending={update.isPending}
          error={updateError}
          onSubmit={(parentId) => update.mutate({ id: folder.id, parentId }, { onSuccess: close })}
          onClose={close}
        />
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title="Excluir pasta"
          message={`Excluir a pasta «${folder.name}»? Só é possível se estiver vazia.`}
          confirmLabel="Excluir"
          pending={remove.isPending}
          error={remove.error ? errorMessage(remove.error) : null}
          onConfirm={() => remove.mutate(folder.id, { onSuccess: close })}
          onClose={close}
        />
      )}
    </>
  );
}
