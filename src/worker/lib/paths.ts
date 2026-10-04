import type { BreadcrumbItem } from "../../shared/types";
import { MAX_FOLDER_DEPTH } from "./folders";

/** Pastas por consulta: bem abaixo do limite de 100 parâmetros de uma instrução da D1. */
const CHUNK_SIZE = 50;

/**
 * O caminho (da raiz até à pasta, inclusive) de cada uma das pastas pedidas. Uma consulta recursiva por bloco de 50 pastas,
 * nunca uma por pasta: o plano gratuito do Workers limita as chamadas por invocação, e a pesquisa mostra
 * até 50 itens e a lixeira até 200. Pastas que não existem ou são de outro utilizador ficam fora do mapa.
 */
export async function pathsForFolders(
  db: D1Database,
  userId: string,
  folderIds: Iterable<string>,
): Promise<Map<string, BreadcrumbItem[]>> {
  const unique = [...new Set(folderIds)];
  const paths = new Map<string, BreadcrumbItem[]>();
  for (let start = 0; start < unique.length; start += CHUNK_SIZE) {
    const chunk = unique.slice(start, start + CHUNK_SIZE);
    const marks = chunk.map((_id, index) => `?${index + 2}`).join(", ");
    const { results } = await db
      .prepare(
        `WITH RECURSIVE anc(start_id, id, parent_id, name, depth) AS (
           SELECT id, id, parent_id, name, 0 FROM folders WHERE user_id = ?1 AND id IN (${marks})
           UNION ALL
           SELECT a.start_id, f.id, f.parent_id, f.name, a.depth + 1
           FROM folders f JOIN anc a ON f.id = a.parent_id
           WHERE f.user_id = ?1 AND a.depth < ${MAX_FOLDER_DEPTH}
         )
         SELECT start_id, id, name FROM anc ORDER BY start_id, depth DESC`,
      )
      .bind(userId, ...chunk)
      .all<{ start_id: string; id: string; name: string }>();
    for (const row of results) {
      const item = { id: row.id, name: row.name };
      const trail = paths.get(row.start_id);
      if (trail) trail.push(item);
      else paths.set(row.start_id, [item]);
    }
  }
  return paths;
}

/** O caminho de uma pasta no mapa de `pathsForFolders`; `null` (a raiz) tem caminho vazio. */
export function trailOf(paths: Map<string, BreadcrumbItem[]>, folderId: string | null): BreadcrumbItem[] {
  return folderId === null ? [] : (paths.get(folderId) ?? []);
}
