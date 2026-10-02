-- AI boxes for the exact frame saved in task_history.snapshot, so the Timeline can show the
-- labelled image next to the raw one. NULL for rows saved before this column existed, or when the
-- saved frame had no finished detection yet.
-- Shape: { image_width, image_height, roi: [[x,y]...] (0..1), detections: [{x1,y1,x2,y2,conf,in_roi}],
--          personDetections: [{x1,y1,x2,y2,conf,in_roi}] }  (box coordinates in image pixels)
ALTER TABLE task_history ADD COLUMN IF NOT EXISTS detections JSONB;
