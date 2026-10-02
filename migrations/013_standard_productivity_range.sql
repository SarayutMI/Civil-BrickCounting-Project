-- Standard labour productivity as a range (ตร.ม. / คน-วัน), as published in productivity tables
-- (e.g. ก่ออิฐมอญครึ่งแผ่น 8–12, ก่ออิฐบล็อก / อิฐมวลเบา 20–25, 1 ช่าง ไม่มีผู้ช่วยผสมปูน).
-- standard_productivity stays the single value used in the formulas: the middle of the range.
ALTER TABLE brick_types ADD COLUMN IF NOT EXISTS standard_productivity_min DOUBLE PRECISION;
ALTER TABLE brick_types ADD COLUMN IF NOT EXISTS standard_productivity_max DOUBLE PRECISION;

-- Seed the project's reference values (report table 2.2) for brick types that have no standard yet.
UPDATE brick_types SET standard_productivity_min = 8, standard_productivity_max = 12, standard_productivity = 10
 WHERE name LIKE '%มอญ%' AND standard_productivity IS NULL AND standard_productivity_min IS NULL;
UPDATE brick_types SET standard_productivity_min = 20, standard_productivity_max = 25, standard_productivity = 22.5
 WHERE (name LIKE '%บล็อก%' OR name LIKE '%มวลเบา%') AND standard_productivity IS NULL AND standard_productivity_min IS NULL;
