import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router";
import { useLogin, useMe } from "../auth";
import { AuthCard } from "../components/AuthCard";
import { Button } from "../components/Button";
import { Message } from "../components/Message";
import { TextField } from "../components/TextField";

export default function LoginPage() {
  const me = useMe();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (me.data) return <Navigate to="/" replace />;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    login.mutate({ email, password });
  }

  return (
    <AuthCard
      title="Entrar"
      footer={
        <>
          Ainda não tem conta?{" "}
          <Link to="/registo" className="font-medium text-indigo-600 hover:underline">
            Registe-se
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
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {login.error && <Message kind="error">{login.error.message}</Message>}
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? "A entrar…" : "Entrar"}
        </Button>
      </form>
    </AuthCard>
  );
}
