import { useState, type FormEvent } from "react";
import { isValidPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../shared/validation";
import { useChangePassword, useMe } from "../auth";
import { Button } from "../components/Button";
import { Message } from "../components/Message";
import { TextField } from "../components/TextField";

export default function AccountPage() {
  const me = useMe();
  const change = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    if (!isValidPassword(newPassword)) {
      setLocalError(`A senha nova deve ter entre ${PASSWORD_MIN_LENGTH} e ${PASSWORD_MAX_LENGTH} caracteres.`);
      return;
    }
    if (newPassword !== confirm) {
      setLocalError("As senhas novas não coincidem.");
      return;
    }
    setLocalError(null);
    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword("");
          setNewPassword("");
          setConfirm("");
          setDone(true);
        },
      },
    );
  }

  const error = localError ?? change.error?.message ?? null;

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-bold tracking-tight">Conta</h1>
      <p className="mt-2 text-sm text-slate-600">{me.data?.email}</p>

      <h2 className="mt-8 text-lg font-semibold">Alterar senha</h2>
      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <TextField
          label="Senha atual"
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <TextField
          label="Senha nova"
          type="password"
          name="newPassword"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <TextField
          label="Confirmar senha nova"
          type="password"
          name="confirm"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        {error && <Message kind="error">{error}</Message>}
        {done && <Message kind="success">Senha alterada com êxito. As outras sessões foram terminadas.</Message>}
        <Button type="submit" disabled={change.isPending}>
          {change.isPending ? "A guardar…" : "Alterar senha"}
        </Button>
      </form>
    </div>
  );
}
