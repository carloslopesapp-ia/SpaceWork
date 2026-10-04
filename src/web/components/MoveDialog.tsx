import { useMemo, useState, type FormEvent } from "react";
import { errorMessage } from "../api";
import { useTree } from "../space";
import { folderOptions, subtreeIds } from "../tree";
import { Button } from "./Button";
import { Message } from "./Message";
import { Modal } from "./Modal";

interface MoveDialogProps {
  title: string;
  /** Onde o item está agora (`null` = raiz): não é um destino válido. */
  currentFolderId: string | null;
  /** Ao mover uma pasta: ela própria e as suas descendentes também não podem ser o destino. */
  movingFolderId?: string;
  pending: boolean;
  /** Erro do servidor. */
  error: string | null;
  /** Recebe o destino; `null` = raiz. */
  onSubmit: (folderId: string | null) => void;
  onClose: () => void;
}

const ROOT_VALUE = "root";

/** Escolha da pasta de destino num `<select>` com as pastas recuadas pelo nível; os destinos inválidos ficam desativados. */
export function MoveDialog({ title, currentFolderId, movingFolderId, pending, error, onSubmit, onClose }: MoveDialogProps) {
  const tree = useTree();
  const [target, setTarget] = useState("");
  const options = useMemo(() => folderOptions(tree.data ?? []), [tree.data]);
  const blocked = useMemo(
    () => (movingFolderId && tree.data ? subtreeIds(tree.data, movingFolderId) : new Set<string>()),
    [movingFolderId, tree.data],
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (target !== "") onSubmit(target === ROOT_VALUE ? null : target);
  }

  return (
    <Modal title={title} onClose={onClose}>
      {tree.isPending ? (
        <p className="text-sm text-slate-500">A carregar pastas…</p>
      ) : tree.isError ? (
        <div className="space-y-3">
          <Message kind="error">{errorMessage(tree.error)}</Message>
          <Button variant="secondary" onClick={() => void tree.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Pasta de destino</span>
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            >
              <option value="" disabled>
                Escolha a pasta de destino…
              </option>
              {options.map((option) => {
                const here = option.id === currentFolderId;
                const disabled = here || (option.id !== null && blocked.has(option.id));
                return (
                  <option key={option.id ?? ROOT_VALUE} value={option.id ?? ROOT_VALUE} disabled={disabled}>
                    {"  ".repeat(option.depth)}
                    {option.name}
                    {here ? " (pasta atual)" : ""}
                  </option>
                );
              })}
            </select>
          </label>
          {error && <Message kind="error">{error}</Message>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || target === ""}>
              {pending ? "A mover…" : "Mover"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
