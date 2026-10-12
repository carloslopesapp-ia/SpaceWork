import { useSearchParams } from "react-router";
import type { FileItem } from "../../shared/types";
import { errorMessage } from "../api";
import { Button } from "../components/Button";
import { FileRow, FolderRow } from "../components/ItemRows";
import { Message } from "../components/Message";
import { usePreviewer } from "../previewer";
import { describeSearch, useSearch } from "../search";

const NO_FILES: FileItem[] = [];

/** O servidor devolve no máximo 50 resultados. */
const MAX_RESULTS = 50;

/** Os resultados de uma pesquisa por nome (`/pesquisa?q=...`): pastas e ficheiros, cada um com a pasta onde está. */
export default function SearchPage() {
  const [params] = useSearchParams();
  const raw = params.get("q") ?? "";
  const { term, problem } = describeSearch(raw);
  const search = useSearch(raw);
  const results = problem === null ? search.data : undefined;
  // As setas da pré-visualização passam pelos ficheiros dos resultados (as pastas não contam), pela ordem em que aparecem.
  const preview = usePreviewer(results?.flatMap((result) => (result.kind === "file" ? [result.file] : [])) ?? NO_FILES);

  // Uma só linha de estado, sempre montada e com `role="status"`: o foco fica na caixa de pesquisa e os leitores de ecrã só anunciam
  // o que muda dentro de uma região viva (uma linha nova a cada estado não seria anunciada).
  let status = "";
  if (term === "") status = "Escreva o que procura na caixa de pesquisa.";
  else if (problem !== null) status = problem;
  else if (results !== undefined) {
    if (results.length === 0) status = `Nenhum resultado para «${term}».`;
    else if (results.length >= MAX_RESULTS) status = `Mostram-se os primeiros ${MAX_RESULTS} resultados. Escreva mais para os afinar.`;
    else status = `${results.length} ${results.length === 1 ? "resultado" : "resultados"}`;
  } else if (search.isPending) status = "A pesquisar…";

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight break-words">
        {problem === null ? `Resultados para «${term}»` : "Pesquisa"}
      </h1>
      <p role="status" className="mt-4 text-sm text-slate-600">
        {status}
      </p>
      {problem === null && search.isError && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Message kind="error">{errorMessage(search.error)}</Message>
          <Button variant="secondary" onClick={() => void search.refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {results !== undefined && results.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {results.map((result) =>
            result.kind === "folder" ? (
              <FolderRow key={`folder-${result.folder.id}`} folder={result.folder} path={result.path} />
            ) : (
              <FileRow key={`file-${result.file.id}`} file={result.file} path={result.path} onPreview={preview.open} />
            ),
          )}
        </ul>
      )}
      {preview.dialog}
    </div>
  );
}
