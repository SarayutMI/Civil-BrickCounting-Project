-- Device Monitor: the last telemetry each ESP32 bridge reported (one row per FTP camera it serves),
-- kept so the page still shows the last known state after a server restart.
CREATE TABLE IF NOT EXISTS device_status (
  camera_id  TEXT PRIMARY KEY REFERENCES cameras(id) ON DELETE CASCADE,
  last_seen  TIMESTAMPTZ NOT NULL,
  remote_ip  TEXT,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- New "devices" menu: Admin and Engineer see it by default, Viewer does not (editable in Settings › Roles).
UPDATE roles SET permissions = permissions || '{"devices": true}'::jsonb
 WHERE id IN ('admin', 'engineer') AND NOT (permissions ? 'devices');
UPDATE roles SET permissions = permissions || '{"devices": false}'::jsonb
 WHERE id = 'viewer' AND NOT (permissions ? 'devices');
