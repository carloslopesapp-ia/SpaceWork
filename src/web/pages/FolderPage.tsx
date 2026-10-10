import { useRef, useState, type DragEvent } from "react";
import { Link, useParams } from "react-router";
import { ApiRequestError, errorMessage } from "../api";
import { Breadcrumb } from "../components/Breadcrumb";
import { Button } from "../components/Button";
import { FileRow, FolderRow } from "../components/ItemRows";
import { Loading } from "../components/Loading";
import { Message } from "../components/Message";
import { NameDialog } from "../components/NameDialog";
import { filesFromDrop } from "../dropped-files";
import { useContents, useCreateFolder } from "../space";
import { ROOT_LABEL } from "../tree";
import { useUploadActions } from "../uploads-context";

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
/** Um diálogo aberto é do que está a decorrer: enquanto houver um, o que se larga não é para a zona de largar (o fundo do diálogo cobre o ecrã todo, por isso não basta olhar ao alvo do evento). */
const dialogOpen = () => document.querySelector('[role="dialog"][aria-modal="true"]') !== null;

/** "Meu espaço": o conteúdo de uma pasta (a raiz em `/`, as outras em `/pasta/:folderId`). */
export default function FolderPage() {
  const folderId = useParams().folderId ?? null;
  const contents = useContents(folderId);
  const createFolder = useCreateFolder();
  const uploads = useUploadActions(); // só as ações: a página não re-renderiza com o progresso dos envios
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // `dragenter`/`dragleave` disparam também ao passar por cima dos filhos: conta-se a profundidade.
  const dragDepth = useRef(0);

  const gone = contents.error instanceof ApiRequestError && contents.error.code === "folder_not_found";

  if (contents.isPending) return <Loading />;
  // O ecrã de erro completo só quando não há nada para mostrar (ainda sem dados, ou a pasta já não existe): um refetch
  // falhado em segundo plano mantém a lista (e os diálogos abertos) e avisa por cima dela.
  if (contents.isError && (gone || contents.data === undefined)) {
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

  function addFiles(chosen: File[]) {
    if (chosen.length > 0) uploads.add(chosen, folderId);
  }

  function onDrop(event: DragEvent) {
    if (dialogOpen()) return; // a guarda da janela (`AppLayout`) já impede o browser de abrir o ficheiro
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const dropped = filesFromDrop(event.dataTransfer);
    setNotice(dropped.skippedFolders > 0 ? "As pastas não se enviam: arraste os ficheiros." : null);
    addFiles(dropped.files);
  }

  return (
    <div
      className={`min-h-[60vh] rounded-xl ${dragging ? "bg-indigo-50/60 outline-2 outline-dashed outline-indigo-400" : ""}`}
      onDragEnter={(event) => {
        if (dialogOpen() || !hasFiles(event)) return;
        event.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (hasFiles(event) && !dialogOpen()) event.preventDefault();
      }}
      onDragLeave={() => {
        if (dragDepth.current > 0 && --dragDepth.current === 0) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <Breadcrumb items={breadcrumb} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="min-w-0 text-2xl font-bold tracking-tight break-words">{folder?.name ?? ROOT_LABEL}</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setCreating(true)}>
            Nova pasta
          </Button>
          <Button onClick={() => fileInput.current?.click()}>Carregar ficheiros</Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            aria-label="Escolher ficheiros"
            onChange={(event) => {
              addFiles([...(event.target.files ?? [])]);
              event.target.value = ""; // para poder escolher o mesmo ficheiro outra vez
            }}
          />
        </div>
      </div>

      {contents.isError && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Message kind="error">{errorMessage(contents.error)}</Message>
          <Button variant="secondary" onClick={() => void contents.refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}

      {notice && (
        <div className="mt-4">
          <Message kind="error">{notice}</Message>
        </div>
      )}

      {folders.length + files.length === 0 ? (
        <p className="mt-10 text-center text-slate-500">
          Esta pasta está vazia. Arraste ficheiros para aqui ou use «Carregar ficheiros».
        </p>
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
