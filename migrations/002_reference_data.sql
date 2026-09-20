-- Structural reference data the app cannot run without. No demo tasks / users / workers /
-- brick types are seeded here — those are created by the operator through the UI or
-- scripts/seed-users.js. Every statement is idempotent and never overwrites edited rows.

-- Fixed roles (Admin / Engineer / Viewer). Permissions are editable afterwards in Settings.
INSERT INTO roles (id, name, locked, permissions) VALUES
  ('admin',    'Admin',    true, '{"home":true,"task":true,"dashboard":true,"reports":true,"logs":true,"settings":true}'),
  ('engineer', 'Engineer', true, '{"home":true,"task":true,"dashboard":true,"reports":true,"logs":true,"settings":false}'),
  ('viewer',   'Viewer',   true, '{"home":true,"task":false,"dashboard":true,"reports":true,"logs":false,"settings":false}')
ON CONFLICT (id) DO NOTHING;

-- Single-row config tables: column DEFAULTs in 001 supply the values.
INSERT INTO alert_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
