-- Frames a user took out of the count from the Label review page (camera being moved, view blocked,
-- broken image ...). The row and its image stay — the frame can be restored — but every count reads
-- only rows with excluded_at IS NULL: history / charts, productivity (Q and T), reports, label summary,
-- time-lapse, and the task's current numbers (latest counted frame).
ALTER TABLE task_history ADD COLUMN IF NOT EXISTS excluded_at TIMESTAMPTZ;
ALTER TABLE task_history ADD COLUMN IF NOT EXISTS excluded_by TEXT;
ALTER TABLE task_history ADD COLUMN IF NOT EXISTS excluded_reason TEXT;
