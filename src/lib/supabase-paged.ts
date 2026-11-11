// PostgREST caps every response at 1,000 rows, so `.limit(100000)` silently returns
// at most 1,000. These helpers page through with `.range()` so nothing is dropped.

const PAGE = 1000;
const ID_CHUNK = 100;

/** Pages requested at once after the first full page. */
const PAGE_WAVE = 4;

/**
 * Fetch every row of a query, 1,000 at a time. `make` must build a fresh query on each
 * call and give it a stable order (e.g. `.order('id')`), or pages can overlap.
 *
 * The first page goes alone (most tables fit in it). When it comes back full, the
 * following pages are requested a few at once instead of one after another, so a
 * 4,000-row table takes two round trips instead of five.
 */
export async function fetchAllRows<T = any>(make: () => any): Promise<T[]> {
  const page = async (index: number): Promise<T[]> => {
    const from = index * PAGE;
    const { data, error } = await make().range(from, from + PAGE - 1);
    if (error) throw error;
    return (data ?? []) as T[];
  };
  const out = await page(0);
  if (out.length < PAGE) return out;
  for (let next = 1; ; next += PAGE_WAVE) {
    const wave = await Promise.all(Array.from({ length: PAGE_WAVE }, (_, i) => page(next + i)));
    for (const rows of wave) {
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }
}

const CHUNK_CONCURRENCY = 4;

/**
 * Fetch every row whose `column` is in `ids`: ids are chunked (keeps URLs short) and each
 * chunk is paged. `make(chunk)` builds the filtered, ordered query for one chunk. Up to
 * four chunks are in flight at once; rows come back in chunk order.
 */
export async function fetchAllByIds<T = any>(ids: string[], make: (chunk: string[]) => any): Promise<T[]> {
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += ID_CHUNK) chunks.push(unique.slice(i, i + ID_CHUNK));
  const results: T[][] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      results[i] = await fetchAllRows<T>(() => make(chunks[i]));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, worker));
  return results.flat();
}
