import { useState } from "react";

/**
 * O diálogo aberto de um menu de ações (no máximo um por vez) e o modo de o fechar: fecha-o e repõe as mutações do menu,
 * para um erro antigo não reaparecer quando se abre um diálogo outra vez.
 */
export function useDialog<Name extends string>(...mutations: { reset: () => void }[]) {
  const [dialog, setDialog] = useState<Name | null>(null);

  function close() {
    setDialog(null);
    for (const mutation of mutations) mutation.reset();
  }

  return { dialog, open: setDialog, close };
}
