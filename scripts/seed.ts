import { pool } from '../src/db';

// Deterministic seed data — tests rely on these exact counts and ids.

const USERS: Array<{ id: number; name: string; role: 'member' | 'admin' }> = [
  { id: 1, name: 'Alice Admin', role: 'admin' },
  { id: 2, name: 'Bob Member', role: 'member' },
  { id: 3, name: 'Carol Member', role: 'member' },
  { id: 4, name: 'Dave Member', role: 'member' },
];

const TYPES = ['doc', 'sheet', 'slide'];
const STATUSES = ['draft', 'published', 'archived'];

// 30 resources spread deterministically across the four owners.
const RESOURCE_COUNT = 30;

// A handful of explicit shares so "shared access" is testable.
// (resource_id, user_id) — none of these share a resource with its own owner.
const SHARES: Array<{ resourceId: number; userId: number }> = [
  { resourceId: 1, userId: 2 }, // owner 1, shared with 2
  { resourceId: 2, userId: 3 }, // owner 2, shared with 3
  { resourceId: 5, userId: 4 }, // owner 1, shared with 4
  { resourceId: 10, userId: 2 }, // owner 2, shared with 2
  { resourceId: 14, userId: 3 }, // owner 2, shared with 3
];

export async function seed(): Promise<void> {
  await pool.query('TRUNCATE resource_shares, resources, users RESTART IDENTITY CASCADE');

  for (const u of USERS) {
    await pool.query('INSERT INTO users (id, name, role) VALUES ($1, $2, $3)', [
      u.id,
      u.name,
      u.role,
    ]);
  }

  // Fixed base timestamp keeps created_at deterministic for stable ordering.
  const base = new Date('2024-01-01T00:00:00.000Z').getTime();

  for (let i = 1; i <= RESOURCE_COUNT; i++) {
    const ownerId = ((i - 1) % USERS.length) + 1;
    const type = TYPES[(i - 1) % TYPES.length];
    const status = STATUSES[(i - 1) % STATUSES.length];
    const createdAt = new Date(base + i * 3600 * 1000).toISOString();

    await pool.query(
      `INSERT INTO resources (id, owner_id, type, status, title, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [i, ownerId, type, status, `${type} #${i}`, createdAt],
    );
  }

  for (const s of SHARES) {
    await pool.query(
      'INSERT INTO resource_shares (resource_id, user_id) VALUES ($1, $2)',
      [s.resourceId, s.userId],
    );
  }

  console.log(
    `seeded ${USERS.length} users, ${RESOURCE_COUNT} resources, ${SHARES.length} shares`,
  );
}

if (require.main === module) {
  seed()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
