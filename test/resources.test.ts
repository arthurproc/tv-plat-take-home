import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { migrate } from '../scripts/migrate';
import { seed } from '../scripts/seed';
import { pool } from '../src/db';

const app = createApp();

beforeAll(async () => {
  // Boot against the docker Postgres: apply migrations, then reset + seed.
  await migrate();
  await seed();
});

afterAll(async () => {
  await pool.end();
});

// Walk every page of GET /resources for a given filter and return the flat list
// of ids in the order the API returned them. Proves the cursor terminates and
// lets us assert there are no gaps or duplicates across page boundaries.
async function fetchAllIds(
  params: Record<string, string>,
  limit: number,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;

  for (let page = 0; ; page++) {
    if (page > 100) throw new Error('pagination did not terminate');

    const search = new URLSearchParams({ ...params, limit: String(limit) });
    if (cursor) search.set('cursor', cursor);

    const res = await request(app).get(`/resources?${search.toString()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(limit);

    ids.push(...res.body.data.map((r: { id: string }) => r.id));
    if (!res.body.nextCursor) break;
    cursor = res.body.nextCursor;
  }

  return ids;
}

// Hand-craft a cursor with an arbitrary (possibly invalid) payload, the same way
// the server encodes them, so we can exercise the value-validation branches that
// guard against a tampered cursor reaching SQL.
function makeRawCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

describe('GET /resources — pagination', () => {
  it('returns an envelope with the default page size (20) and a nextCursor', async () => {
    const res = await request(app).get('/resources');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(20);
    expect(res.body.pageSize).toBe(20);
    expect(typeof res.body.nextCursor).toBe('string');
  });

  it('orders newest-first by (created_at, id)', async () => {
    const res = await request(app).get('/resources?limit=5');
    // Seed created_at increases monotonically with id, so newest-first == id desc.
    expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([
      '30',
      '29',
      '28',
      '27',
      '26',
    ]);
  });

  it('walks the entire set across pages with no gaps or duplicates', async () => {
    const ids = await fetchAllIds({}, 7);

    expect(ids).toHaveLength(30);
    expect(new Set(ids).size).toBe(30); // no duplicates across page boundaries
    // Full descending order, end to end.
    const expected = Array.from({ length: 30 }, (_, i) => String(30 - i));
    expect(ids).toEqual(expected);
  });

  it('returns a null nextCursor on the final page', async () => {
    const res = await request(app).get('/resources?limit=100');
    expect(res.body.data).toHaveLength(30);
    expect(res.body.nextCursor).toBeNull();
  });
});

describe('GET /resources — filtering', () => {
  it('filters by type', async () => {
    const res = await request(app).get('/resources?type=doc&limit=100');
    expect(res.body.data).toHaveLength(10);
    expect(res.body.data.every((r: { type: string }) => r.type === 'doc')).toBe(true);
  });

  it('filters by status', async () => {
    const res = await request(app).get('/resources?status=draft&limit=100');
    expect(res.body.data).toHaveLength(10);
    expect(
      res.body.data.every((r: { status: string }) => r.status === 'draft'),
    ).toBe(true);
  });

  it('combines type and status filters', async () => {
    const res = await request(app).get('/resources?type=doc&status=draft&limit=100');
    expect(res.body.data).toHaveLength(10); // doc and draft align in the seed
    expect(
      res.body.data.every(
        (r: { type: string; status: string }) =>
          r.type === 'doc' && r.status === 'draft',
      ),
    ).toBe(true);
  });

  it('returns an empty result (not an error) when nothing matches', async () => {
    const res = await request(app).get('/resources?type=doc&status=published');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.nextCursor).toBeNull();
  });

  it('paginates correctly while filtered', async () => {
    const ids = await fetchAllIds({ type: 'doc' }, 4);
    // docs are ids where (i-1) % 3 === 0, newest-first.
    expect(ids).toEqual(['28', '25', '22', '19', '16', '13', '10', '7', '4', '1']);
  });
});

describe('GET /resources — input validation', () => {
  const badRequests: Array<[string, string]> = [
    ['rejects limit below the minimum', 'limit=0'],
    ['rejects limit above the maximum', 'limit=101'],
    ['rejects a non-numeric limit', 'limit=abc'],
    ['rejects a non-integer limit', 'limit=1.5'],
    ['rejects an empty type', 'type='],
    ['rejects unknown query parameters', 'foo=bar'],
  ];

  for (const [name, qs] of badRequests) {
    it(name, async () => {
      const res = await request(app).get(`/resources?${qs}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  }

  it('rejects a malformed cursor with 400 (not 500)', async () => {
    const res = await request(app).get('/resources?cursor=not-a-real-cursor');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURSOR');
  });

  // A cursor can be valid base64+JSON yet carry tampered values. These must be
  // rejected with 400 BEFORE reaching the ::timestamptz / ::bigint SQL casts,
  // which would otherwise throw and surface as a 500.
  const tamperedCursors: Array<[string, unknown]> = [
    ['a non-numeric id', { c: '2024-01-01T00:00:00.000000Z', id: 'abc' }],
    ['an unparseable timestamp', { c: 'not-a-date', id: '5' }],
    ['a missing id field', { c: '2024-01-01T00:00:00.000000Z' }],
  ];

  for (const [name, payload] of tamperedCursors) {
    it(`rejects a tampered cursor with ${name} (400, not 500)`, async () => {
      const res = await request(app).get(
        `/resources?cursor=${encodeURIComponent(makeRawCursor(payload))}`,
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CURSOR');
    });
  }

  it('returns JSON (not an HTML stack page) for unknown routes', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /resources — keyset tiebreaker (rows sharing a created_at)', () => {
  it('paginates rows with an identical created_at without skips or duplicates', async () => {
    // Two rows with the SAME created_at, in the future so they sort first.
    const sharedTs = '2999-01-01T00:00:00.000Z';
    await pool.query(
      `INSERT INTO resources (id, owner_id, type, status, title, created_at, updated_at)
       VALUES (9001, 1, 'doc', 'draft', 'tie a', $1, $1),
              (9002, 1, 'doc', 'draft', 'tie b', $1, $1)`,
      [sharedTs],
    );

    try {
      // limit=1 forces the page boundary to land between the two tied rows.
      const page1 = await request(app).get('/resources?limit=1');
      const page2 = await request(app).get(
        `/resources?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
      );

      // id desc breaks the created_at tie: 9002 before 9001, each exactly once.
      expect(page1.body.data[0].id).toBe('9002');
      expect(page2.body.data[0].id).toBe('9001');
    } finally {
      await pool.query('DELETE FROM resources WHERE id IN (9001, 9002)');
    }
  });

  it('paginates rows that differ only by microseconds within the same millisecond', async () => {
    // Same millisecond (.000), different microseconds. If the cursor were built
    // from a JS Date (ms precision) these would collide and the boundary row
    // would be skipped. The cursor carries microsecond precision, so it doesn't.
    await pool.query(
      `INSERT INTO resources (id, owner_id, type, status, title, created_at, updated_at)
       VALUES (9003, 1, 'doc', 'draft', 'us a', '2999-01-01T00:00:00.000001Z', '2999-01-01T00:00:00.000001Z'),
              (9004, 1, 'doc', 'draft', 'us b', '2999-01-01T00:00:00.000002Z', '2999-01-01T00:00:00.000002Z')`,
    );

    try {
      const page1 = await request(app).get('/resources?limit=1');
      const page2 = await request(app).get(
        `/resources?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
      );

      // 9004 (.000002) is newest, then 9003 (.000001) — neither skipped.
      expect(page1.body.data[0].id).toBe('9004');
      expect(page2.body.data[0].id).toBe('9003');
    } finally {
      await pool.query('DELETE FROM resources WHERE id IN (9003, 9004)');
    }
  });
});

describe('shared path regression — other callers of findResources', () => {
  it('GET /resources/recent still returns the 10 newest as a bare array', async () => {
    const res = await request(app).get('/resources/recent');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(10);
    expect(res.body.map((r: { id: string }) => r.id)).toEqual([
      '30', '29', '28', '27', '26', '25', '24', '23', '22', '21',
    ]);
  });

  it('GET /users/:userId/resources still returns that owner\'s resources', async () => {
    const res = await request(app).get('/users/2/resources');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.every((r: { owner_id: string }) => r.owner_id === '2')).toBe(true);
    expect(res.body.map((r: { id: string }) => r.id).sort((a: string, b: string) => Number(a) - Number(b)))
      .toEqual(['2', '6', '10', '14', '18', '22', '26', '30']);
  });
});
