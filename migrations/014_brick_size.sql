-- Brick size, so the area one brick covers in the wall is computed instead of typed in:
--   blocks_per_sqm (m² per brick, legacy name) = length × height of the wall face (cm → m²).
-- NULL size = keep the value that was entered by hand.
ALTER TABLE brick_types ADD COLUMN IF NOT EXISTS size_length_cm DOUBLE PRECISION;
ALTER TABLE brick_types ADD COLUMN IF NOT EXISTS size_height_cm DOUBLE PRECISION;
ALTER TABLE brick_types ADD COLUMN IF NOT EXISTS size_thickness_cm DOUBLE PRECISION;
