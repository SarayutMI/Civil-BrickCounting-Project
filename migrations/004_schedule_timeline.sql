-- Auto start/pause by working hours: the phase (work | break | off) the scheduler last applied.
-- Edge-triggered, so a manual pause/start inside a phase is kept until the next boundary.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS auto_phase TEXT;

-- Per-minute timeline rows carry the task's status and progress at that minute, so the Reports
-- slider can show image + numbers + progress for the exact moment.
ALTER TABLE task_history ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE task_history ADD COLUMN IF NOT EXISTS progress_pct DOUBLE PRECISION;
