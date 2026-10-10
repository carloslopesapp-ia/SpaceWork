import { useState } from "react";
import { formatBytes, formatDate } from "../../shared/format";
import type { TrashItem } from "../../shared/types";
import { ApiRequestError, errorMessage } from "../api";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FileIcon } from "../components/icons";
import { Loading } from "../components/Loading";
import { Location } from "../components/Location";
import { Message } from "../components/Message";
import { useEmptyTrash, usePurgeFile, useRestoreFile, useTrash } from "../trash";

const NAME_TAKEN_MESSAGE =
  "Não foi possível restaurar: já existem demasiados ficheiros com este nome na pasta. Renomeie ou elimine alguns e tente de novo.";

function restoreErrorMessage(error: unknown): string {
  // A mensagem da API fala de «um envio em curso», o que aqui não faz sentido: o ficheiro já existia.
  return error instanceof ApiRequestError && error.code === "name_taken" ? NAME_TAKEN_MESSAGE : errorMessage(error);
}

function TrashRow({
  item,
  restoring,
  disabled,
  onRestore,
  onPurge,
}: {
  item: TrashItem;
  restoring: boolean;
  disabled: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2 hover:bg-slate-50">
      <FileIcon />
      <span className="min-w-0 flex-1 basis-48">
        <span title={item.name} className="block truncate">
          {item.name}
        </span>
        <Location path={item.path} prefix="Estava em" />
        <span className="block text-xs text-slate-500">
          Excluído a {formatDate(item.deletedAt)} · eliminado de vez a {formatDate(item.purgeAt)}
        </span>
      </span>
      <span className="hidden w-24 shrink-0 text-right text-sm text-slate-500 sm:block">{formatBytes(item.size)}</span>
      <span className="flex shrink-0 gap-2">
        <Button variant="secondary" className="px-3 py-1.5" disabled={disabled} aria-label={`Restaurar ${item.name}`} onClick={onRestore}>
          {restoring ? "A restaurar…" : "Restaurar"}
        </Button>
        <Button variant="secondary" className="px-3 py-1.5" disabled={disabled} aria-label={`Eliminar de vez ${item.name}`} onClick={onPurge}>
          Eliminar de vez
        </Button>
      </span>
    </li>
  );
}

/** A lixeira: os ficheiros excluídos, que se podem restaurar ou eliminar de vez (um a um ou todos). */
export default function TrashPage() {
  const trash = useTrash();
  const restore = useRestoreFile();
  const purge = usePurgeFile();
  const empty = useEmptyTrash();
  const [purging, setPurging] = useState<TrashItem | null>(null);
  const [emptying, setEmptying] = useState(false);
  const [restored, setRestored] = useState<string | null>(null);

  if (trash.isPending) return <Loading />;
  if (trash.isError && trash.data === undefined) {
    return (
      <div className="max-w-md space-y-4">
        <Message kind="error">{errorMessage(trash.error)}</Message>
        <Button variant="secondary" onClick={() => void trash.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const { items, total, retentionDays } = trash.data;
  const busy = restore.isPending || purge.isPending || empty.isPending;

  function startRestore(item: TrashItem) {
    setRestored(null);
    restore.mutate(item.id, {
      onSuccess: ({ file }) =>
        setRestored(
          file.name === item.name
            ? `«${file.name}» foi restaurado.`
            : `«${file.name}» foi restaurado (já existia um ficheiro chamado «${item.name}» no mesmo local).`,
        ),
    });
  }

  function closePurge() {
    setPurging(null);
    purge.reset();
  }

  function closeEmpty() {
    setEmptying(false);
    empty.reset();
  }

  const emptyStuck = empty.data !== undefined && empty.data.remaining > 0;
  let emptyError: string | null = null;
  if (empty.error) emptyError = errorMessage(empty.error);
  else if (emptyStuck) emptyError = `Não foi possível eliminar todos os ficheiros: ficaram ${empty.data!.remaining}. Tente de novo.`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Lixeira</h1>
        <Button variant="danger" disabled={total === 0 || busy} onClick={() => setEmptying(true)}>
          Esvaziar lixeira
        </Button>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Os ficheiros excluídos ficam aqui {retentionDays} dias e depois são eliminados de vez. Até lá continuam a ocupar espaço.
      </p>

      {trash.isError && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Message kind="error">{errorMessage(trash.error)}</Message>
          <Button variant="secondary" onClick={() => void trash.refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {restored && (
        <div className="mt-4">
          <Message kind="success">{restored}</Message>
        </div>
      )}
      {restore.error && (
        <div className="mt-4">
          <Message kind="error">{restoreErrorMessage(restore.error)}</Message>
        </div>
      )}

      {items.length === 0 ? (
        <p className="mt-10 text-center text-slate-500">A lixeira está vazia.</p>
      ) : (
        <>
          {total > items.length && (
            <p className="mt-4 text-sm text-slate-600">
              Mostram-se os {items.length} mais recentes de {total}. Os restantes aparecem à medida que eliminar ou restaurar estes.
            </p>
          )}
          <ul className="mt-6 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {items.map((item) => (
              <TrashRow
                key={item.id}
                item={item}
                restoring={restore.isPending && restore.variables === item.id}
                disabled={busy}
                onRestore={() => startRestore(item)}
                onPurge={() => setPurging(item)}
              />
            ))}
          </ul>
        </>
      )}

      {purging && (
        <ConfirmDialog
          title="Eliminar de vez"
          message={`Eliminar «${purging.name}» de vez? Não se pode desfazer e o espaço é libertado.`}
          confirmLabel="Eliminar de vez"
          pendingLabel="A eliminar…"
          pending={purge.isPending}
          error={purge.error ? errorMessage(purge.error) : null}
          onConfirm={() => purge.mutate(purging.id, { onSuccess: closePurge })}
          onClose={closePurge}
        />
      )}
      {emptying && (
        <ConfirmDialog
          title="Esvaziar a lixeira"
          message={
            empty.isPending
              ? `A eliminar… ${empty.purged} de ${total}`
              : `Eliminar de vez ${total === 1 ? "o ficheiro" : `os ${total} ficheiros`} da lixeira? Não se pode desfazer e o espaço é libertado.`
          }
          confirmLabel="Esvaziar lixeira"
          pendingLabel="A eliminar…"
          pending={empty.isPending}
          error={emptyError}
          onConfirm={() => empty.mutate(undefined, { onSuccess: (result) => result.remaining === 0 && closeEmpty() })}
          onClose={closeEmpty}
        />
      )}
    </div>
  );
}
