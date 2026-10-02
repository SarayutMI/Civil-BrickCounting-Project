-- Standard labour productivity for each brick type (ตร.ม. / คน-วัน). Reports compare the actual
-- productivity P = Q / (N × T) against it (see productivity.js). NULL = not set yet.
ALTER TABLE brick_types ADD COLUMN IF NOT EXISTS standard_productivity DOUBLE PRECISION;
