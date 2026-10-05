import { useState, type FormEvent } from "react";
import { formatBytes } from "../../shared/format";
import type { AdminUser } from "../../shared/types";
import { parseQuotaGb, QUOTA_HINT, quotaToGbText } from "../admin";
import { Button } from "./Button";
import { Message } from "./Message";
import { Modal } from "./Modal";
import { TextField } from "./TextField";

interface QuotaDialogProps {
  user: AdminUser;
  pending: boolean;
  /** Erro do servidor. */
  error: string | null;
  /** Recebe a quota nova, em bytes. */
  onSubmit: (quotaBytes: number) => void;
  onClose: () => void;
}

/** Muda a quota de uma conta, em GB. Uma quota abaixo do uso atual é permitida: só impede novos envios. */
export function QuotaDialog({ user, pending, error, onSubmit, onClose }: QuotaDialogProps) {
  // O campo arredonda a quota a duas casas: guardar sem o editar não pode regravar a quota com o valor arredondado.
  const [initialText] = useState(() => quotaToGbText(user.quotaBytes));
  const [text, setText] = useState(initialText);
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (text.trim() === initialText) {
      onClose();
      return;
    }
    const bytes = parseQuotaGb(text);
    setLocalError(bytes === null ? QUOTA_HINT : null);
    if (bytes !== null) onSubmit(bytes);
  }

  const shownError = localError ?? error;

  return (
    // Enquanto o pedido decorre o diálogo não se fecha (Esc e fundo ignorados), como o `ConfirmDialog`.
    <Modal title={`Quota de ${user.email}`} onClose={() => !pending && onClose()}>
      <form onSubmit={submit} className="space-y-4">
        <TextField
          label="Quota (GB)"
          name="quota"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          value={text}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setText(event.target.value)}
        />
        <p className="text-sm text-slate-600">
          Espaço usado: {formatBytes(user.usedBytes)}. Uma quota abaixo disto só impede novos envios: o que já lá está fica.
        </p>
        {shownError && <Message kind="error">{shownError}</Message>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "A guardar…" : "Guardar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
