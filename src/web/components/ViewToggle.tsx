import type { ViewMode } from "../view-mode";

const OPTIONS: Array<{ value: ViewMode; label: string }> = [
  { value: "list", label: "Lista" },
  { value: "tiles", label: "Mosaico" },
];

/** O seletor «Lista | Mosaico»: dois botões premíveis (`aria-pressed`), no mesmo grupo. */
export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div role="group" aria-label="Modo de apresentação" className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
            value === option.value ? "bg-indigo-600 text-white" : "text-slate-700 hover:bg-slate-50"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
