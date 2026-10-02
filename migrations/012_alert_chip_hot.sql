-- Discord alert when an ESP32's chip temperature (internal sensor, sent in its heartbeat) gets too hot.
ALTER TABLE alert_config ADD COLUMN IF NOT EXISTS chip_hot BOOLEAN NOT NULL DEFAULT true;
