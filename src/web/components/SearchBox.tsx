import { useState, type FormEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { SEARCH_MAX_LENGTH } from "../../shared/names";
import { describeSearch } from "../search";
import { Button } from "./Button";

export const SEARCH_PATH = "/pesquisa";

/**
 * A caixa de pesquisa da barra lateral: Enter (ou «Pesquisar») leva a `/pesquisa?q=...`. Na página da pesquisa mostra o texto
 * pesquisado; quando o texto pesquisado muda (outra pesquisa, o botão «Voltar», sair da página da pesquisa) o campo acompanha-o.
 * O campo nunca é remontado, por isso mantém o foco depois de pesquisar.
 */
export function SearchBox() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const searched = pathname === SEARCH_PATH ? (params.get("q") ?? "") : "";
  const [text, setText] = useState(searched);
  // Acompanha o texto pesquisado ajustando o estado durante a renderização. Uma `key` no formulário fazia o mesmo, mas remontava o
  // campo e tirava-lhe o foco a cada pesquisa.
  const [followed, setFollowed] = useState(searched);
  if (followed !== searched) {
    setFollowed(searched);
    setText(searched);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const { term } = describeSearch(text);
    if (term !== "") navigate(`${SEARCH_PATH}?${new URLSearchParams({ q: term })}`);
  }

  return (
    <form role="search" onSubmit={onSubmit} className="flex gap-2">
      <input
        type="search"
        aria-label="Pesquisar por nome"
        placeholder="Pesquisar…"
        maxLength={SEARCH_MAX_LENGTH}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
      />
      <Button type="submit" variant="secondary" className="px-3">
        Pesquisar
      </Button>
    </form>
  );
}
