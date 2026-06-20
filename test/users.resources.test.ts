import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, ADMIN, MEMBER2, MEMBER3, MEMBER4, useSeededDb } from './helpers';

useSeededDb();

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
