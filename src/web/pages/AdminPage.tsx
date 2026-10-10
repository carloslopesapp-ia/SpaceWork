import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { formatDate } from "../../shared/format";
import type { AdminUser, UserStatus } from "../../shared/types";
import { errorMessage } from "../api";
import { useAdminUsers } from "../admin";
import { useMe } from "../auth";
import { Button } from "../components/Button";
import { Loading } from "../components/Loading";
import { Message } from "../components/Message";
import { UsageBar } from "../components/UsageBar";
import { UserActions } from "../components/UserActions";

const STATUS_LABEL: Record<UserStatus, string> = { active: "Ativa", suspended: "Suspensa", deleting: "A remover" };
const STATUS_STYLE: Record<UserStatus, string> = {
  active: "bg-emerald-50 text-emerald-700",
  suspended: "bg-amber-50 text-amber-800",
  deleting: "bg-slate-100 text-slate-600",
};

function UserRow({ user, isSelf, actions }: { user: AdminUser; isSelf: boolean; actions?: ReactNode }) {
  return (
    <tr className="align-middle hover:bg-slate-50">
      <td className="max-w-xs px-4 py-3">
        <span className="font-medium break-all text-slate-900">{user.email}</span>
        {user.role === "admin" && (
          <>
            {" "}
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">Admin</span>
          </>
        )}
        {isSelf && (
          <>
            {" "}
            <span className="text-xs text-slate-500">(você)</span>
          </>
        )}
      </td>
      <td className="w-56 px-4 py-3">
        <UsageBar usedBytes={user.usedBytes} quotaBytes={user.quotaBytes} label={`Espaço usado por ${user.email}`} />
      </td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[user.status]}`}>{STATUS_LABEL[user.status]}</span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDate(user.createdAt)}</td>
      <td className="w-12 px-4 py-3">{actions}</td>
    </tr>
  );
}

/** O painel do administrador: as contas, o espaço que usam e o estado de cada uma. Quem não é administrador volta a «Meu espaço». */
export default function AdminPage() {
  const me = useMe();
  const isAdmin = me.data?.role === "admin";
  const users = useAdminUsers({ enabled: isAdmin });

  if (me.data && !isAdmin) return <Navigate to="/" replace />;
  if (users.isPending) return <Loading />;
  if (users.isError && users.data === undefined) {
    return (
      <div className="max-w-md space-y-4">
        <Message kind="error">{errorMessage(users.error)}</Message>
        <Button variant="secondary" onClick={() => void users.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Utilizadores</h1>
        <Button variant="secondary" disabled={users.isFetching} onClick={() => void users.refetch()}>
          Atualizar
        </Button>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {users.data.length} {users.data.length === 1 ? "conta" : "contas"}. Uma conta apagada passa a «A remover» e a manutenção por hora elimina-a, com os ficheiros.
      </p>
      {users.isError && (
        <div className="mt-4">
          <Message kind="error">{errorMessage(users.error)}</Message>
        </div>
      )}
      {/* `relative`: o texto `sr-only` da tabela (position: absolute) fica preso a este contentor e não alarga a página. */}
      <div className="relative mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <caption className="sr-only">Contas de utilizadores</caption>
          <thead className="border-b border-slate-200 text-xs text-slate-500 uppercase">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Email
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Espaço
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Estado
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Criada a
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.data.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                isSelf={user.id === me.data?.id}
                actions={user.status === "deleting" ? undefined : <UserActions user={user} />}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
