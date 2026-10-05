import { Link } from "react-router";
import type { BreadcrumbItem } from "../../shared/types";
import { ROOT_LABEL } from "../tree";

/** Onde um item está (`path` é o caminho da pasta que o contém; vazio = a raiz), com uma ligação para essa pasta. */
export function Location({ path, prefix = "Em" }: { path: BreadcrumbItem[]; prefix?: string }) {
  const target = path.length === 0 ? "/" : `/pasta/${path[path.length - 1].id}`;
  const label = [ROOT_LABEL, ...path.map((item) => item.name)].join(" / ");
  return (
    <Link to={target} title={label} className="block truncate text-xs text-slate-500 hover:underline">
      {prefix} {label}
    </Link>
  );
}
