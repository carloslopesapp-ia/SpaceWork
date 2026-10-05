import { useEffect } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router";
import { errorMessage } from "../api";
import { useLogout, useMe } from "../auth";
import { UploadsProvider } from "../uploads-context";
import { Button } from "./Button";
import { Message } from "./Message";
import { SearchBox } from "./SearchBox";
import { UploadPanel } from "./UploadPanel";
import { UsageBar } from "./UsageBar";

function navClass({ isActive }: { isActive: boolean }): string {
  return `block rounded-lg px-3 py-2 text-sm font-medium ${
    isActive ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-100"
  }`;
}

/** Layout das páginas autenticadas: barra lateral com navegação, uso de espaço e saída. */
export default function AppLayout() {
  const me = useMe();
  const logout = useLogout();
  const { pathname } = useLocation();
  const signedIn = Boolean(me.data);

  // Um ficheiro largado fora da zona de largar fá-lo o browser abrir, e a aplicação perde-se: a janela impede-o. A zona
  // de largar da página continua a tratar do envio; isto só tira o comportamento por defeito (e só para ficheiros).
  useEffect(() => {
    if (!signedIn) return;
    const guard = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, [signedIn]);

  if (me.isPending) return <p className="p-8 text-slate-500">A carregar…</p>;
  // Só quando ainda não há dados: um refetch falhado em segundo plano não pode desmontar a aplicação (e a fila de envios).
  if (me.isError && me.data === undefined) {
    return (
      <div className="max-w-md space-y-4 p-8">
        <Message kind="error">{errorMessage(me.error)}</Message>
        <Button variant="secondary" onClick={() => void me.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }
  if (!me.data) return <Navigate to="/login" replace />;
  const user = me.data;

  return (
    <div className="min-h-screen md:flex">
      <aside className="flex shrink-0 flex-col gap-6 border-b border-slate-200 bg-white p-4 md:min-h-screen md:w-64 md:border-r md:border-b-0">
        <div className="text-xl font-bold tracking-tight text-indigo-600">SpaceWork</div>
        <SearchBox />
        <nav className="flex gap-1 md:flex-col" aria-label="Principal">
          {/* "Meu espaço" também fica ativo dentro das pastas (/pasta/...). */}
          <NavLink to="/" end className={({ isActive }) => navClass({ isActive: isActive || pathname.startsWith("/pasta/") })}>
            Meu espaço
          </NavLink>
          <NavLink to="/conta" className={navClass}>
            Conta
          </NavLink>
        </nav>
        <div className="space-y-4 md:mt-auto">
          <UsageBar usedBytes={user.usedBytes} quotaBytes={user.quotaBytes} />
          <div className="truncate text-xs text-slate-500" title={user.email}>
            {user.email}
          </div>
          {logout.isError && <Message kind="error">{errorMessage(logout.error)}</Message>}
          <Button
            variant="secondary"
            className="w-full"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            Sair
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6 md:p-8">
        {/* `key`: se o `me` passar a outro utilizador no mesmo separador, a fila do anterior cancela-se (`cancelAll`). */}
        <UploadsProvider key={user.id}>
          <Outlet />
          <UploadPanel />
        </UploadsProvider>
      </main>
    </div>
  );
}
