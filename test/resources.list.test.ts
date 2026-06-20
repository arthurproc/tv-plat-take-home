import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, ADMIN, fetchAllIds, pool, useSeededDb } from './helpers';

// Task 1 list mechanics: pagination, filtering, and keyset edge cases. Run as
// admin so the unscoped (full) seeded set is visible — access scoping has its
// own file.
useSeededDb();

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
