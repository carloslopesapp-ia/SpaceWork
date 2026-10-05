import { useQuery } from "@tanstack/react-query";
import { normalizeName, SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH, searchKey } from "../shared/names";
import type { SearchResult } from "../shared/types";
import { apiFetch } from "./api";
import { SEARCH_KEY } from "./space";

export interface SearchTerm {
  /** O que se pesquisa, sem espaços nas pontas. */
  term: string;
  /** Porque é que ainda não se pode pesquisar (em português), ou `null` se já se pode. */
  problem: string | null;
}

/** Aplica ao que o utilizador escreveu as mesmas regras da API, para não lhe pedir o que ela vai recusar. */
export function describeSearch(raw: string): SearchTerm {
  const term = normalizeName(raw);
  if (term.length > SEARCH_MAX_LENGTH) {
    return { term, problem: `A pesquisa não pode ter mais de ${SEARCH_MAX_LENGTH} caracteres.` };
  }
  if ([...searchKey(term)].length < SEARCH_MIN_LENGTH) {
    return { term, problem: `Escreva pelo menos ${SEARCH_MIN_LENGTH} caracteres.` };
  }
  return { term, problem: null };
}

/** Os resultados de uma pesquisa por nome; só pede à API quando o texto é válido (ver `describeSearch`). */
export function useSearch(raw: string) {
  const { term, problem } = describeSearch(raw);
  return useQuery({
    queryKey: [...SEARCH_KEY, term],
    queryFn: async () =>
      (await apiFetch<{ results: SearchResult[] }>(`/api/search?${new URLSearchParams({ q: term })}`)).results,
    enabled: problem === null,
  });
}
