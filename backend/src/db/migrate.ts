import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { config } from '../config';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

/**
 * Tiny migration runner: executes backend/migrations/*.sql in filename order,
 * recording applied files in schema_migrations. Transactions per migration.
 */
export async function runMigrations(connectionString: string = config.databaseUrl): Promise<string[]> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const applied: string[] = [];
    for (const file of files) {
      const seen = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (seen.rowCount) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
    return applied;
  } finally {
    await pool.end();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runMigrations()
    .then((applied) => {
      console.log(
        applied.length
          ? `Applied migrations: ${applied.join(', ')}`
          : 'Database already up to date.',
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
