const BASE = "h-5 w-5 shrink-0";
const LARGE = "h-12 w-12 shrink-0";

/** `large`: o tamanho do mosaico (o da lista é o pequeno). */
export function FolderIcon({ large = false }: { large?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`${large ? LARGE : BASE} text-indigo-500`} fill="currentColor">
      <path d="M3 6a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.5.7L11 6h4a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
    </svg>
  );
}

export function FileIcon({ large = false }: { large?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`${large ? LARGE : BASE} text-slate-400`} fill="currentColor">
      <path d="M5 3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.4a2 2 0 0 0-.6-1.4l-3.4-3.4A2 2 0 0 0 11.6 3H5z" />
    </svg>
  );
}
