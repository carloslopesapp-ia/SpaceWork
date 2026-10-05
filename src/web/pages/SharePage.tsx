import { Link, useParams } from "react-router";
import { formatBytes } from "../../shared/format";
import { ApiRequestError, errorMessage } from "../api";
import { AuthCard } from "../components/AuthCard";
import { Button, buttonClass } from "../components/Button";
import { Message } from "../components/Message";
import { shareDownloadUrl, usePublicShare } from "../shares";

/**
 * A página pública de um link de partilha (`/s/:token`), fora do layout autenticado: não pede a sessão e só mostra o nome e o tamanho do
 * ficheiro com o botão para o descarregar. Um link que nunca existiu, foi revogado ou expirou, ou cujo ficheiro foi excluído, dá o mesmo aviso.
 */
export default function SharePage() {
  const token = useParams().token ?? "";
  const share = usePublicShare(token);
  const gone = share.error instanceof ApiRequestError && share.error.code === "share_not_found";

  let body;
  if (share.isPending) {
    body = <p className="text-sm text-slate-500">A carregar…</p>;
  } else if (share.isError) {
    body = (
      <div className="space-y-4">
        <Message kind="error">{errorMessage(share.error)}</Message>
        {!gone && (
          <Button variant="secondary" className="w-full" onClick={() => void share.refetch()}>
            Tentar novamente
          </Button>
        )}
      </div>
    );
  } else {
    body = (
      <div className="space-y-5">
        <div>
          <p className="font-medium break-words text-slate-900">{share.data.name}</p>
          <p className="mt-1 text-sm text-slate-500">{formatBytes(share.data.size)}</p>
        </div>
        <a href={shareDownloadUrl(token)} className={buttonClass("primary", "w-full")}>
          Descarregar
        </a>
      </div>
    );
  }

  return (
    <AuthCard
      title="Ficheiro partilhado"
      footer={
        <Link to="/login" className="font-medium text-indigo-600 hover:underline">
          Entrar no SpaceWork
        </Link>
      }
    >
      {body}
    </AuthCard>
  );
}
