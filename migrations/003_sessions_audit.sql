-- Server-side login sessions (replaces the user object the browser used to keep in localStorage).
-- Only a SHA-256 hash of the token is stored, so a DB leak does not leak live sessions.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- Real system log shown on the Logs page (replaces the hard-coded MOCK_LOGS in Logs.jsx).
CREATE TABLE IF NOT EXISTS audit_logs (
  id      BIGSERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  type    TEXT NOT NULL,                 -- camera | task | snapshot | error | edit | auth
  level   TEXT NOT NULL DEFAULT 'info',  -- info | warn | error
  message TEXT NOT NULL,
  actor   TEXT                           -- username, or NULL for system-generated events
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_at ON audit_logs (at DESC);
