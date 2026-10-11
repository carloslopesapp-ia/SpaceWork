import type { AdminUser } from "../../shared/types";
import { useDeleteUser, useUpdateUser } from "../admin";
import { errorMessage } from "../api";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { useDialog } from "./useDialog";

/**
 * As ações de uma conta que aguarda aprovação (registo por aprovação): «Aprovar» (a conta passa a entrar; não pede confirmação, porque
 * não se perde nada) e «Rejeitar…» (apaga o pedido de vez, com confirmação). Estão à vista, sem menu: é a decisão que a linha pede.
 */
export function PendingActions({ user }: { user: AdminUser }) {
  const update = useUpdateUser();
  const remove = useDeleteUser();
  const { dialog, open, close } = useDialog<"reject">(update, remove);
  const updateError = update.error ? errorMessage(update.error) : null;

  return (
    <>
      <div className="flex gap-2 whitespace-nowrap">
        <Button
          className="px-3 py-1.5"
          disabled={update.isPending}
          aria-label={`Aprovar a conta ${user.email}`}
          onClick={() => update.mutate({ id: user.id, approved: true })}
        >
          Aprovar
        </Button>
        <Button
          variant="secondary"
          className="px-3 py-1.5"
          aria-label={`Rejeitar o pedido de ${user.email}`}
          onClick={() => {
            update.reset(); // um erro de «Aprovar» não pode aparecer num diálogo que ainda ninguém confirmou
            open("reject");
          }}
        >
          Rejeitar…
        </Button>
      </div>
      {dialog === null && updateError && (
        <p role="alert" className="mt-1 max-w-56 text-xs whitespace-normal text-red-700">
          {updateError}
        </p>
      )}
      {dialog === "reject" && (
        <ConfirmDialog
          title="Rejeitar pedido"
          message={`Rejeitar o pedido de «${user.email}»? A conta é apagada já e o email fica livre. Isto não se pode desfazer.`}
          confirmLabel="Rejeitar"
          pendingLabel="A rejeitar…"
          pending={remove.isPending}
          error={remove.error ? errorMessage(remove.error) : null}
          onConfirm={() => remove.mutate(user.id, { onSuccess: close })}
          onClose={close}
        />
      )}
    </>
  );
}
