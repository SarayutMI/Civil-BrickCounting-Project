/**
 * CIVIL — PostgreSQL connection pool
 *
 * Reads connection info from a single DATABASE_URL, or from the individual
 * PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD env vars, with sensible localhost
 * defaults for the case where Postgres runs on the same box as this app.
 */
const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      host: process.env.PGHOST || '127.0.0.1',
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE || 'civil',
      user: process.env.PGUSER || 'civil_app',
      password: process.env.PGPASSWORD || '',
    });

pool.on('error', (err) => {
  // Idle client errors (e.g. a dropped connection) must not crash the whole process.
  console.error('[pg] unexpected error on idle client', err);
});

module.exports = { pool };
