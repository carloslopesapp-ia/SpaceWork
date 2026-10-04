import { useState } from "react";
import { Link, useParams } from "react-router";
import { ApiRequestError, errorMessage } from "../api";
import { Breadcrumb } from "../components/Breadcrumb";
import { Button } from "../components/Button";
import { FileRow, FolderRow } from "../components/ItemRows";
import { Message } from "../components/Message";
import { NameDialog } from "../components/NameDialog";
import { useContents, useCreateFolder } from "../space";
import { ROOT_LABEL } from "../tree";

/** "Meu espaço": o conteúdo de uma pasta (a raiz em `/`, as outras em `/pasta/:folderId`). */
export default function FolderPage() {
  const folderId = useParams().folderId ?? null;
  const contents = useContents(folderId);
  const createFolder = useCreateFolder();
  const [creating, setCreating] = useState(false);

  if (contents.isPending) return <p className="text-slate-500">A carregar…</p>;
  if (contents.isError) {
    const gone = contents.error instanceof ApiRequestError && contents.error.code === "folder_not_found";
    return (
      <div className="max-w-md space-y-4">
        <Message kind="error">{gone ? "Esta pasta não existe ou foi eliminada." : errorMessage(contents.error)}</Message>
        {gone ? (
          <Link to="/" className="text-sm font-medium text-indigo-600 hover:underline">
            Ir para {ROOT_LABEL}
          </Link>
        ) : (
          <Button variant="secondary" onClick={() => void contents.refetch()}>
            Tentar novamente
          </Button>
        )}
      </div>
    );
  }

  const { folder, breadcrumb, folders, files } = contents.data;

  function closeCreate() {
    setCreating(false);
    createFolder.reset();
  }

  return (
    <div>
      <Breadcrumb items={breadcrumb} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight break-words">{folder?.name ?? ROOT_LABEL}</h1>
        <Button variant="secondary" onClick={() => setCreating(true)}>
          Nova pasta
        </Button>
      </div>

      {folders.length + files.length === 0 ? (
        <p className="mt-10 text-center text-slate-500">Esta pasta está vazia.</p>
      ) : (
        <ul className="mt-6 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {folders.map((item) => (
            <FolderRow key={item.id} folder={item} />
          ))}
          {files.map((item) => (
            <FileRow key={item.id} file={item} />
          ))}
        </ul>
      )}

      {creating && (
        <NameDialog
          title="Nova pasta"
          label="Nome da pasta"
          confirmLabel="Criar"
          pending={createFolder.isPending}
          error={createFolder.error ? errorMessage(createFolder.error) : null}
          onSubmit={(name) => createFolder.mutate({ name, parentId: folderId }, { onSuccess: closeCreate })}
          onClose={closeCreate}
        />
      )}
    </div>
  );
}
