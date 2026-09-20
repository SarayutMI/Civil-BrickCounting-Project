/**
 * CIVIL — server-side sessions, route permissions and login throttling.
 *
 * The browser holds only an HttpOnly cookie carrying a random token; the SHA-256 of that token
 * is the primary key of the `sessions` table. A cookie (not an Authorization header) is used on
 * purpose: <img src="/api/cameras/:id/stream"> and <a href="…/timelapse"> cannot send headers
 * but do send cookies, so live views and downloads are protected without touching those handlers.
 */
const crypto = require('crypto');

const COOKIE_NAME = 'civil_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SLIDE_AFTER_MS = 60 * 60 * 1000; // extend expiry at most once an hour
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function isHttps(req) {
  return req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function cookieString(req, token, maxAgeMs) {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (isHttps(req)) flags.push('Secure');
  return `${COOKIE_NAME}=${token}; ${flags.join('; ')}`;
}

// Which role-permission page key guards a request. null = any signed-in user may call it.
// Reads are open to every signed-in user (dashboards need cameras/tasks/etc.); writes are gated.
function requiredPermission(method, path) {
  const write = method !== 'GET' && method !== 'HEAD';
  if (/^\/api\/(users|alertconfig|alerts|storage)(\/|$)/.test(path)) return 'settings'; // incl. reads
  if (/^\/api\/(test-rtsp)$/.test(path)) return 'settings';
  if (/^\/api\/logs$/.test(path)) return 'logs';
  if (/^\/api\/logs$/.test(path)) return 'logs';
  if (!write) return null;
  if (/^\/api\/(roles|bricktypes|workers)(\/|$)/.test(path)) return 'settings';
  if (/^\/api\/cameras\/[^/]+\/view$/.test(path)) return 'task'; // per-camera image orientation is set from Task Detail
  if (/^\/api\/cameras(\/|$)/.test(path)) return 'settings';
  if (/^\/api\/tasks(\/|$)/.test(path)) return 'task';
  return null;
}

function createAuth({ pool, getUsers, getRoles }) {
  const fails = new Map(); // "ip|username" -> { n, until }

  async function createSession(req, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5)`,
      [hashToken(token), userId, new Date(Date.now() + SESSION_TTL_MS), req.ip || null, String(req.headers['user-agent'] || '').slice(0, 300)]
    );
    return token;
  }

  async function sessionUser(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) return null;
    const h = hashToken(token);
    const { rows } = await pool.query('SELECT user_id, expires_at FROM sessions WHERE token_hash=$1', [h]);
    if (!rows.length) return null;
    const exp = rows[0].expires_at.getTime();
    if (exp < Date.now()) {
      pool.query('DELETE FROM sessions WHERE token_hash=$1', [h]).catch(() => {});
      return null;
    }
    if (exp - Date.now() < SESSION_TTL_MS - SLIDE_AFTER_MS) {
      pool.query('UPDATE sessions SET expires_at=$2 WHERE token_hash=$1', [h, new Date(Date.now() + SESSION_TTL_MS)]).catch(() => {});
    }
    return getUsers().find((u) => u.id === rows[0].user_id) || null;
  }

  function can(user, key) {
    const role = getRoles().find((r) => r.name.toLowerCase() === String(user.role).toLowerCase());
    return !!(role && role.permissions && role.permissions[key]);
  }

  // Mount on '/api' (and other protected paths). Skips login + health.
  async function requireAuth(req, res, next) {
    const p = req.originalUrl.split('?')[0];
    if (p === '/api/login' || p === '/api/health') return next();
    try {
      const user = await sessionUser(req);
      if (!user) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
      const need = requiredPermission(req.method, p);
      if (need && !can(user, need)) {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ใช้งานส่วนนี้' });
      }
      req.user = user;
      next();
    } catch (err) {
      console.error('[auth]', err.message);
      res.status(500).json({ success: false, message: 'ตรวจสอบสิทธิ์ไม่สำเร็จ' });
    }
  }

  function throttleKey(req, username) {
    return `${req.ip}|${String(username).trim().toLowerCase()}`;
  }
  function lockedFor(req, username) {
    const f = fails.get(throttleKey(req, username));
    return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
  }
  function recordFail(req, username) {
    const k = throttleKey(req, username);
    const f = fails.get(k) || { n: 0, until: 0 };
    f.n += 1;
    if (f.n >= MAX_FAILS) { f.until = Date.now() + LOCK_MS; f.n = 0; }
    fails.set(k, f);
  }
  const clearFails = (req, username) => fails.delete(throttleKey(req, username));

  const destroySession = (req) => {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    return token ? pool.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(token)]) : Promise.resolve();
  };
  const destroyUserSessions = (userId) => pool.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
  const sweepExpired = () => pool.query('DELETE FROM sessions WHERE expires_at < now()');

  return {
    requireAuth, createSession, destroySession, destroyUserSessions, sweepExpired,
    lockedFor, recordFail, clearFails,
    setCookie: (req, res, token) => res.setHeader('Set-Cookie', cookieString(req, token, SESSION_TTL_MS)),
    clearCookie: (req, res) => res.setHeader('Set-Cookie', cookieString(req, '', 0)),
  };
}

module.exports = { createAuth, requiredPermission };
