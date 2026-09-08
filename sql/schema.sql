-- CIVIL — PostgreSQL schema
-- Replaces the flat JSON files (cameras.json, tasks.json, brickTypes.json, users.json,
-- roles.json, workers.json, taskHistory.json, alertConfig.json, storageConfig.json).
--
-- Design notes:
--  * IDs are kept as TEXT because the app already mints its own ids (e.g. "t1", "bt2",
--    crypto.randomUUID() strings, "u"+8hex, "w"+8hex) — no surrogate integer PKs.
--  * schedule / roi / progressSeries / permissions are JSONB — they are read/written as
--    whole blobs by the app and never queried relationally, so normalizing them further
--    would add complexity with no benefit (per the brief).
--  * `extra` JSONB catch-all columns on cameras/tasks absorb any stray/legacy fields that
--    exist in the live JSON data but aren't part of the documented schema (e.g. a leftover
--    `lastAutoDetectAt` on one task) — keeps GET responses byte-identical after migration
--    without hand-modeling dead fields.
--  * Numeric fields that are read back into JSON as JS numbers (area, confidence, etc.)
--    use DOUBLE PRECISION rather than NUMERIC — node-postgres returns NUMERIC as a string
--    to avoid precision loss, which would silently change response payload types.
--  * task_history has no cap (unlike the JSON version's 2000-entries-per-task trim) — it's
--    expected to grow continuously per the brief; an index on (task_id, at) keeps the
--    from/to/limit history query fast regardless of table size.

CREATE TABLE IF NOT EXISTS cameras (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  url            TEXT NOT NULL,
  zone           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'unknown',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_tested_at TIMESTAMPTZ,
  extra          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS brick_types (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  blocks_per_sqm  DOUBLE PRECISION NOT NULL,
  class_id        INTEGER
);

CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  locked      BOOLEAN NOT NULL DEFAULT false,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS users (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  email    TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL, -- plaintext by design (documented mockup limitation carried over as-is)
  role     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workers (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tasks (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  zone             TEXT NOT NULL DEFAULT '',
  brick_type       TEXT,                 -- no FK: original app never enforced/cascaded this either
  status           TEXT NOT NULL DEFAULT 'pause',
  workers          JSONB NOT NULL DEFAULT '[]'::jsonb,   -- array of worker ids
  area             DOUBLE PRECISION NOT NULL DEFAULT 0,
  expected_area    DOUBLE PRECISION NOT NULL DEFAULT 100,
  blocks           INTEGER NOT NULL DEFAULT 0,
  people_detected  INTEGER,              -- nullable: absent key in JSON == NULL here (legacy demo tasks)
  camera_status    TEXT NOT NULL DEFAULT 'disconnect',
  last_update      TEXT NOT NULL DEFAULT '',
  confidence       DOUBLE PRECISION NOT NULL DEFAULT 75,
  snapshot_interval INTEGER NOT NULL DEFAULT 30,
  camera_id        TEXT,                 -- no FK: same as brick_type above
  schedule         JSONB NOT NULL DEFAULT '{}'::jsonb,
  roi              JSONB NOT NULL DEFAULT '[]'::jsonb,
  progress_series  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ,          -- nullable: legacy demo tasks never had createdAt
  timelapse_status TEXT,
  extra            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS task_history (
  id               BIGSERIAL PRIMARY KEY,
  task_id          TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  at               TIMESTAMPTZ NOT NULL,
  blocks           INTEGER NOT NULL,
  area             DOUBLE PRECISION NOT NULL,
  people_detected  INTEGER NOT NULL DEFAULT 0,
  workers_assigned INTEGER NOT NULL DEFAULT 0,
  snapshot         TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_history_task_at ON task_history (task_id, at);

CREATE TABLE IF NOT EXISTS alert_config (
  id             SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- single-row config table
  webhook        TEXT NOT NULL DEFAULT '',
  camera_offline BOOLEAN NOT NULL DEFAULT true,
  server_offline BOOLEAN NOT NULL DEFAULT true,
  ai_stopped     BOOLEAN NOT NULL DEFAULT true,
  internet_down  BOOLEAN NOT NULL DEFAULT false,
  no_image       BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS storage_config (
  id             SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- single-row config table
  auto_delete    BOOLEAN NOT NULL DEFAULT true,
  retention_days INTEGER NOT NULL DEFAULT 60
);
