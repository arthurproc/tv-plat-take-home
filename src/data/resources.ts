import { pool } from '../db';

export interface FindResourcesOpts {
  ownerId?: number;
  limit?: number;
  orderBy?: string;
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

// SHARED PATH — used by multiple endpoints. Changing this affects all callers.
//
// There is NO access control here: every caller sees every resource it asks
// for, regardless of who is making the request. The auth stub populates
// req.userId but it never reaches this function.
export async function findResources(
  opts: FindResourcesOpts = {},
): Promise<ResourceRow[]> {
  const params: unknown[] = [];
  let sql = `
    SELECT id, owner_id, type, status, title, created_at, updated_at
    FROM resources
  `;

  if (opts.ownerId !== undefined) {
    params.push(opts.ownerId);
    sql += ` WHERE owner_id = $${params.length}`;
  }

  // orderBy is only ever passed internally (never from request input).
  if (opts.orderBy) {
    sql += ` ORDER BY ${opts.orderBy}`;
  }

  if (opts.limit !== undefined) {
    params.push(opts.limit);
    sql += ` LIMIT $${params.length}`;
  }

  const result = await pool.query<ResourceRow>(sql, params);
  return result.rows;
}
