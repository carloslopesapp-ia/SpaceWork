import { normalizeName, searchKey } from "../../shared/names";
import type { SearchResult } from "../../shared/types";
import { ApiError } from "../errors";
import { pathsForFolders, trailOf } from "../lib/paths";
import { createAuthedRouter } from "./authed";

export const search = createAuthedRouter();

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 50;

interface SearchRow {
  kind: "folder" | "file";
  id: string;
  container_id: string | null;
  name: string;
  size: number;
  mime: string;
  created_at: number;
}

/** O texto como padrão de `LIKE ... ESCAPE '\'`: `%`, `_` e `\` do utilizador valem como letras. */
function containsPattern(key: string): string {
  return `%${key.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * Pesquisa por nome (sem maiúsculas nem acentos) nas pastas e nos ficheiros prontos e fora da lixeira do utilizador:
 * mínimo 2 caracteres, no máximo 50 resultados, por ordem de nome. Cada resultado traz o caminho da pasta onde está.
 */
search.get("/", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const query = normalizeName(c.req.query("q") ?? "");
  if (query.length > MAX_QUERY_LENGTH) {
    throw new ApiError(400, "query_too_long", `A pesquisa não pode ter mais de ${MAX_QUERY_LENGTH} caracteres.`);
  }
  const key = searchKey(query);
  if ([...key].length < MIN_QUERY_LENGTH) {
    throw new ApiError(400, "query_too_short", `Escreva pelo menos ${MIN_QUERY_LENGTH} caracteres.`);
  }

  const { results: rows } = await db
    .prepare(
      `SELECT 'folder' AS kind, id, parent_id AS container_id, name, name_norm, 0 AS size, '' AS mime, created_at
         FROM folders WHERE user_id = ?1 AND name_norm LIKE ?2 ESCAPE '\\'
       UNION ALL
       SELECT 'file', id, folder_id, name, name_norm, size, mime, created_at
         FROM files WHERE user_id = ?1 AND status = 'ready' AND deleted_at IS NULL AND name_norm LIKE ?2 ESCAPE '\\'
       ORDER BY name_norm, name LIMIT ${MAX_RESULTS}`,
    )
    .bind(userId, containsPattern(key))
    .all<SearchRow>();

  const paths = await pathsForFolders(
    db,
    userId,
    rows.flatMap((row) => (row.container_id === null ? [] : [row.container_id])),
  );
  const results: SearchResult[] = rows.map((row) => {
    const path = trailOf(paths, row.container_id);
    return row.kind === "folder"
      ? {
          kind: "folder",
          folder: { id: row.id, name: row.name, parentId: row.container_id, createdAt: row.created_at },
          path,
        }
      : {
          kind: "file",
          file: {
            id: row.id,
            name: row.name,
            folderId: row.container_id,
            size: row.size,
            mime: row.mime,
            createdAt: row.created_at,
          },
          path,
        };
  });
  return c.json({ results });
});
