import { Button } from "./Button";
import { Message } from "./Message";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** Confirmação de uma ação destrutiva. O foco começa em "Cancelar". */
export function ConfirmDialog({ title, message, confirmLabel, pending, error, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-700">{message}</p>
        {error && <Message kind="error">{error}</Message>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            {pending ? "A excluir…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
