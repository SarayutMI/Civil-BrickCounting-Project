-- Human-in-the-loop review of a saved frame (Task › ตรวจแก้ Label):
--   human_labels     { added: [{x1,y1,x2,y2}] (0..1 of the frame), removed: [index into detections.detections],
--                      note, by, at }
--   corrected_blocks the brick count after the review (AI boxes in the ROI − removed + added in the ROI),
--                    computed by the server (humanLabels.js). NULL = frame not reviewed.
ALTER TABLE task_history ADD COLUMN IF NOT EXISTS human_labels JSONB;
ALTER TABLE task_history ADD COLUMN IF NOT EXISTS corrected_blocks INTEGER;
