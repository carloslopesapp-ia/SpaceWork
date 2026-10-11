import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router";
import { isValidPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../shared/validation";
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
  const pendingRef = useRef<HTMLDivElement>(null);
  const pending = register.data !== undefined && "pending" in register.data;

  // No registo por aprovação o formulário desaparece, e o foco com ele: passa para a mensagem, para o leitor de ecrã a ler.
  useEffect(() => {
    if (pending) pendingRef.current?.focus();
  }, [pending]);

  if (me.data) return <Navigate to="/" replace />;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!isValidPassword(password)) {
      setLocalError(`A senha deve ter entre ${PASSWORD_MIN_LENGTH} e ${PASSWORD_MAX_LENGTH} caracteres.`);
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

  // Registo por aprovação: a conta existe mas ainda não entra, por isso o formulário dá lugar à mensagem do servidor.
  if (register.data && "pending" in register.data) {
    return (
      <AuthCard
        title="Conta criada"
        footer={
          <>
            Já tem conta?{" "}
            <Link to="/login" className="font-medium text-indigo-600 hover:underline">
              Entrar
            </Link>
          </>
        }
      >
        <div ref={pendingRef} tabIndex={-1} className="space-y-4 outline-none">
          <Message kind="success">{register.data.message}</Message>
          <p className="text-sm text-slate-600">Quando o administrador a aprovar, entre com o seu email e a sua senha.</p>
        </div>
      </AuthCard>
    );
  }

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
