import { useSearchParams } from "react-router";
import { errorMessage } from "../api";
import { Button } from "../components/Button";
import { FileRow, FolderRow } from "../components/ItemRows";
import { Message } from "../components/Message";
import { describeSearch, useSearch } from "../search";

/** O servidor devolve no máximo 50 resultados. */
const MAX_RESULTS = 50;

/** Os resultados de uma pesquisa por nome (`/pesquisa?q=...`): pastas e ficheiros, cada um com a pasta onde está. */
export default function SearchPage() {
  const [params] = useSearchParams();
  const raw = params.get("q") ?? "";
  const { term, problem } = describeSearch(raw);
  const search = useSearch(raw);

  let body;
  if (term === "") {
    body = <p className="mt-6 text-slate-500">Escreva o que procura na caixa de pesquisa.</p>;
  } else if (problem !== null) {
    body = <p className="mt-6 text-slate-500">{problem}</p>;
  } else if (search.isPending) {
    body = <p className="mt-6 text-slate-500">A pesquisar…</p>;
  } else if (search.isError && search.data === undefined) {
    body = (
      <div className="mt-6 max-w-md space-y-4">
        <Message kind="error">{errorMessage(search.error)}</Message>
        <Button variant="secondary" onClick={() => void search.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  } else if (search.data.length === 0) {
    body = <p className="mt-6 text-slate-500">Nenhum resultado para «{term}».</p>;
  } else {
    body = (
      <>
        {search.isError && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Message kind="error">{errorMessage(search.error)}</Message>
            <Button variant="secondary" onClick={() => void search.refetch()}>
              Tentar novamente
            </Button>
          </div>
        )}
        <p className="mt-2 text-sm text-slate-600">
          {search.data.length >= MAX_RESULTS
            ? `Mostram-se os primeiros ${MAX_RESULTS} resultados. Escreva mais para os afinar.`
            : `${search.data.length} ${search.data.length === 1 ? "resultado" : "resultados"}`}
        </p>
        <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {search.data.map((result) =>
            result.kind === "folder" ? (
              <FolderRow key={`folder-${result.folder.id}`} folder={result.folder} path={result.path} />
            ) : (
              <FileRow key={`file-${result.file.id}`} file={result.file} path={result.path} />
            ),
          )}
        </ul>
      </>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight break-words">
        {problem === null ? `Resultados para «${term}»` : "Pesquisa"}
      </h1>
      {body}
    </div>
  );
}
