/**
 * CIVIL — one-time JSON -> PostgreSQL migration
 *
 * Reads the existing flat JSON data files and inserts their contents into the
 * Postgres tables created by sql/schema.sql. Safe to re-run: every insert uses
 * `ON CONFLICT (id) DO NOTHING`, so re-running after a partial failure won't
 * duplicate rows (it just skips rows that already made it in).
 *
 * Usage:
 *   node migrate.js [--data-dir /path/to/json/files]
 *
 * Connection is taken from DATABASE_URL or PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD
 * (see db.js) — set those env vars before running.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

const args = process.argv.slice(2);
const dataDirFlagIdx = args.indexOf('--data-dir');
const DATA_DIR = dataDirFlagIdx !== -1 && args[dataDirFlagIdx + 1] ? args[dataDirFlagIdx + 1] : __dirname;

function readJson(filename, fallback) {
  const p = path.join(DATA_DIR, filename);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (err) {
    console.warn(`[migrate] skip ${filename}: ${err.message}`);
    return fallback;
  }
}

// Known/typed task fields — anything else on a task object is stashed in `extra`.
const TASK_KNOWN_KEYS = new Set([
  'id', 'name', 'zone', 'brickType', 'status', 'workers', 'area', 'expectedArea',
  'blocks', 'peopleDetected', 'cameraStatus', 'lastUpdate', 'confidence',
  'snapshotInterval', 'cameraId', 'schedule', 'roi', 'progressSeries',
  'createdAt', 'timelapseStatus',
]);
const CAMERA_KNOWN_KEYS = new Set(['id', 'name', 'url', 'zone', 'status', 'createdAt', 'lastTestedAt']);

async function migrateCameras() {
  const cameras = readJson('cameras.json', []);
  let n = 0;
  for (const c of cameras) {
    const extra = {};
    Object.keys(c).forEach((k) => { if (!CAMERA_KNOWN_KEYS.has(k)) extra[k] = c[k]; });
    await pool.query(
      `INSERT INTO cameras (id, name, url, zone, status, created_at, last_tested_at, extra)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [c.id, c.name, c.url, c.zone || '', c.status || 'unknown',
       c.createdAt || null, c.lastTestedAt || null, JSON.stringify(extra)]
    );
    n++;
  }
  console.log(`[migrate] cameras: ${n} rows`);
  return n;
}

async function migrateBrickTypes() {
  const brickTypes = readJson('brickTypes.json', []);
  let n = 0;
  for (const b of brickTypes) {
    await pool.query(
      `INSERT INTO brick_types (id, name, blocks_per_sqm, class_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO NOTHING`,
      [b.id, b.name, Number(b.blocksPerSqm) || 12.5, b.classId === undefined || b.classId === null ? null : Number(b.classId)]
    );
    n++;
  }
  console.log(`[migrate] brick_types: ${n} rows`);
  return n;
}

async function migrateRoles() {
  const roles = readJson('roles.json', []);
  let n = 0;
  for (const r of roles) {
    await pool.query(
      `INSERT INTO roles (id, name, locked, permissions)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO NOTHING`,
      [r.id, r.name, !!r.locked, JSON.stringify(r.permissions || {})]
    );
    n++;
  }
  console.log(`[migrate] roles: ${n} rows`);
  return n;
}

async function migrateUsers() {
  const users = readJson('users.json', []);
  let n = 0;
  for (const u of users) {
    await pool.query(
      `INSERT INTO users (id, name, email, username, password, role)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.name, u.email || '', u.username, u.password, u.role]
    );
    n++;
  }
  console.log(`[migrate] users: ${n} rows`);
  return n;
}

async function migrateWorkers() {
  const workers = readJson('workers.json', []);
  let n = 0;
  for (const w of workers) {
    await pool.query(
      `INSERT INTO workers (id, name, role)
       VALUES ($1,$2,$3)
       ON CONFLICT (id) DO NOTHING`,
      [w.id, w.name, w.role || '']
    );
    n++;
  }
  console.log(`[migrate] workers: ${n} rows`);
  return n;
}

async function migrateTasks() {
  const tasks = readJson('tasks.json', []);
  let n = 0;
  for (const t of tasks) {
    const extra = {};
    Object.keys(t).forEach((k) => { if (!TASK_KNOWN_KEYS.has(k)) extra[k] = t[k]; });
    await pool.query(
      `INSERT INTO tasks (
         id, name, zone, brick_type, status, workers, area, expected_area, blocks,
         people_detected, camera_status, last_update, confidence, snapshot_interval,
         camera_id, schedule, roi, progress_series, created_at, timelapse_status, extra
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (id) DO NOTHING`,
      [
        t.id, t.name, t.zone || '', t.brickType || null, t.status || 'pause',
        JSON.stringify(Array.isArray(t.workers) ? t.workers : []),
        Number(t.area) || 0, Number(t.expectedArea) || 100, Number(t.blocks) || 0,
        t.peopleDetected === undefined ? null : Number(t.peopleDetected),
        t.cameraStatus || 'disconnect', t.lastUpdate || '', Number(t.confidence) || 75,
        Number(t.snapshotInterval) || 30, t.cameraId || null,
        JSON.stringify(t.schedule || {}), JSON.stringify(Array.isArray(t.roi) ? t.roi : []),
        JSON.stringify(Array.isArray(t.progressSeries) ? t.progressSeries : []),
        t.createdAt || null, t.timelapseStatus || null, JSON.stringify(extra),
      ]
    );
    n++;
  }
  console.log(`[migrate] tasks: ${n} rows`);
  return n;
}

async function migrateTaskHistory() {
  const history = readJson('taskHistory.json', {});
  let n = 0;
  for (const taskId of Object.keys(history)) {
    const entries = history[taskId] || [];
    for (const e of entries) {
      await pool.query(
        `INSERT INTO task_history (task_id, at, blocks, area, people_detected, workers_assigned, snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [taskId, e.at, Number(e.blocks) || 0, Number(e.area) || 0,
         Number(e.peopleDetected) || 0, Number(e.workersAssigned) || 0, e.snapshot || null]
      );
      n++;
    }
  }
  console.log(`[migrate] task_history: ${n} rows`);
  return n;
}

async function migrateAlertConfig() {
  const cfg = readJson('alertConfig.json', null);
  if (!cfg) { console.log('[migrate] alert_config: 0 rows (no file)'); return 0; }
  await pool.query(
    `INSERT INTO alert_config (id, webhook, camera_offline, server_offline, ai_stopped, internet_down, no_image)
     VALUES (1,$1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET
       webhook=EXCLUDED.webhook, camera_offline=EXCLUDED.camera_offline,
       server_offline=EXCLUDED.server_offline, ai_stopped=EXCLUDED.ai_stopped,
       internet_down=EXCLUDED.internet_down, no_image=EXCLUDED.no_image`,
    [cfg.webhook || '', !!cfg.cameraOffline, !!cfg.serverOffline, !!cfg.aiStopped, !!cfg.internetDown, !!cfg.noImage]
  );
  console.log('[migrate] alert_config: 1 row');
  return 1;
}

async function migrateStorageConfig() {
  const cfg = readJson('storageConfig.json', null);
  if (!cfg) { console.log('[migrate] storage_config: 0 rows (no file)'); return 0; }
  await pool.query(
    `INSERT INTO storage_config (id, auto_delete, retention_days)
     VALUES (1,$1,$2)
     ON CONFLICT (id) DO UPDATE SET
       auto_delete=EXCLUDED.auto_delete, retention_days=EXCLUDED.retention_days`,
    [!!cfg.autoDelete, Number(cfg.retentionDays) || 60]
  );
  console.log('[migrate] storage_config: 1 row');
  return 1;
}

async function main() {
  console.log(`[migrate] reading JSON data from: ${DATA_DIR}`);
  const counts = {};
  // Order matters: brick_types/cameras/workers/roles have no FK dependents here,
  // but tasks must exist before task_history (FK task_history.task_id -> tasks.id).
  counts.cameras = await migrateCameras();
  counts.brick_types = await migrateBrickTypes();
  counts.roles = await migrateRoles();
  counts.users = await migrateUsers();
  counts.workers = await migrateWorkers();
  counts.tasks = await migrateTasks();
  counts.task_history = await migrateTaskHistory();
  counts.alert_config = await migrateAlertConfig();
  counts.storage_config = await migrateStorageConfig();
  console.log('[migrate] done:', counts);
  await pool.end();
}

main().catch((err) => {
  console.error('[migrate] FAILED', err);
  process.exit(1);
});
