import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, ADMIN, makeRawCursor, useSeededDb } from './helpers';

// Validation runs after authentication, so every request is authenticated (as
// admin) to reach the validation logic.
useSeededDb();

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
