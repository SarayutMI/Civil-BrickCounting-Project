/**
 * CIVIL — create/update login accounts in PostgreSQL. No account or password lives in source code.
 *
 * Input is a JSON file (kept OUTSIDE git — see .gitignore: seed-users.local.json) shaped like
 *   [ { "name": "...", "email": "...", "username": "...", "password": "...", "role": "Admin" }, ... ]
 * Passwords are bcrypt-hashed here before the INSERT. Existing usernames are updated (idempotent).
 *
 * Usage:  node scripts/seed-users.js seed-users.local.json
 *         (one account, no file:)  node scripts/seed-users.js --username x --email y --name "N" --role Admin
 *                                  with PASSWORD=... in the environment
 */
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { runMigrations } = require('../migrations');

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
  const accounts = file
    ? JSON.parse(fs.readFileSync(file, 'utf-8'))
    : [{ name: argOf('--name'), email: argOf('--email'), username: argOf('--username'), password: process.env.PASSWORD, role: argOf('--role') }];

  await runMigrations(pool);
  const { rows: roleRows } = await pool.query('SELECT name FROM roles');
  const roleNames = new Map(roleRows.map((r) => [r.name.toLowerCase(), r.name]));

  for (const a of accounts) {
    const role = roleNames.get(String(a.role || '').toLowerCase());
    if (!a.username || !a.password || !role) {
      throw new Error(`account "${a.username || '?'}": ต้องมี username, password และ role ที่มีอยู่ (${[...roleNames.values()].join('/')})`);
    }
    if (String(a.password).length < 8) throw new Error(`account "${a.username}": password ต้องยาวอย่างน้อย 8 ตัวอักษร`);
    const hash = await bcrypt.hash(a.password, 10);
    const { rowCount } = await pool.query(
      `UPDATE users SET name=$2, email=$3, password=$4, role=$5 WHERE lower(username)=lower($1)`,
      [a.username, a.name || a.username, a.email || '', hash, role]
    );
    if (rowCount === 0) {
      await pool.query(
        `INSERT INTO users (id, name, email, username, password, role) VALUES ($1,$2,$3,$4,$5,$6)`,
        ['u' + crypto.randomUUID().slice(0, 8), a.name || a.username, a.email || '', a.username, hash, role]
      );
    }
    console.log(`[seed-users] ${rowCount ? 'updated' : 'created'} ${a.username} (${role})`);
  }
  await pool.end();
}

main().catch((err) => { console.error('[seed-users]', err.message); process.exit(1); });
