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

describe('GET /resources', () => {
  it('returns the full seeded set of resources', async () => {
    const res = await request(app).get('/resources');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(30);
  });
});
