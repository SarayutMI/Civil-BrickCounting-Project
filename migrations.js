/**
 * CIVIL — versioned SQL migrations.
 *
 * Applies every migrations/NNN_*.sql file that has not been recorded in schema_migrations yet,
 * in filename order, each inside its own transaction. Safe on a database that already holds
 * the tables from the old sql/schema.sql: 001 uses IF NOT EXISTS everywhere.
 * An advisory lock keeps two starting processes from migrating at the same time.
 */
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const LOCK_KEY = 727001;

async function runMigrations(pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name       TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    const applied = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`migration ${file} failed: ${err.message}`);
      }
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

module.exports = { runMigrations };

if (require.main === module) {
  const { pool } = require('./db');
  runMigrations(pool)
    .then((applied) => {
      console.log(applied.length ? `[migrate] applied: ${applied.join(', ')}` : '[migrate] up to date');
      return pool.end();
    })
    .catch((err) => { console.error('[migrate]', err.message); process.exit(1); });
}
