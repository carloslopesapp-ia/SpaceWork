import type { AdminUser } from "../../shared/types";
import { useDeleteUser, useUpdateUser } from "../admin";
import { errorMessage } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";
import { QuotaDialog } from "./QuotaDialog";
import { RowMenu, type MenuAction } from "./RowMenu";
import { useDialog } from "./useDialog";

type Dialog = "quota" | "suspend" | "delete";

/**
 * O menu «⋮» de uma conta e os diálogos das suas ações: alterar a quota, suspender (ou reativar) e apagar. Uma conta de administrador só
 * muda de quota (a API recusa o resto). Reativar não pede confirmação (não perde nada); se falhar, o erro aparece por baixo do menu.
 */
export function UserActions({ user }: { user: AdminUser }) {
  const update = useUpdateUser();
  const remove = useDeleteUser();
  const { dialog, open, close } = useDialog<Dialog>(update, remove);

  function openDialog(name: Dialog) {
    update.reset(); // um erro de uma tentativa antiga (por exemplo, de «Reativar») não pode aparecer num diálogo que ainda ninguém confirmou
    remove.reset();
    open(name);
  }

  const actions: MenuAction[] = [{ label: "Alterar quota…", onSelect: () => openDialog("quota") }];
  if (user.role !== "admin") {
    actions.push(
      user.status === "suspended"
        ? { label: "Reativar", onSelect: () => update.mutate({ id: user.id, status: "active" }) }
        : { label: "Suspender…", onSelect: () => openDialog("suspend") },
      { label: "Apagar conta…", danger: true, onSelect: () => openDialog("delete") },
    );
  }
  const updateError = update.error ? errorMessage(update.error) : null;

  return (
    <>
      <RowMenu label={`Ações para a conta ${user.email}`} actions={actions} />
      {dialog === null && updateError && (
        <p role="alert" className="mt-1 max-w-48 text-xs text-red-700">
          {updateError}
        </p>
      )}
      {dialog === "quota" && (
        <QuotaDialog
          user={user}
          pending={update.isPending}
          error={updateError}
          onSubmit={(quotaBytes) => update.mutate({ id: user.id, quotaBytes }, { onSuccess: close })}
          onClose={close}
        />
      )}
      {dialog === "suspend" && (
        <ConfirmDialog
          title="Suspender conta"
          message={`Suspender a conta de «${user.email}»? As sessões dela terminam e não consegue entrar até a reativar. Os ficheiros ficam como estão.`}
          confirmLabel="Suspender"
          pendingLabel="A suspender…"
          pending={update.isPending}
          error={updateError}
          onConfirm={() => update.mutate({ id: user.id, status: "suspended" }, { onSuccess: close })}
          onClose={close}
        />
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title="Apagar conta"
          message={`Apagar a conta de «${user.email}»? Os ficheiros, as pastas e os links dela são eliminados de vez, e isto não se pode desfazer. A remoção acontece na próxima manutenção (de hora a hora) e, até lá, o email não pode ser registado outra vez.`}
          confirmLabel="Apagar conta"
          pendingLabel="A apagar…"
          pending={remove.isPending}
          error={remove.error ? errorMessage(remove.error) : null}
          onConfirm={() => remove.mutate(user.id, { onSuccess: close })}
          onClose={close}
        />
      )}
    </>
  );
}
