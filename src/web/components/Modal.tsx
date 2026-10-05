import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Largo, para a pré-visualização. */
  wide?: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * Diálogo modal acessível: `role="dialog"` com título, foco preso lá dentro (Tab e Shift+Tab dão a volta), Esc ou clique
 * no fundo fecham, e o foco volta ao elemento que o abriu. (Não usa `<dialog>.showModal()`: o jsdom não o implementa.)
 */
export function Modal({ title, onClose, children, wide = false }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [opener] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    const dialog = dialogRef.current!;
    // Um campo com `autoFocus` já tem o foco; senão, o primeiro botão ou campo (ou o próprio diálogo).
    if (!dialog.contains(document.activeElement)) {
      (dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog).focus();
    }
    return () => opener?.focus();
  }, [opener]);

  // Se o elemento focado desaparece (por exemplo, a linha de um link revogado), o foco cai para o <body>, onde o Esc e o Tab já não
  // chegam ao diálogo (tratam-se no `onKeyDown` do próprio diálogo): depois de cada renderização, devolve-se-lhe o foco se o perdeu.
  useEffect(() => {
    const dialog = dialogRef.current!;
    if (!dialog.contains(document.activeElement)) dialog.focus();
  });

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      data-testid="modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`max-h-full w-full overflow-auto rounded-2xl bg-white p-6 shadow-xl outline-none ${wide ? "max-w-4xl" : "max-w-md"}`}
      >
        <h2 id={titleId} className="mb-4 text-lg font-semibold break-words text-slate-900">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
