// PostgREST caps every response at 1,000 rows, so `.limit(100000)` silently returns
// at most 1,000. These helpers page through with `.range()` so nothing is dropped.

const PAGE = 1000;
const ID_CHUNK = 100;

/**
 * Fetch every row of a query, 1,000 at a time. `make` must build a fresh query on each
 * call and give it a stable order (e.g. `.order('id')`), or pages can overlap.
 */
export async function fetchAllRows<T = any>(make: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/**
 * Fetch every row whose `column` is in `ids`: ids are chunked (keeps URLs short) and each
 * chunk is paged. `make(chunk)` builds the filtered, ordered query for one chunk.
 */
export async function fetchAllByIds<T = any>(ids: string[], make: (chunk: string[]) => any): Promise<T[]> {
  const unique = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const chunk = unique.slice(i, i + ID_CHUNK);
    out.push(...(await fetchAllRows<T>(() => make(chunk))));
  }
  return out;
}
