import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, ADMIN, MEMBER2, fetchAllIds, pool, useSeededDb } from './helpers';

// Task 2: user-scoped access control.
//
// Seed visibility (own ∪ shared), derived from scripts/seed.ts:
//   member #2: owns {2,6,10,14,18,22,26,30}; shared {1, 10(self)} -> 9 distinct
//   member #3: owns {3,7,11,15,19,23,27};    shared {2, 14}       -> 9 distinct
//   member #4: owns {4,8,12,16,20,24,28};    shared {5}           -> 8 distinct
useSeededDb();

describe('GET /resources — access scoping', () => {
  it('admin sees every resource', async () => {
    const res = await request(app).get('/resources?limit=100').set('x-user-id', ADMIN);
    expect(res.body.data).toHaveLength(30);
  });

  it('a member sees only resources they own or that are shared with them', async () => {
    const ids = await fetchAllIds({}, 100, MEMBER2);
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
    expect(res.body).toHaveLength(9); // member #2 can see 9 resources total
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
