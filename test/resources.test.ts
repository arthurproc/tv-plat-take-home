import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { migrate } from '../scripts/migrate';
import { seed } from '../scripts/seed';
import { pool } from '../src/db';

const app = createApp();

// Seed roles: 1 = Alice (admin), 2/3/4 = members. Admin bypasses scoping, so the
// Task 1 pagination/filter tests run as admin to still see the full seeded set.
const ADMIN = '1';
const MEMBER2 = '2';
const MEMBER3 = '3';
const MEMBER4 = '4';

beforeAll(async () => {
  // Boot against the docker Postgres: apply migrations, then reset + seed.
  await migrate();
  await seed();
});

afterAll(async () => {
  await pool.end();
});

// Walk every page of GET /resources for a given filter/viewer and return the
// flat list of ids in the order the API returned them. Proves the cursor
// terminates and lets us assert there are no gaps or duplicates across pages.
async function fetchAllIds(
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

function makeRawCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

describe('GET /resources — pagination (as admin)', () => {
  it('returns an envelope with the default page size (20) and a nextCursor', async () => {
    const res = await request(app).get('/resources').set('x-user-id', ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(20);
    expect(res.body.pageSize).toBe(20);
    expect(typeof res.body.nextCursor).toBe('string');
  });

  it('orders newest-first by (created_at, id)', async () => {
    const res = await request(app).get('/resources?limit=5').set('x-user-id', ADMIN);
    expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([
      '30', '29', '28', '27', '26',
    ]);
  });

  it('walks the entire set across pages with no gaps or duplicates', async () => {
    const ids = await fetchAllIds({}, 7);

    expect(ids).toHaveLength(30);
    expect(new Set(ids).size).toBe(30);
    expect(ids).toEqual(Array.from({ length: 30 }, (_, i) => String(30 - i)));
  });

  it('returns a null nextCursor on the final page', async () => {
    const res = await request(app).get('/resources?limit=100').set('x-user-id', ADMIN);
    expect(res.body.data).toHaveLength(30);
    expect(res.body.nextCursor).toBeNull();
  });
});

describe('GET /resources — filtering (as admin)', () => {
  it('filters by type', async () => {
    const res = await request(app).get('/resources?type=doc&limit=100').set('x-user-id', ADMIN);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.data.every((r: { type: string }) => r.type === 'doc')).toBe(true);
  });

  it('filters by status', async () => {
    const res = await request(app).get('/resources?status=draft&limit=100').set('x-user-id', ADMIN);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.data.every((r: { status: string }) => r.status === 'draft')).toBe(true);
  });

  it('combines type and status filters', async () => {
    const res = await request(app).get('/resources?type=doc&status=draft&limit=100').set('x-user-id', ADMIN);
    expect(res.body.data).toHaveLength(10);
    expect(
      res.body.data.every(
        (r: { type: string; status: string }) => r.type === 'doc' && r.status === 'draft',
      ),
    ).toBe(true);
  });

  it('returns an empty result (not an error) when nothing matches', async () => {
    const res = await request(app).get('/resources?type=doc&status=published').set('x-user-id', ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.nextCursor).toBeNull();
  });

  it('paginates correctly while filtered', async () => {
    const ids = await fetchAllIds({ type: 'doc' }, 4);
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
      const res = await request(app).get(`/resources?${qs}`).set('x-user-id', ADMIN);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  }

  it('rejects a malformed cursor with 400 (not 500)', async () => {
    const res = await request(app).get('/resources?cursor=not-a-real-cursor').set('x-user-id', ADMIN);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURSOR');
  });

  // Valid base64+JSON but tampered values must be rejected with 400 BEFORE
  // reaching the ::timestamptz / ::bigint casts (which would otherwise 500).
  const tamperedCursors: Array<[string, unknown]> = [
    ['a non-numeric id', { c: '2024-01-01T00:00:00.000000Z', id: 'abc' }],
    ['an unparseable timestamp', { c: 'not-a-date', id: '5' }],
    ['a missing id field', { c: '2024-01-01T00:00:00.000000Z' }],
  ];

  for (const [name, payload] of tamperedCursors) {
    it(`rejects a tampered cursor with ${name} (400, not 500)`, async () => {
      const res = await request(app)
        .get(`/resources?cursor=${encodeURIComponent(makeRawCursor(payload))}`)
        .set('x-user-id', ADMIN);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CURSOR');
    });
  }

  it('returns JSON (not an HTML stack page) for unknown routes', async () => {
    const res = await request(app).get('/nope').set('x-user-id', ADMIN);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /resources — keyset tiebreaker (as admin)', () => {
  it('paginates rows with an identical created_at without skips or duplicates', async () => {
    const sharedTs = '2999-01-01T00:00:00.000000Z';
    await pool.query(
      `INSERT INTO resources (id, owner_id, type, status, title, created_at, updated_at)
       VALUES (9001, 1, 'doc', 'draft', 'tie a', $1, $1),
              (9002, 1, 'doc', 'draft', 'tie b', $1, $1)`,
      [sharedTs],
    );

    try {
      const page1 = await request(app).get('/resources?limit=1').set('x-user-id', ADMIN);
      const page2 = await request(app)
        .get(`/resources?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
        .set('x-user-id', ADMIN);

      expect(page1.body.data[0].id).toBe('9002');
      expect(page2.body.data[0].id).toBe('9001');
    } finally {
      await pool.query('DELETE FROM resources WHERE id IN (9001, 9002)');
    }
  });

  it('paginates rows that differ only by microseconds within the same millisecond', async () => {
    await pool.query(
      `INSERT INTO resources (id, owner_id, type, status, title, created_at, updated_at)
       VALUES (9003, 1, 'doc', 'draft', 'us a', '2999-01-01T00:00:00.000001Z', '2999-01-01T00:00:00.000001Z'),
              (9004, 1, 'doc', 'draft', 'us b', '2999-01-01T00:00:00.000002Z', '2999-01-01T00:00:00.000002Z')`,
    );

    try {
      const page1 = await request(app).get('/resources?limit=1').set('x-user-id', ADMIN);
      const page2 = await request(app)
        .get(`/resources?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
        .set('x-user-id', ADMIN);

      expect(page1.body.data[0].id).toBe('9004');
      expect(page2.body.data[0].id).toBe('9003');
    } finally {
      await pool.query('DELETE FROM resources WHERE id IN (9003, 9004)');
    }
  });
});

// ── Task 2: user-scoped access control ─────────────────────────────────────
//
// Seed visibility (own ∪ shared), derived from scripts/seed.ts:
//   member #2: owns {2,6,10,14,18,22,26,30}; shared {1, 10(self)} -> 9 distinct
//   member #3: owns {3,7,11,15,19,23,27};    shared {2, 14}       -> 9 distinct
//   member #4: owns {4,8,12,16,20,24,28};    shared {5}           -> 8 distinct

describe('GET /resources — access scoping', () => {
  it('admin sees every resource', async () => {
    const res = await request(app).get('/resources?limit=100').set('x-user-id', ADMIN);
    expect(res.body.data).toHaveLength(30);
  });

  it('a member sees only resources they own or that are shared with them', async () => {
    const ids = await fetchAllIds({}, 100, MEMBER2);
    // owned {2,6,10,14,18,22,26,30} + shared #1; #10 is owned AND shared (no dup).
    expect(ids.slice().sort((a, b) => Number(a) - Number(b))).toEqual([
      '1', '2', '6', '10', '14', '18', '22', '26', '30',
    ]);
  });

  it('does not double-count a resource that is both owned and shared', async () => {
    const ids = await fetchAllIds({}, 100, MEMBER2);
    expect(ids.filter((id) => id === '10')).toHaveLength(1); // #10 shared to its owner
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a member does NOT see a resource they neither own nor are shared', async () => {
    const ids = await fetchAllIds({}, 100, MEMBER2);
    expect(ids).not.toContain('3'); // owned by #3, not shared with #2
  });

  it('returns an empty list for a member with no owned or shared resources', async () => {
    // Temporary member with nothing of their own and no shares.
    await pool.query("INSERT INTO users (id, name, role) VALUES (99, 'Empty', 'member')");
    try {
      const res = await request(app).get('/resources?limit=100').set('x-user-id', '99');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.nextCursor).toBeNull();
    } finally {
      await pool.query('DELETE FROM users WHERE id = 99');
    }
  });

  it('scopes /resources/recent to what the caller can see', async () => {
    const res = await request(app).get('/resources/recent').set('x-user-id', MEMBER2);
    expect(res.status).toBe(200);
    // member #2 can see 9 resources total, so "10 most recent" yields all 9.
    expect(res.body).toHaveLength(9);
    expect(res.body.every((r: { id: string }) =>
      ['1', '2', '6', '10', '14', '18', '22', '26', '30'].includes(r.id))).toBe(true);
  });
});

describe('GET /resources — authentication', () => {
  it('rejects a request with no x-user-id (401)', async () => {
    const res = await request(app).get('/resources');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a non-numeric x-user-id (401)', async () => {
    const res = await request(app).get('/resources').set('x-user-id', 'abc');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an unknown user id (401)', async () => {
    const res = await request(app).get('/resources').set('x-user-id', '9999');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('GET /users/:userId/resources — scoped per caller', () => {
  it('lets a user see all of their own resources (self)', async () => {
    const res = await request(app).get('/users/2/resources').set('x-user-id', MEMBER2);
    expect(res.status).toBe(200);
    expect(res.body.every((r: { owner_id: string }) => r.owner_id === '2')).toBe(true);
    expect(res.body.map((r: { id: string }) => r.id).sort((a: string, b: string) => Number(a) - Number(b)))
      .toEqual(['2', '6', '10', '14', '18', '22', '26', '30']);
  });

  it('lets an admin see all of a target user\'s resources', async () => {
    const res = await request(app).get('/users/2/resources').set('x-user-id', ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(8);
    expect(res.body.every((r: { owner_id: string }) => r.owner_id === '2')).toBe(true);
  });

  it('shows a member only the target\'s resources shared with them', async () => {
    // member #3 has resources {2,14} (both owned by #2) shared with them.
    const res = await request(app).get('/users/2/resources').set('x-user-id', MEMBER3);
    expect(res.status).toBe(200);
    expect(res.body.map((r: { id: string }) => r.id).sort((a: string, b: string) => Number(a) - Number(b)))
      .toEqual(['2', '14']);
  });

  it('returns an empty list when a member shares nothing with the target', async () => {
    // member #4 has no shares for any resource owned by #2.
    const res = await request(app).get('/users/2/resources').set('x-user-id', MEMBER4);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('rejects a non-numeric :userId with 400 (not 500)', async () => {
    const res = await request(app).get('/users/abc/resources').set('x-user-id', ADMIN);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication (401)', async () => {
    const res = await request(app).get('/users/2/resources');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('shared path regression — other callers of findResources (as admin)', () => {
  it('GET /resources/recent returns the 10 newest as a bare array', async () => {
    const res = await request(app).get('/resources/recent').set('x-user-id', ADMIN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(10);
    expect(res.body.map((r: { id: string }) => r.id)).toEqual([
      '30', '29', '28', '27', '26', '25', '24', '23', '22', '21',
    ]);
  });

  it('GET /users/:userId/resources returns that owner\'s resources as a bare array', async () => {
    const res = await request(app).get('/users/2/resources').set('x-user-id', ADMIN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.every((r: { owner_id: string }) => r.owner_id === '2')).toBe(true);
  });
});
