import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useConfig, useRefreshSpace } from "./space";
import { UploadManager, type UploadItem } from "./uploads";

/** As ações da fila: o mesmo objeto durante toda a vida do provider, por isso quem só as usa não re-renderiza com o progresso. */
export interface UploadActions {
  /** Põe ficheiros na fila para a pasta indicada (`null` = raiz). */
  add: (files: File[], folderId: string | null) => void;
  cancel: (id: string) => void;
  clearFinished: () => void;
}

interface UploadsApi extends UploadActions {
  items: readonly UploadItem[];
}

/** Intervalo mínimo entre dois refrescos das listagens e da quota enquanto os envios vão terminando. */
export const REFRESH_WINDOW_MS = 500;

const ActionsContext = createContext<UploadActions | null>(null);
const ItemsContext = createContext<readonly UploadItem[] | null>(null);
const BusyContext = createContext<boolean | null>(null);

/**
 * Dá a toda a área autenticada a mesma fila de envios, por isso um envio continua quando se muda de pasta, e avisa antes de fechar
 * o separador enquanto há envios. Quando envios terminam, atualiza as listagens e a quota **uma vez por intervalo** (`refreshWindowMs`):
 * um refresh por ficheiro refazia, a cada um, todos os pedidos das listagens, da árvore, da quota, da lixeira e das pesquisas.
 *
 * O estado está em três contextos: as ações (nunca mudam), «há envios em curso?» (muda duas vezes por lote) e a lista (muda a cada progresso).
 */
export function UploadsProvider({
  children,
  refreshWindowMs = REFRESH_WINDOW_MS,
}: {
  children: ReactNode;
  refreshWindowMs?: number;
}) {
  const config = useConfig();
  const refresh = useRefreshSpace();
  // A fila é criada uma só vez: lê estes valores, sempre os mais recentes, quando precisa deles.
  const latest = useRef({ maxUploadBytes: Infinity, refresh, refreshWindowMs });
  useEffect(() => {
    latest.current = { maxUploadBytes: config.data?.maxUploadBytes ?? Infinity, refresh, refreshWindowMs };
  });
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const disposed = useRef(false);
  const [manager] = useState(
    () =>
      new UploadManager({
        maxUploadBytes: () => latest.current.maxUploadBytes,
        onSettled: () => {
          // O primeiro envio que termina arma o temporizador; os que terminam até ele disparar ficam incluídos no mesmo refresh.
          if (disposed.current || refreshTimer.current !== undefined) return;
          refreshTimer.current = setTimeout(() => {
            refreshTimer.current = undefined;
            void latest.current.refresh();
          }, latest.current.refreshWindowMs);
        },
      }),
  );
  // Se o provider desaparece (fim de sessão, erro), a fila não pode continuar a enviar ficheiros às escondidas, nem ficar um refresh agendado.
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      clearTimeout(refreshTimer.current);
      refreshTimer.current = undefined;
      manager.cancelAll();
    };
  }, [manager]);
  const items = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const busy = items.some((item) => item.status === "queued" || item.status === "uploading");

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const actions = useMemo(
    () => ({ add: manager.add, cancel: manager.cancel, clearFinished: manager.clearFinished }),
    [manager],
  );
  return (
    <ActionsContext.Provider value={actions}>
      <BusyContext.Provider value={busy}>
        <ItemsContext.Provider value={items}>{children}</ItemsContext.Provider>
      </BusyContext.Provider>
    </ActionsContext.Provider>
  );
}

function required<T>(value: T | null): T {
  if (value === null) throw new Error("Os hooks dos envios só funcionam dentro de um UploadsProvider.");
  return value;
}

/** Só as ações (adicionar, cancelar, limpar): não re-renderiza quando o progresso muda. */
export function useUploadActions(): UploadActions {
  return required(useContext(ActionsContext));
}

/** Se há envios em espera ou a decorrer: re-renderiza só quando isso muda. */
export function useUploadsBusy(): boolean {
  return required(useContext(BusyContext));
}

/** A lista de envios e as ações. Re-renderiza a cada passo do progresso: só para quem mostra a lista (o painel de envios). */
export function useUploads(): UploadsApi {
  const actions = useUploadActions();
  const items = required(useContext(ItemsContext));
  return useMemo(() => ({ items, ...actions }), [items, actions]);
}
