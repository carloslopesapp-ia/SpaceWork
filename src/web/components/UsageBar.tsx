import { formatBytes } from "../../shared/format";

interface UsageBarProps {
  usedBytes: number;
  quotaBytes: number;
}

export function UsageBar({ usedBytes, quotaBytes }: UsageBarProps) {
  const percent = quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 100;
  return (
    <div>
      <div
        className="h-2 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-label="Espaço utilizado"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div
          className={`h-full rounded-full ${percent >= 90 ? "bg-red-500" : "bg-indigo-500"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-slate-600">
        {formatBytes(usedBytes)} de {formatBytes(quotaBytes)}
      </p>
    </div>
  );
}
