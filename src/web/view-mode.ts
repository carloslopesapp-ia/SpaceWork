import { useState } from "react";

export type ViewMode = "list" | "tiles";

export const VIEW_MODE_KEY = "spacework:view-mode";

/** A vista guardada neste browser (a lista, por defeito). O armazenamento pode falhar (modo privado, dados bloqueados): então, a lista. */
export function readViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === "tiles" ? "tiles" : "list";
  } catch {
    return "list";
  }
}

/** A vista de «Meu espaço» (lista ou mosaico). A escolha fica guardada neste browser e vale para a página mesmo que não se consiga guardar. */
export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(readViewMode);

  function choose(next: ViewMode) {
    setMode(next);
    try {
      localStorage.setItem(VIEW_MODE_KEY, next);
    } catch {
      // sem armazenamento: a escolha vale só para esta página
    }
  }

  return [mode, choose];
}
