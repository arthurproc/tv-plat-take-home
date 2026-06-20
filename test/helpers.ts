import { afterAll, beforeAll, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { migrate } from '../scripts/migrate';
import { seed } from '../scripts/seed';
import { pool } from '../src/db';

export { pool };
export const app = createApp();

// Seed roles: 1 = Alice (admin, bypasses scoping), 2/3/4 = members.
export const ADMIN = '1';
export const MEMBER2 = '2';
export const MEMBER3 = '3';
export const MEMBER4 = '4';

// Registers the per-file database lifecycle. Vitest isolates each test file (so
// each gets its own pg pool) and runs files serially (fileParallelism:false in
// vitest.config.ts). Re-seeding per file therefore keeps every file independent
// and starting from pristine data, and each file safely closes its own pool.
export function useSeededDb(): void {
  beforeAll(async () => {
    await migrate();
    await seed();
  });
  afterAll(async () => {
    await pool.end();
  });
}

// Walks every page of GET /resources for a given filter/viewer and returns the
// flat list of ids in the order returned. Proves the cursor terminates and lets
// callers assert there are no gaps or duplicates across page boundaries.
export async function fetchAllIds(
  params: Record<string, string>,
  limit: number,
  userId: string = ADMIN,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;

  for (let page = 0; ; page++) {
    if (page > 100) throw new Error('pagination did not terminate');

    const search = new URLSearchParams({ ...params, limit: String(limit) });
    if (cursor) search.set('cursor', cursor);

    const res = await request(app)
      .get(`/resources?${search.toString()}`)
      .set('x-user-id', userId);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(limit);

    ids.push(...res.body.data.map((r: { id: string }) => r.id));
    if (!res.body.nextCursor) break;
    cursor = res.body.nextCursor;
  }

  return ids;
}

// Hand-crafts a cursor with an arbitrary (possibly invalid) payload, the same
// way the server encodes them, to exercise cursor value-validation branches.
export function makeRawCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
