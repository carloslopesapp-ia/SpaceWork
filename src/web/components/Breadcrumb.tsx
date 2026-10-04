import { Link } from "react-router";
import type { BreadcrumbItem } from "../../shared/types";
import { ROOT_LABEL } from "../tree";

const CURRENT = "font-semibold text-slate-900";

/** Caminho da raiz até à pasta atual; a pasta atual não é uma ligação. Vazio = estamos na raiz. */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Caminho">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-slate-600">
        <li>
          {items.length === 0 ? (
            <span aria-current="page" className={CURRENT}>
              {ROOT_LABEL}
            </span>
          ) : (
            <Link to="/" className="hover:underline">
              {ROOT_LABEL}
            </Link>
          )}
        </li>
        {items.map((item, index) => (
          <li key={item.id} className="flex items-center gap-1">
            <span aria-hidden="true">/</span>
            {index === items.length - 1 ? (
              <span aria-current="page" className={CURRENT}>
                {item.name}
              </span>
            ) : (
              <Link to={`/pasta/${item.id}`} className="hover:underline">
                {item.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
