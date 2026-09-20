-- When the last image for a running task arrived (persisted so a restart does not forget it).
-- Used by the "Loss data" watcher: no image for longer than the limit -> task shows Loss data.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_image_at TIMESTAMPTZ;
