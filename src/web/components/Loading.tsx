import type { ReactNode } from "react";

/** O aviso de «a carregar»: uma região de estado (`role="status"`), para o leitor de ecrã o anunciar. */
export function Loading({ className = "", children = "A carregar…" }: { className?: string; children?: ReactNode }) {
  return (
    <p role="status" className={`text-slate-500 ${className}`.trim()}>
      {children}
    </p>
  );
}
