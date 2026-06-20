import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pool } from '../src/db';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

export async function migrate(): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await pool.query(sql);
    console.log(`applied migration: ${file}`);
  }
}

if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
