import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router";
import { useMe, useRegister } from "../auth";
import { AuthCard } from "../components/AuthCard";
import { Button } from "../components/Button";
import { Message } from "../components/Message";
import { TextField } from "../components/TextField";

export default function RegisterPage() {
  const me = useMe();
  const register = useRegister();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  if (me.data) return <Navigate to="/" replace />;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8 || password.length > 128) {
      setLocalError("A senha deve ter entre 8 e 128 caracteres.");
      return;
    }
    if (password !== confirm) {
      setLocalError("As senhas não coincidem.");
      return;
    }
    setLocalError(null);
    register.mutate({ email, password });
  }

  const error = localError ?? register.error?.message ?? null;

  return (
    <AuthCard
      title="Criar conta"
      footer={
        <>
          Já tem conta?{" "}
          <Link to="/login" className="font-medium text-indigo-600 hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label="Senha"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <TextField
          label="Confirmar senha"
          type="password"
          name="confirm"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        {error && <Message kind="error">{error}</Message>}
        <Button type="submit" className="w-full" disabled={register.isPending}>
          {register.isPending ? "A criar conta…" : "Criar conta"}
        </Button>
      </form>
    </AuthCard>
  );
}
