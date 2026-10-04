import { useUploads } from "../uploads-context";
import type { UploadItem } from "../uploads";

function UploadRow({ item, onCancel }: { item: UploadItem; onCancel: () => void }) {
  const percent = item.size > 0 ? Math.min(100, Math.round((item.loaded / item.size) * 100)) : 0;
  const running = item.status === "queued" || item.status === "uploading";
  return (
    <li className="px-4 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate" title={item.name}>
          {item.name}
        </span>
        {running && (
          <button
            type="button"
            aria-label={`Cancelar o envio de ${item.name}`}
            onClick={onCancel}
            className="shrink-0 rounded px-1 text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        )}
      </div>
      {item.status === "queued" && <p className="text-xs text-slate-500">Em espera</p>}
      {item.status === "uploading" && (
        <div
          role="progressbar"
          aria-label={`Envio de ${item.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200"
        >
          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${percent}%` }} />
        </div>
      )}
      {item.status === "done" && <p className="text-xs text-emerald-700">Concluído</p>}
      {item.status === "error" && (
        <p role="alert" className="text-xs text-red-700">
          {item.message}
        </p>
      )}
    </li>
  );
}

/** Painel fixo no canto com os envios (em espera, a decorrer, concluídos ou com erro). Não aparece sem envios. */
export function UploadPanel() {
  const { items, cancel, clearFinished } = useUploads();
  if (items.length === 0) return null;
  const running = items.filter((item) => item.status === "queued" || item.status === "uploading").length;
  const title = running > 0 ? `A enviar ${running} ${running === 1 ? "ficheiro" : "ficheiros"}…` : "Envios terminados";

  return (
    <section
      aria-label="Envios"
      className="fixed right-4 bottom-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-lg"
    >
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {running < items.length && (
          <button type="button" onClick={clearFinished} className="text-xs font-medium text-indigo-600 hover:underline">
            Limpar
          </button>
        )}
      </header>
      <ul className="max-h-64 divide-y divide-slate-100 overflow-auto">
        {items.map((item) => (
          <UploadRow key={item.id} item={item} onCancel={() => cancel(item.id)} />
        ))}
      </ul>
    </section>
  );
}
