/**
 * Chunked `.in(...)` reads.
 *
 * PostgREST takes filters in the query string, so `.in("id", ids)` serialises
 * every id into the URL. A UUID costs 36 characters plus an encoded comma, so a
 * course-sized list is not a small ask:
 *
 *   Edexcel GCSE Physics — 296 spec points → ~11.5 KB of query string
 *
 * That is past what the proxies in front of Postgres will accept on a request
 * line, and the failure is a bare 414 with no row-level explanation: the planner
 * page simply comes back empty for the biggest courses while working fine for
 * the smallest. Splitting the id list into batches keeps every request well
 * inside the limit, and the batches run concurrently so the wall-clock cost is
 * one round trip rather than N.
 *
 * CHUNK_SIZE is deliberately conservative: 150 UUIDs ≈ 5.9 KB of ids, leaving
 * room for the `select=`, ordering and other filters that ride along.
 */

const CHUNK_SIZE = 150;

/** Split a list into fixed-size batches. */
export function chunk<T>(items: readonly T[], size: number = CHUNK_SIZE): T[][] {
  if (items.length <= size) return items.length ? [items as T[]] : [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size) as T[]);
  return out;
}

/**
 * Run `query` once per batch of ids and concatenate the rows.
 *
 * `query` receives one batch and must return a promise of `{ data, error }` —
 * i.e. exactly what a Supabase builder resolves to, so call sites read almost
 * unchanged. The first error encountered is thrown, matching the single-request
 * behaviour it replaces.
 */
export async function selectIn<Row, Id = string>(
  ids: readonly Id[],
  query: (batch: Id[]) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const batches = chunk(ids);
  if (batches.length === 0) return [];
  if (batches.length === 1) {
    const { data, error } = await query(batches[0]);
    if (error) throw new Error(error.message);
    return data ?? [];
  }
  const results = await Promise.all(batches.map((b) => query(b)));
  const rows: Row[] = [];
  for (const { data, error } of results) {
    if (error) throw new Error(error.message);
    if (data) rows.push(...data);
  }
  return rows;
}

/**
 * As {@link selectIn}, but a failed batch yields no rows instead of throwing —
 * for the read paths that already treat a query error as "nothing to show"
 * rather than something to surface.
 */
export async function selectInSafe<Row, Id = string>(
  ids: readonly Id[],
  query: (batch: Id[]) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
  onError?: (message: string) => void,
): Promise<Row[]> {
  try {
    return await selectIn<Row, Id>(ids, query);
  } catch (e) {
    onError?.(e instanceof Error ? e.message : String(e));
    return [];
  }
}
