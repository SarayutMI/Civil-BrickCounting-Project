-- When the image saved in this history row actually arrived (tasks.last_image_at at save time).
-- History rows are written once a minute even if the camera sent nothing new (the last frame is
-- re-saved), so "time spent" is measured from these image timestamps, not from row times.
-- NULL for rows saved before this column existed (their `at` is used instead).
ALTER TABLE task_history ADD COLUMN IF NOT EXISTS image_at TIMESTAMPTZ;
