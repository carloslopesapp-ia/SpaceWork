import { useState, type FormEvent } from "react";
import { normalizeName, validateName } from "../../shared/names";
import { Button } from "./Button";
import { Message } from "./Message";
import { Modal } from "./Modal";
import { TextField } from "./TextField";

interface NameDialogProps {
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel: string;
  pending: boolean;
  /** Erro do servidor (ex.: nome repetido). */
  error: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

/** Pede um nome (nova pasta, renomear). Valida com as mesmas regras do servidor e entrega o nome já normalizado. */
export function NameDialog({
  title,
  label,
  initialValue = "",
  confirmLabel,
  pending,
  error,
  onSubmit,
  onClose,
}: NameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const name = normalizeName(value);
    const problem = validateName(name);
    setLocalError(problem);
    if (!problem) onSubmit(name);
  }

  const shownError = localError ?? error;

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <TextField
          label={label}
          name="name"
          value={value}
          autoFocus
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            setValue(event.target.value);
            setLocalError(null);
          }}
        />
        {shownError && <Message kind="error">{shownError}</Message>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "A guardar…" : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
