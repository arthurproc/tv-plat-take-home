import { pool } from '../db';

// A keyset pagination cursor: the sort key of the last row on the previous page.
// `id` is kept as a string because pg returns bigint as a string (a bigint can
// exceed Number.MAX_SAFE_INTEGER, so parsing it to a JS number would lose
// precision). It is the unique tiebreaker that makes pagination correct.
export interface Cursor {
  createdAt: string; // ISO timestamp of the last row on the previous page
  id: string; // bigint id of that row, as a string
}

export interface FindResourcesOpts {
  ownerId?: number;
  type?: string;
  status?: string;
  cursor?: Cursor;
  // Page size. When set, at most `limit` rows are returned and a nextCursor is
  // produced if more rows exist. When omitted, all matching rows are returned
  // (used by callers that are not paginated).
  limit?: number;
}

export interface ResourceRow {
  id: string;
  owner_id: string;
  type: string;
  status: string;
  title: string;
  created_at: Date;
  updated_at: Date;
}

// Internal row shape: ResourceRow plus the microsecond-precision cursor value
// for created_at. We derive the cursor from this (not from the JS Date) because
// pg maps timestamptz to a JS Date, which only carries millisecond precision —
// two rows in the same millisecond but different microseconds would otherwise
// get an identical cursor and the keyset boundary could skip/duplicate a row.
interface QueryRow extends ResourceRow {
  created_at_cursor: string;
}

export interface FindResourcesResult {
  rows: ResourceRow[];
  nextCursor: Cursor | null;
}

// SHARED PATH — used by multiple endpoints. Changing this affects all callers.
//
// Rows are ALWAYS ordered newest-first by (created_at DESC, id DESC). `id` is a
// unique tiebreaker, which is what makes keyset pagination correct even when two
// rows share a created_at. Ordering is fixed here (not caller-supplied) so no
// request input can ever be interpolated into the ORDER BY clause.
export async function findResources(
  opts: FindResourcesOpts = {},
): Promise<FindResourcesResult> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (opts.ownerId !== undefined) {
    params.push(opts.ownerId);
    conditions.push(`owner_id = $${params.length}`);
  }
  if (opts.type !== undefined) {
    params.push(opts.type);
    conditions.push(`type = $${params.length}`);
  }
  if (opts.status !== undefined) {
    params.push(opts.status);
    conditions.push(`status = $${params.length}`);
  }
  if (opts.cursor !== undefined) {
    params.push(opts.cursor.createdAt, opts.cursor.id);
    // Row-value comparison: every row strictly "after" the cursor row in
    // (created_at DESC, id DESC) order. Equivalent to:
    //   created_at < c OR (created_at = c AND id < id)
    conditions.push(
      `(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`,
    );
  }

  let sql = `
    SELECT id, owner_id, type, status, title, created_at, updated_at,
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             AS created_at_cursor
    FROM resources
  `;
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }
  sql += ` ORDER BY created_at DESC, id DESC`;

  // Fetch one extra row to detect whether a further page exists — avoids a
  // separate COUNT query just to know if there's a "next".
  if (opts.limit !== undefined) {
    params.push(opts.limit + 1);
    sql += ` LIMIT $${params.length}`;
  }

  const result = await pool.query<QueryRow>(sql, params);
  let queryRows = result.rows;
  let nextCursor: Cursor | null = null;

  if (opts.limit !== undefined && queryRows.length > opts.limit) {
    queryRows = queryRows.slice(0, opts.limit);
    const last = queryRows[queryRows.length - 1];
    // Microsecond-precision value from Postgres, not last.created_at (ms).
    nextCursor = { createdAt: last.created_at_cursor, id: last.id };
  }

  // Strip the internal cursor column so it never leaks into the API response.
  const rows: ResourceRow[] = queryRows.map(
    ({ created_at_cursor, ...row }) => row,
  );

  return { rows, nextCursor };
}
