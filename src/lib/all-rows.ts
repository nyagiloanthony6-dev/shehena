/**
 * Supabase returns at most 1,000 rows per request. `allRows` keeps asking for the next page
 * until everything has arrived. Pass a function that builds the query (with filters and a
 * stable order); it is called once per page with the row range to fetch.
 */
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function allRows<T>(query: (from: number, to: number) => Page<T>, pageSize = 1000): Promise<{ data: T[]; error: string | null }> {
  const rows: T[] = [];
  let first = 0;
  for (;;) {
    const { data, error } = await query(rows.length, rows.length + pageSize - 1);
    if (error) return { data: rows, error: error.message };
    const got = data || [];
    if (!first) first = got.length;
    rows.push(...got);
    if (!got.length || got.length < first) return { data: rows, error: null };
  }
}
