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

interface UploadsApi {
  items: readonly UploadItem[];
  /** Põe ficheiros na fila para a pasta indicada (`null` = raiz). */
  add: (files: File[], folderId: string | null) => void;
  cancel: (id: string) => void;
  clearFinished: () => void;
}

const UploadsContext = createContext<UploadsApi | null>(null);

/**
 * Dá a toda a área autenticada a mesma fila de envios, por isso um envio continua quando se muda de pasta. Atualiza
 * as listagens e a quota sempre que um envio termina, e avisa antes de fechar o separador enquanto há envios.
 */
export function UploadsProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const refresh = useRefreshSpace();
  // A fila é criada uma só vez: lê estes valores, sempre os mais recentes, quando precisa deles.
  const latest = useRef({ maxUploadBytes: Infinity, refresh });
  useEffect(() => {
    latest.current = { maxUploadBytes: config.data?.maxUploadBytes ?? Infinity, refresh };
  });
  const [manager] = useState(
    () =>
      new UploadManager({
        maxUploadBytes: () => latest.current.maxUploadBytes,
        onSettled: () => void latest.current.refresh(),
      }),
  );
  const items = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const busy = items.some((item) => item.status === "queued" || item.status === "uploading");

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const api = useMemo(
    () => ({ items, add: manager.add, cancel: manager.cancel, clearFinished: manager.clearFinished }),
    [items, manager],
  );
  return <UploadsContext.Provider value={api}>{children}</UploadsContext.Provider>;
}

export function useUploads(): UploadsApi {
  const api = useContext(UploadsContext);
  if (!api) throw new Error("useUploads só funciona dentro de um UploadsProvider.");
  return api;
}
