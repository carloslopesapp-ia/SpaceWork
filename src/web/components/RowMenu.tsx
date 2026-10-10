import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export interface MenuAction {
  label: string;
  /** Faz algo quando se escolhe a ação. */
  onSelect?: () => void;
  /** Em vez de `onSelect`: a ação é uma ligação (ex.: descarregar). */
  href?: string;
  danger?: boolean;
}

interface RowMenuProps {
  /** Nome acessível do botão, ex.: "Ações para a pasta Fotos". */
  label: string;
  actions: MenuAction[];
}

const ITEM_CLASS = "block w-full px-3 py-2 text-left text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none";

/** Botão "⋮" que abre um menu de ações (`role="menu"`): setas movem o foco, Esc fecha e devolve o foco ao botão. */
export function RowMenu({ label, actions }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) {
      // O botão fechado também abre o menu com a seta para baixo (não obriga a usar Enter ou Espaço).
      if (event.key === "ArrowDown" && event.target === buttonRef.current) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const items = [...rootRef.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
      items[event.key === "Home" ? 0 : items.length - 1].focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = [...rootRef.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
      const index = items.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length].focus();
    }
  }

  // O foco volta ao botão antes de agir: se a ação abrir um diálogo, é para aqui que o foco regressa ao fechá-lo.
  function choose(action: MenuAction) {
    setOpen(false);
    buttonRef.current?.focus();
    action.onSelect?.();
  }

  if (actions.length === 0) return null;

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
          <circle cx="10" cy="4" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="10" cy="16" r="1.6" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {actions.map((action) => {
            const className = `${ITEM_CLASS} ${action.danger ? "text-red-700" : "text-slate-700"}`;
            return action.href ? (
              <a key={action.label} role="menuitem" href={action.href} className={className} onClick={() => choose(action)}>
                {action.label}
              </a>
            ) : (
              <button key={action.label} role="menuitem" type="button" className={className} onClick={() => choose(action)}>
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
