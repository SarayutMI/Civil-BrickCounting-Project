-- Human-in-the-loop now labels people too: reviewers can remove AI person boxes and draw missed
-- people. corrected_people = people in the ROI after the review (NULL = frame not reviewed).
ALTER TABLE task_history ADD COLUMN IF NOT EXISTS corrected_people INTEGER;
