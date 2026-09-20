/**
 * CIVIL — AI Brick Construction Monitoring
 * Full backend server
 *
 * ทำไมต้องมี backend:
 * เบราว์เซอร์เชื่อมต่อ RTSP โดยตรงไม่ได้ (ไม่ใช่โปรโตคอลของเว็บ) จึงให้ backend นี้
 * เป็นตัวกลางที่คุยกับกล้อง RTSP จริงแทน แล้วส่งผลลัพธ์/ภาพกลับมาที่หน้าเว็บผ่าน HTTP
 *
 * FEATURES:
 * 1) CRUD กล้อง (เพิ่ม/แก้ไข/ลบ/เลือก) — เก็บลง PostgreSQL (persist ข้ามการรีสตาร์ท)
 * 2) ทดสอบการเชื่อมต่อ RTSP จริงด้วย ffprobe (เหมือนเดิม)
 * 3) ดึงภาพนิ่ง (snapshot) จากกล้องจริงด้วย ffmpeg
 * 4) สตรีมภาพสด (MJPEG) จากกล้องจริงด้วย ffmpeg -f mpjpeg แล้วฝังใน <img> ได้ตรง ๆ
 *
 * PERSISTENCE:
 * เดิมระบบนี้เก็บทุกอย่างเป็นไฟล์ JSON แบนบนดิสก์ (cameras.json, tasks.json, ...)
 * ตอนนี้ย้ายมาใช้ PostgreSQL แล้ว (ดู db.js + migrations/*.sql ที่รันเองตอน boot) แต่ยังคง
 * เก็บ cache ในหน่วยความจำ (in-memory array) ไว้เหมือนเดิม เพราะโค้ดหลายจุด (auto-detect
 * loop ทุก 1 วิ, task-history snapshot ทุก 1 นาที, ฟังก์ชัน find*) เข้าถึงข้อมูลแบบ sync
 * บ่อยมาก — สถาปัตยกรรมตอนนี้คือ "cache-aside": โหลดจาก Postgres เข้า cache ตอน startup,
 * ทุกการเขียน (create/update/delete) เขียนลง Postgres ทันที (await) แล้วอัปเดต cache ให้
 * ตรงกันในตัว เพราะมี Node process เดียวที่เป็นคนเขียน จึง cache ไม่มีวันเพี้ยนจาก DB จริง
 * ส่วน response shape ของทุก endpoint ยังคงเดิมทุกประการ — เปลี่ยนแค่ฝั่ง storage เท่านั้น
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { pool } = require('./db');
const { runMigrations } = require('./migrations');
const { createAuth } = require('./auth');
const schedule = require('./schedule');
const imageView = require('./imageView');
const { buildTimelapse, FRAME_RE } = require('./timelapse');

const app = express();
const PORT = process.env.PORT || 3000;
const BACKUPS_DIR = path.join(__dirname, 'backups');
// ที่อยู่ของ Python microservice ที่รัน YOLOv11 (ดู yolo_service.py)
const YOLO_SERVICE_URL = process.env.YOLO_SERVICE_URL || 'http://127.0.0.1:8000';
// ความมั่นใจ (confidence) ของโมเดลตรวจจับคน — แยกจาก confidence ของโมเดลอิฐที่ตั้งต่อ Task
const PERSON_DETECT_CONFIDENCE = Number(process.env.PERSON_DETECT_CONFIDENCE) || 0.5;
// โฟลเดอร์เก็บภาพ snapshot ที่บันทึกทุก 1 นาทีต่อ Task (ดู appendTaskHistorySnapshot) — ใช้ต่อไทม์แลปส์ตอนงานเสร็จ
const SNAPSHOTS_DIR = path.join(__dirname, 'snapshots');
if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

app.set('trust proxy', 'loopback'); // อยู่หลัง nginx/Caddy บนเครื่องเดียวกัน — ให้ req.ip / req.secure ถูกต้อง
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client', 'dist'))); // serve the built React SPA (client/dist)

// state ทั้งหมดอยู่ใน Postgres — ตัวแปร cameras/users/roles ด้านล่างเป็นแค่ cache ที่ auth อ่านผ่าน getter
const auth = createAuth({ pool, getUsers: () => users, getRoles: () => roles });
app.use('/api', auth.requireAuth); // ทุก endpoint ต้องมี session ยกเว้น /api/login และ /api/health
app.use('/snapshots', auth.requireAuth, express.static(SNAPSHOTS_DIR));

/* =========================================================
   AUDIT LOG (table: audit_logs) — หน้า Logs อ่านจากตารางนี้ ไม่ใช่ข้อมูลจำลอง
========================================================= */
function audit(type, level, message, actor) {
  pool.query('INSERT INTO audit_logs (type, level, message, actor) VALUES ($1,$2,$3,$4)', [type, level, message, actor || null])
    .catch((err) => console.error('[audit] insert failed:', err.message));
}
app.get('/api/logs', async (req, res) => {
  const n = Math.min(Number(req.query.limit) || 500, 2000);
  try {
    const { rows } = await pool.query('SELECT at, type, level, message, actor FROM audit_logs ORDER BY at DESC LIMIT $1', [n]);
    res.json(rows.map((r) => ({ time: r.at.toISOString(), type: r.type, level: r.level, message: r.message, actor: r.actor })));
  } catch (err) {
    res.status(500).json({ success: false, message: 'ดึง Log ไม่สำเร็จ', raw: err.message });
  }
});

/* =========================================================
   PERSISTENCE — cameras (table: cameras)
========================================================= */
function cameraRowToObj(row) {
  const obj = {
    id: row.id, name: row.name, url: row.url, zone: row.zone, status: row.status,
    createdAt: row.created_at ? row.created_at.toISOString() : undefined,
  };
  if (row.last_tested_at) obj.lastTestedAt = row.last_tested_at.toISOString();
  return { ...obj, ...(row.extra || {}) };
}
async function loadCamerasFromDB() {
  const { rows } = await pool.query('SELECT * FROM cameras ORDER BY created_at NULLS LAST');
  return rows.map(cameraRowToObj);
}
async function upsertCameraRow(cam) {
  const { id, name, url, zone, status, createdAt, lastTestedAt, ...extra } = cam;
  await pool.query(
    `INSERT INTO cameras (id, name, url, zone, status, created_at, last_tested_at, extra)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name, url=EXCLUDED.url, zone=EXCLUDED.zone, status=EXCLUDED.status,
       created_at=EXCLUDED.created_at, last_tested_at=EXCLUDED.last_tested_at, extra=EXCLUDED.extra`,
    [id, name, url, zone || '', status || 'unknown', createdAt || null, lastTestedAt || null, JSON.stringify(extra)]
  );
}
async function deleteCameraRow(id) {
  await pool.query('DELETE FROM cameras WHERE id=$1', [id]);
}
let cameras = [];

/* =========================================================
   PERSISTENCE — tasks (table: tasks)
========================================================= */
const TASK_KNOWN_KEYS = new Set([
  'id', 'name', 'zone', 'brickType', 'status', 'workers', 'area', 'expectedArea',
  'blocks', 'peopleDetected', 'cameraStatus', 'lastUpdate', 'confidence',
  'snapshotInterval', 'cameraId', 'schedule', 'roi', 'progressSeries',
  'createdAt', 'timelapseStatus', 'autoPhase', 'lastImageAt',
]);
function taskRowToObj(row) {
  const obj = {
    id: row.id, name: row.name, zone: row.zone, brickType: row.brick_type, status: row.status,
    workers: row.workers || [], area: Number(row.area), expectedArea: Number(row.expected_area),
    blocks: row.blocks, cameraStatus: row.camera_status, lastUpdate: row.last_update,
    confidence: Number(row.confidence), snapshotInterval: row.snapshot_interval, cameraId: row.camera_id,
    schedule: row.schedule || {}, roi: row.roi || [], progressSeries: row.progress_series || [],
  };
  // ฟิลด์ที่ absent ในไฟล์ JSON เดิม (legacy demo task) ต้อง absent ใน object ด้วย ไม่ใช่ null/0 —
  // ให้ response ตรงกับพฤติกรรมเดิม 100% (key หาย vs key เป็น null คนละความหมายกันใน JSON)
  if (row.people_detected !== null && row.people_detected !== undefined) obj.peopleDetected = row.people_detected;
  if (row.created_at) obj.createdAt = row.created_at.toISOString();
  if (row.timelapse_status) obj.timelapseStatus = row.timelapse_status;
  if (row.auto_phase) obj.autoPhase = row.auto_phase;
  if (row.last_image_at) obj.lastImageAt = row.last_image_at.toISOString();
  return { ...obj, ...(row.extra || {}) };
}
async function loadTasksFromDB() {
  const { rows } = await pool.query('SELECT * FROM tasks ORDER BY id');
  return rows.map(taskRowToObj);
}
async function upsertTaskRow(t) {
  const extra = {};
  Object.keys(t).forEach((k) => { if (!TASK_KNOWN_KEYS.has(k)) extra[k] = t[k]; });
  await pool.query(
    `INSERT INTO tasks (
       id, name, zone, brick_type, status, workers, area, expected_area, blocks,
       people_detected, camera_status, last_update, confidence, snapshot_interval,
       camera_id, schedule, roi, progress_series, created_at, timelapse_status, extra, auto_phase, last_image_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name, zone=EXCLUDED.zone, brick_type=EXCLUDED.brick_type, status=EXCLUDED.status,
       workers=EXCLUDED.workers, area=EXCLUDED.area, expected_area=EXCLUDED.expected_area,
       blocks=EXCLUDED.blocks, people_detected=EXCLUDED.people_detected, camera_status=EXCLUDED.camera_status,
       last_update=EXCLUDED.last_update, confidence=EXCLUDED.confidence, snapshot_interval=EXCLUDED.snapshot_interval,
       camera_id=EXCLUDED.camera_id, schedule=EXCLUDED.schedule, roi=EXCLUDED.roi,
       progress_series=EXCLUDED.progress_series, created_at=EXCLUDED.created_at,
       timelapse_status=EXCLUDED.timelapse_status, extra=EXCLUDED.extra, auto_phase=EXCLUDED.auto_phase,
       last_image_at=EXCLUDED.last_image_at`,
    [
      t.id, t.name, t.zone || '', t.brickType || null, t.status || 'pause',
      JSON.stringify(Array.isArray(t.workers) ? t.workers : []),
      Number(t.area) || 0, Number(t.expectedArea) || 100, Number(t.blocks) || 0,
      t.peopleDetected === undefined ? null : Number(t.peopleDetected),
      t.cameraStatus || 'disconnect', t.lastUpdate || '', Number(t.confidence) || 75,
      Number(t.snapshotInterval) || 30, t.cameraId || null,
      JSON.stringify(t.schedule || {}), JSON.stringify(Array.isArray(t.roi) ? t.roi : []),
      JSON.stringify(Array.isArray(t.progressSeries) ? t.progressSeries : []),
      t.createdAt || null, t.timelapseStatus || null, JSON.stringify(extra), t.autoPhase || null, t.lastImageAt || null,
    ]
  );
}
async function deleteTaskRow(id) {
  await pool.query('DELETE FROM tasks WHERE id=$1', [id]); // task_history rows cascade-delete via FK
}
let tasks = [];
function findTask(id) {
  return tasks.find((t) => t.id === id);
}

/* =========================================================
   PERSISTENCE — task_history (table: task_history)
   เก็บ snapshot ผลตรวจจับของแต่ละ Task ตามช่วงเวลา (blocks/area/จำนวนคนที่ตรวจพบ)
   เพื่อดูย้อนหลังได้ — แยกจาก lastDetections (in-memory, bbox ล่าสุดสำหรับวาด realtime เท่านั้น)
   หมายเหตุ: ตารางนี้ไม่มีการจำกัดจำนวนแถวต่อ Task เหมือนไฟล์ JSON เดิม (เดิมจำกัดไว้ 2000
   แถว/Task กันไฟล์บวม) — ปล่อยให้โตต่อเนื่องได้เพราะ Postgres รองรับ query แบบมี index ได้ดีกว่า
========================================================= */
const HISTORY_SNAPSHOT_INTERVAL_MS = 60 * 1000; // จดทุก 1 นาที ต่อ Task ที่กำลังทำงาน
const HISTORY_MAX_ENTRIES_PER_TASK = 2000; // ยังใช้จำกัดจำนวน "ไฟล์ภาพ" snapshot บนดิสก์ต่อ Task (ไม่ใช่แถวใน DB)

// ภาพ JPEG ล่าสุดที่ดึงมาระหว่างตรวจจับ (อัปเดตทุกรอบ auto-detect ~1 วิ) — เก็บไว้ในหน่วยความจำ
// เพื่อ "หยิบ" มาบันทึกลงดิสก์ทุก 1 นาทีใน appendTaskHistorySnapshot โดยไม่ต้องดึงภาพจากกล้องซ้ำอีกรอบ
const lastSnapshotBuffers = new Map(); // taskId -> Buffer (JPEG)

// ภาพล่าสุดที่กล้องโหมด FTP push เข้ามา (ไม่มี RTSP url ให้ ffmpeg ดึงสด) — เก็บไว้ให้
// /api/cameras/:id/snapshot เสิร์ฟเป็น "ภาพสดล่าสุด" ได้ทันทีที่ภาพเข้ามา ไม่ต้องรอ Task รัน
const lastFtpSnapshotByCamera = new Map(); // cameraId -> Buffer (JPEG)

async function insertTaskHistoryRow(taskId, entry) {
  await pool.query(
    `INSERT INTO task_history (task_id, at, blocks, area, people_detected, workers_assigned, snapshot, status, progress_pct)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [taskId, entry.at, entry.blocks, entry.area, entry.peopleDetected, entry.workersAssigned, entry.snapshot, entry.status, entry.progressPct]
  );
}
async function queryTaskHistory(taskId, { from, to, limit } = {}) {
  const clauses = ['task_id = $1'];
  const params = [taskId];
  if (from) { params.push(from); clauses.push(`at >= $${params.length}`); }
  if (to) { params.push(to); clauses.push(`at <= $${params.length}`); }
  const where = `WHERE ${clauses.join(' AND ')}`;
  const n = Number(limit);
  let rows;
  if (n > 0) {
    const res = await pool.query(
      `SELECT at, blocks, area, people_detected, workers_assigned, snapshot, status, progress_pct
       FROM task_history ${where} ORDER BY at DESC LIMIT $${params.length + 1}`,
      [...params, n]
    );
    rows = res.rows.reverse(); // กลับเป็นลำดับเวลาเก่า->ใหม่ เหมือน list.slice(-n) ของเดิม
  } else {
    const res = await pool.query(
      `SELECT at, blocks, area, people_detected, workers_assigned, snapshot, status, progress_pct
       FROM task_history ${where} ORDER BY at ASC`,
      params
    );
    rows = res.rows;
  }
  return rows.map((r) => ({
    at: r.at.toISOString(), blocks: r.blocks, area: r.area,
    peopleDetected: r.people_detected, workersAssigned: r.workers_assigned,
    snapshot: r.snapshot || null, status: r.status || null, progressPct: r.progress_pct,
  }));
}

async function appendTaskHistorySnapshot() {
  for (const t of tasks) {
    if (t.status !== 'running') continue;
    const at = new Date().toISOString();
    let snapshotUrl = null;

    const buf = lastSnapshotBuffers.get(t.id);
    if (buf) {
      const taskDir = path.join(SNAPSHOTS_DIR, t.id);
      if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });
      const filename = `${at.replace(/[:.]/g, '-')}.jpg`;
      fs.writeFileSync(path.join(taskDir, filename), buf);
      snapshotUrl = `/snapshots/${t.id}/${filename}`;
      // ลบไฟล์เก่าสุดถ้าเกินโควตา (ผูกกับ HISTORY_MAX_ENTRIES_PER_TASK) กันดิสก์บวมไม่จำกัด
      const files = fs.readdirSync(taskDir).filter((f) => FRAME_RE.test(f)).sort();
      const trimmed = [];
      while (files.length > HISTORY_MAX_ENTRIES_PER_TASK) {
        const old = files.shift();
        fs.unlinkSync(path.join(taskDir, old));
        trimmed.push(`/snapshots/${t.id}/${old}`);
      }
      forgetSnapshotRefs(trimmed);
    }

    try {
      await insertTaskHistoryRow(t.id, {
        at, blocks: t.blocks, area: t.area, peopleDetected: t.peopleDetected || 0,
        workersAssigned: t.workers.length, snapshot: snapshotUrl,
        status: t.status, progressPct: t.expectedArea ? Math.round((t.area / t.expectedArea) * 1000) / 10 : 0,
      });
    } catch (err) {
      console.error(`[history] insert failed for task ${t.id}:`, err.message);
    }
  }
}

/* =========================================================
   TIME-LAPSE — ต่อภาพ snapshot ทุกนาทีของ Task เป็นวิดีโอ (ffmpeg concat demuxer)
   สร้างอัตโนมัติเมื่อ Task ถูกตั้งสถานะเป็น "เสร็จสิ้น" (ดู PUT /api/tasks/:id)
========================================================= */
const timelapseBuilding = new Set(); // taskId ที่กำลังสร้างอยู่ — กันสั่งซ้อนแล้วเขียนไฟล์ชนกัน
// สร้าง MP4 + GIF (timelapse.js) แล้วอัปเดตสถานะใน DB: building -> ready | failed. คืน false ถ้ามีงานสร้างของ Task นี้ค้างอยู่
async function startTimelapseBuild(t, actor) {
  if (timelapseBuilding.has(t.id)) return false;
  timelapseBuilding.add(t.id);
  t.timelapseStatus = 'building';
  await upsertTaskRow(t).catch((err) => console.error('[task] persist timelapseStatus failed:', err.message));
  buildTimelapse(path.join(SNAPSHOTS_DIR, t.id))
    .then((r) => {
      t.timelapseStatus = 'ready';
      audit('snapshot', 'info', `สร้างไทม์แลปส์ Task "${t.name}" สำเร็จ (${r.frames} ภาพ)`, actor);
    })
    .catch((err) => {
      t.timelapseStatus = 'failed';
      audit('error', 'error', `สร้างไทม์แลปส์ Task "${t.name}" ไม่สำเร็จ: ${err.message}`, actor);
    })
    .finally(() => {
      timelapseBuilding.delete(t.id);
      upsertTaskRow(t).catch((e) => console.error('[task] persist timelapseStatus failed:', e.message));
    });
  return true;
}

/* =========================================================
   PERSISTENCE — brick_types (table: brick_types)
   blocksPerSqm = อิฐ/บล็อกกี่ก้อน เท่ากับพื้นที่ 1 ตารางเมตร (ผู้ใช้กำหนดเองผ่าน UI)
========================================================= */
function brickTypeRowToObj(row) {
  return { id: row.id, name: row.name, blocksPerSqm: Number(row.blocks_per_sqm), classId: row.class_id };
}
async function loadBrickTypesFromDB() {
  const { rows } = await pool.query('SELECT * FROM brick_types ORDER BY id');
  return rows.map(brickTypeRowToObj);
}
async function upsertBrickTypeRow(b) {
  await pool.query(
    `INSERT INTO brick_types (id, name, blocks_per_sqm, class_id) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, blocks_per_sqm=EXCLUDED.blocks_per_sqm, class_id=EXCLUDED.class_id`,
    [b.id, b.name, b.blocksPerSqm, b.classId === undefined || b.classId === null ? null : Number(b.classId)]
  );
}
async function deleteBrickTypeRow(id) {
  await pool.query('DELETE FROM brick_types WHERE id=$1', [id]);
}
let brickTypes = [];
function findBrickType(id) {
  return brickTypes.find((b) => b.id === id);
}

/* =========================================================
   PERSISTENCE — roles (table: roles) — สิทธิ์การเข้าถึงแต่ละเมนู/หน้า
   permissions: { home, task, dashboard, reports, logs, settings } -> true/false
========================================================= */
const PAGE_KEYS = ['home', 'task', 'dashboard', 'reports', 'logs', 'settings'];
function allPerms(value) {
  return PAGE_KEYS.reduce((acc, k) => ({ ...acc, [k]: value }), {});
}
const LOCKED_ROLE_IDS = new Set(['admin', 'engineer', 'viewer']);
function roleRowToObj(row) {
  return { id: row.id, name: row.name, permissions: row.permissions || {}, locked: LOCKED_ROLE_IDS.has(row.id) ? true : row.locked };
}
async function loadRolesFromDB() {
  const { rows } = await pool.query('SELECT * FROM roles ORDER BY id');
  return rows.map(roleRowToObj);
}
async function upsertRoleRow(r) {
  await pool.query(
    `INSERT INTO roles (id, name, locked, permissions) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, locked=EXCLUDED.locked, permissions=EXCLUDED.permissions`,
    [r.id, r.name, !!r.locked, JSON.stringify(r.permissions || {})]
  );
}
let roles = [];
function findRole(id) {
  return roles.find((r) => r.id === id);
}
function findRoleByName(name) {
  return roles.find((r) => r.name.toLowerCase() === String(name || '').toLowerCase());
}

/* =========================================================
   PERSISTENCE — users (table: users) — บัญชีผู้ใช้งาน + ใช้ login เข้าระบบ
   รหัสผ่านเก็บเป็น bcrypt hash เท่านั้น (hash ทุกครั้งก่อนเขียนลง DB) — ไม่มีบัญชี/รหัสตั้งต้นในโค้ด
   สร้างบัญชีแรกด้วย scripts/seed-users.js
========================================================= */
function userRowToObj(row) {
  return { id: row.id, name: row.name, email: row.email, username: row.username, password: row.password, role: row.role };
}
async function loadUsersFromDB() {
  const { rows } = await pool.query('SELECT * FROM users ORDER BY id');
  return rows.map(userRowToObj);
}
async function upsertUserRow(u) {
  await pool.query(
    `INSERT INTO users (id, name, email, username, password, role) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email, username=EXCLUDED.username,
       password=EXCLUDED.password, role=EXCLUDED.role`,
    [u.id, u.name, u.email || '', u.username, u.password, u.role]
  );
}
async function deleteUserRow(id) {
  await pool.query('DELETE FROM users WHERE id=$1', [id]);
}
let users = [];
function findUser(id) {
  return users.find((u) => u.id === id);
}
function publicUser(u) {
  const { password, ...pub } = u;
  return pub;
}
/* =========================================================
   PERSISTENCE — workers (table: workers) — แรงงาน master list
========================================================= */
function workerRowToObj(row) {
  return { id: row.id, name: row.name, role: row.role };
}
async function loadWorkersFromDB() {
  const { rows } = await pool.query('SELECT * FROM workers ORDER BY id');
  return rows.map(workerRowToObj);
}
async function upsertWorkerRow(w) {
  await pool.query(
    `INSERT INTO workers (id, name, role) VALUES ($1,$2,$3)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role`,
    [w.id, w.name, w.role || '']
  );
}
async function deleteWorkerRow(id) {
  await pool.query('DELETE FROM workers WHERE id=$1', [id]);
}
let workersMaster = [];

/* =========================================================
   PERSISTENCE — alert_config (table: alert_config, single row) — Discord webhook + สวิตช์แจ้งเตือน
========================================================= */
function alertConfigRowToObj(row) {
  return {
    webhook: row.webhook, cameraOffline: row.camera_offline, serverOffline: row.server_offline,
    aiStopped: row.ai_stopped, internetDown: row.internet_down, noImage: row.no_image,
  };
}
async function loadAlertConfigFromDB() {
  const { rows } = await pool.query('SELECT * FROM alert_config WHERE id=1');
  if (rows.length === 0) throw new Error('alert_config row missing — run migrations');
  return alertConfigRowToObj(rows[0]);
}
async function saveAlertConfigDB(cfg) {
  await pool.query(
    `INSERT INTO alert_config (id, webhook, camera_offline, server_offline, ai_stopped, internet_down, no_image)
     VALUES (1,$1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET webhook=EXCLUDED.webhook, camera_offline=EXCLUDED.camera_offline,
       server_offline=EXCLUDED.server_offline, ai_stopped=EXCLUDED.ai_stopped,
       internet_down=EXCLUDED.internet_down, no_image=EXCLUDED.no_image`,
    [cfg.webhook || '', !!cfg.cameraOffline, !!cfg.serverOffline, !!cfg.aiStopped, !!cfg.internetDown, !!cfg.noImage]
  );
}
let alertConfig = {};

/* =========================================================
   PERSISTENCE — storage_config (table: storage_config, single row) — autoDelete / retentionDays
========================================================= */
function storageConfigRowToObj(row) {
  return { autoDelete: row.auto_delete, retentionDays: row.retention_days };
}
async function loadStorageConfigFromDB() {
  const { rows } = await pool.query('SELECT * FROM storage_config WHERE id=1');
  if (rows.length === 0) throw new Error('storage_config row missing — run migrations');
  return storageConfigRowToObj(rows[0]);
}
async function saveStorageConfigDB(cfg) {
  await pool.query(
    `INSERT INTO storage_config (id, auto_delete, retention_days) VALUES (1,$1,$2)
     ON CONFLICT (id) DO UPDATE SET auto_delete=EXCLUDED.auto_delete, retention_days=EXCLUDED.retention_days`,
    [!!cfg.autoDelete, Number(cfg.retentionDays) || 60]
  );
}
let storageConfig = {};

/* =========================================================
   HELPERS
========================================================= */
function isLikelyRtspUrl(url) {
  return typeof url === 'string' && /^rtsps?:\/\/\S+$/i.test(url.trim());
}
function findCamera(id) {
  return cameras.find((c) => c.id === id);
}
// สุ่ม username/password สำหรับกล้องโหมด FTP push (ดู "FTP INGEST" ด้านล่าง)
function generateFtpCredentials(camId) {
  return {
    ftpUsername: 'cam_' + camId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8),
    ftpPassword: crypto.randomBytes(9).toString('base64url'),
  };
}

/* =========================================================
   CAMERA CRUD API
========================================================= */

app.get('/api/cameras', (req, res) => {
  res.json(cameras);
});

app.get('/api/cameras/:id', (req, res) => {
  const cam = findCamera(req.params.id);
  if (!cam) return res.status(404).json({ success: false, message: 'ไม่พบกล้องนี้' });
  res.json(cam);
});

app.post('/api/cameras', async (req, res) => {
  const { name, url, zone, mode } = req.body || {};
  const camMode = mode === 'ftp' ? 'ftp' : 'rtsp';
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อกล้อง' });
  }
  if (camMode === 'rtsp' && (!url || !isLikelyRtspUrl(url))) {
    return res.status(400).json({ success: false, message: 'URL ต้องขึ้นต้นด้วย rtsp:// หรือ rtsps://' });
  }
  const id = crypto.randomUUID();
  const cam = {
    id,
    name: name.trim(),
    url: camMode === 'rtsp' ? url.trim() : '',
    zone: (zone || '').trim(),
    status: 'unknown',
    mode: camMode,
    createdAt: new Date().toISOString(),
    // โหมด ftp: กล้อง (Dahua/Hikvision/Milesight ฯลฯ ที่รองรับ FTP/SFTP upload ในตัว) ส่ง snapshot เข้ามาเอง
    // ไม่ต้องให้ server ไปดึง RTSP — ดู "FTP INGEST" ด้านล่าง
    ...(camMode === 'ftp' ? generateFtpCredentials(id) : {}),
  };
  try {
    await upsertCameraRow(cam);
    cameras.push(cam);
    res.status(201).json(cam);
  } catch (err) {
    res.status(500).json({ success: false, message: 'บันทึกกล้องไม่สำเร็จ', raw: err.message });
  }
});

app.put('/api/cameras/:id', async (req, res) => {
  const cam = findCamera(req.params.id);
  if (!cam) return res.status(404).json({ success: false, message: 'ไม่พบกล้องนี้' });
  const { name, url, zone, regenerateFtpPassword } = req.body || {};
  if (cam.mode !== 'ftp' && url && !isLikelyRtspUrl(url)) {
    return res.status(400).json({ success: false, message: 'URL ต้องขึ้นต้นด้วย rtsp:// หรือ rtsps://' });
  }
  if (name) cam.name = name.trim();
  if (cam.mode !== 'ftp' && url) cam.url = url.trim();
  if (zone !== undefined) cam.zone = zone.trim();
  if (cam.mode === 'ftp' && regenerateFtpPassword) {
    cam.ftpPassword = generateFtpCredentials(cam.id).ftpPassword;
  }
  try {
    await upsertCameraRow(cam);
    res.json(cam);
  } catch (err) {
    res.status(500).json({ success: false, message: 'บันทึกกล้องไม่สำเร็จ', raw: err.message });
  }
});

// ตั้งค่ามุมภาพของกล้อง (หมุน/พลิก/ซูม) — ตั้งครั้งเดียวต่อกล้อง ใช้กับทุก Task ที่ผูกกล้องนี้
app.put('/api/cameras/:id/view', async (req, res) => {
  const cam = findCamera(req.params.id);
  if (!cam) return res.status(404).json({ success: false, message: 'ไม่พบกล้องนี้' });
  const { view, error } = imageView.parseView(req.body);
  if (error) return res.status(400).json({ success: false, message: error });
  const before = cam.view;
  cam.view = imageView.isIdentity(view) ? undefined : view;
  if (cam.view === undefined) delete cam.view;
  try {
    await upsertCameraRow(cam);
    audit('camera', 'info', `ตั้งค่ามุมภาพกล้อง "${cam.name}" (หมุน ${view.rotate}°${view.flipH ? ', พลิกซ้าย-ขวา' : ''}${view.flipV ? ', พลิกบน-ล่าง' : ''}, ซูม ${view.zoom}×)`, req.user.username);
    res.json({ success: true, camera: cam });
  } catch (err) {
    if (before === undefined) delete cam.view; else cam.view = before;
    res.status(500).json({ success: false, message: 'บันทึกการตั้งค่ามุมภาพไม่สำเร็จ', raw: err.message });
  }
});

app.delete('/api/cameras/:id', async (req, res) => {
  const idx = cameras.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'ไม่พบกล้องนี้' });
  try {
    await deleteCameraRow(req.params.id);
    cameras.splice(idx, 1);
    lastFtpSnapshotByCamera.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ลบกล้องไม่สำเร็จ', raw: err.message });
  }
});

/* =========================================================
   TASK CRUD API
========================================================= */

function withLastDetection(t) {
  return { ...t, lastDetection: lastDetections.get(t.id) || null, imageLost: lostImageTasks.has(t.id) };
}

app.get('/api/tasks', (req, res) => {
  res.json(tasks.map(withLastDetection));
});

app.get('/api/tasks/:id', (req, res) => {
  const t = findTask(req.params.id);
  if (!t) return res.status(404).json({ success: false, message: 'ไม่พบ Task นี้' });
  res.json(withLastDetection(t));
});

app.post('/api/tasks', async (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.name.trim()) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกชื่องาน' });
  }
  const task = {
    id: crypto.randomUUID(),
    name: body.name.trim(),
    zone: (body.zone || '').trim(),
    brickType: body.brickType || 'bt1',
    status: body.status || 'pause',
    workers: Array.isArray(body.workers) ? body.workers : [],
    area: Number(body.area) || 0,
    expectedArea: Number(body.expectedArea) || 100,
    blocks: Number(body.blocks) || 0,
    peopleDetected: 0, // จำนวนคนที่ AI ตรวจพบในโซนงานล่าสุด (แยกจาก workers ที่มอบหมายด้วยมือ)
    cameraStatus: 'disconnect',
    lastUpdate: 'เพิ่งสร้าง',
    confidence: Number(body.confidence) || 75,
    snapshotInterval: Number(body.snapshotInterval) || 30,
    cameraId: body.cameraId || null,
    schedule: body.schedule || { start: '08:00', breakStart: '12:00', breakEnd: '13:00', end: '17:00' },
    roi: Array.isArray(body.roi) ? body.roi : [],
    progressSeries: Array.isArray(body.progressSeries) ? body.progressSeries : [],
    createdAt: new Date().toISOString(),
  };
  try {
    await upsertTaskRow(task);
    tasks.push(task);
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ success: false, message: 'สร้าง Task ไม่สำเร็จ', raw: err.message });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
  const t = findTask(req.params.id);
  if (!t) return res.status(404).json({ success: false, message: 'ไม่พบ Task นี้' });
  const body = req.body || {};
  const editable = [
    'name', 'zone', 'brickType', 'status', 'workers', 'area', 'expectedArea',
    'blocks', 'cameraStatus', 'lastUpdate', 'confidence', 'snapshotInterval',
    'cameraId', 'schedule', 'roi', 'progressSeries',
  ];
  const wasFinished = t.status === 'finished';
  editable.forEach((key) => {
    if (body[key] !== undefined) t[key] = body[key];
  });
  try {
    await upsertTaskRow(t);
  } catch (err) {
    return res.status(500).json({ success: false, message: 'บันทึก Task ไม่สำเร็จ', raw: err.message });
  }

  // Task เพิ่งเปลี่ยนเป็น "เสร็จสิ้น" -> ต่อภาพ snapshot ทุกนาทีที่เก็บไว้เป็นไทม์แลปส์อัตโนมัติ (async ไม่บล็อก response)
  if (!wasFinished && t.status === 'finished') {
    startTimelapseBuild(t, req.user.username);
  }

  res.json(t);
});

app.delete('/api/tasks/:id', async (req, res) => {
  const idx = tasks.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'ไม่พบ Task นี้' });
  try {
    await deleteTaskRow(req.params.id); // ลบ task_history ของ task นี้ทั้งหมดด้วย (ON DELETE CASCADE)
    tasks.splice(idx, 1);
    lastDetections.delete(req.params.id);
    lastSnapshotBuffers.delete(req.params.id);
    lastDetectStartedAt.delete(req.params.id);
    fs.rmSync(path.join(SNAPSHOTS_DIR, req.params.id), { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ลบ Task ไม่สำเร็จ', raw: err.message });
  }
});

/* =========================================================
   TIME-LAPSE API — สร้าง/ดาวน์โหลดวิดีโอไทม์แลปส์จากภาพ snapshot ของ Task
========================================================= */
app.post('/api/tasks/:id/timelapse/build', async (req, res) => {
  const t = findTask(req.params.id);
  if (!t) return res.status(404).json({ success: false, message: 'ไม่พบ Task นี้' });
  if (!(await startTimelapseBuild(t, req.user.username))) {
    return res.status(409).json({ success: false, message: 'กำลังสร้างไทม์แลปส์ของ Task นี้อยู่แล้ว — รอสักครู่' });
  }
  res.status(202).json({ success: true, message: 'กำลังสร้างวิดีโอ MP4 และ GIF (อาจใช้เวลาสักครู่ตามจำนวนภาพ)' });
});

// ?format=mp4|gif (ค่าเริ่มต้น mp4) — ?inline=1 ให้ <video>/<img> เล่นในหน้าเว็บได้ (รองรับ Range), ไม่ใส่ = ดาวน์โหลดเป็นไฟล์
app.get('/api/tasks/:id/timelapse', (req, res) => {
  const t = findTask(req.params.id);
  if (!t) return res.status(404).json({ success: false, message: 'ไม่พบ Task นี้' });
  const format = req.query.format === 'gif' ? 'gif' : 'mp4';
  const file = path.join(SNAPSHOTS_DIR, t.id, `timelapse.${format}`);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ success: false, message: `ยังไม่มีไฟล์ ${format.toUpperCase()} ของ Task นี้ — กด "สร้างใหม่" ก่อน` });
  }
  const safeName = `${t.name.replace(/[\\/:*?"<>|\r\n]+/g, '_').trim() || 'task'}-timelapse.${format}`;
  if (req.query.inline) return res.sendFile(file);
  res.download(file, safeName);
});

/* =========================================================
   TASK HISTORY API — snapshot ตามช่วงเวลาของแต่ละ Task (blocks/area/จำนวนคนที่ตรวจพบ)
   query: ?from=ISO8601&to=ISO8601&limit=N (limit นับจากรายการล่าสุดย้อนกลับไป)
========================================================= */
app.get('/api/tasks/:id/history', async (req, res) => {
  const t = findTask(req.params.id);
  if (!t) return res.status(404).json({ success: false, message: 'ไม่พบ Task นี้' });
  const { from, to, limit } = req.query;
  try {
    const list = await queryTaskHistory(t.id, { from, to, limit });
    res.json(list);
  } catch (err) {
    res.status(500).json({ success: false, message: 'ดึงประวัติ Task ไม่สำเร็จ', raw: err.message });
  }
});

/* =========================================================
   BRICK TYPE CRUD API  (ผู้ใช้กำหนด blocksPerSqm เองผ่าน Settings > Brick Types)
========================================================= */
app.get('/api/bricktypes', (req, res) => res.json(brickTypes));

app.post('/api/bricktypes', async (req, res) => {
  const { name, blocksPerSqm, classId } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อประเภทอิฐ' });
  const ratio = Number(blocksPerSqm);
  if (!ratio || ratio <= 0) return res.status(400).json({ success: false, message: 'กรุณากรอกจำนวนบล็อกต่อตารางเมตรให้ถูกต้อง' });
  const bt = {
    id: 'bt' + crypto.randomUUID().slice(0, 8),
    name: name.trim(),
    blocksPerSqm: ratio,
    // ถ้า best.pt มีหลาย class อิฐ ระบุ index ของ class ที่ตรงกับประเภทนี้ — ว่าง/null = นับทุก class ที่โมเดลเจอ
    classId: classId === '' || classId === undefined || classId === null ? null : Number(classId),
  };
  try {
    await upsertBrickTypeRow(bt);
    brickTypes.push(bt);
    res.status(201).json(bt);
  } catch (err) {
    res.status(500).json({ success: false, message: 'บันทึกประเภทอิฐไม่สำเร็จ', raw: err.message });
  }
});

app.put('/api/bricktypes/:id', async (req, res) => {
  const bt = findBrickType(req.params.id);
  if (!bt) return res.status(404).json({ success: false, message: 'ไม่พบประเภทอิฐนี้' });
  const { name, blocksPerSqm, classId } = req.body || {};
  if (classId !== undefined) bt.classId = classId === '' || classId === null ? null : Number(classId);
  if (name !== undefined) bt.name = String(name).trim();
  if (blocksPerSqm !== undefined) {
    const ratio = Number(blocksPerSqm);
    if (!ratio || ratio <= 0) return res.status(400).json({ success: false, message: 'จำนวนบล็อกต่อตารางเมตรต้องมากกว่า 0' });
    bt.blocksPerSqm = ratio;
  }
  try {
    await upsertBrickTypeRow(bt);
    res.json(bt);
  } catch (err) {
    res.status(500).json({ success: false, message: 'บันทึกประเภทอิฐไม่สำเร็จ', raw: err.message });
  }
});

app.delete('/api/bricktypes/:id', async (req, res) => {
  const idx = brickTypes.findIndex((b) => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'ไม่พบประเภทอิฐนี้' });
  try {
    await deleteBrickTypeRow(req.params.id);
    brickTypes.splice(idx, 1);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ลบประเภทอิฐไม่สำเร็จ', raw: err.message });
  }
});

/* =========================================================
   AUTH — session cookie (HttpOnly) เก็บใน table sessions, รหัสผ่านเป็น bcrypt hash ใน table users
========================================================= */
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'กรุณากรอก username และ password' });
  }
  const wait = auth.lockedFor(req, username);
  if (wait) {
    return res.status(429).json({ success: false, message: `ลองผิดหลายครั้งเกินไป — รออีก ${Math.ceil(wait / 60)} นาที` });
  }
  const byName = () => users.find((u) => u.username.toLowerCase() === String(username).trim().toLowerCase());
  let user = byName();
  if (!user) {
    // บัญชีอาจถูกเพิ่มตรงลง DB (scripts/seed-users.js) ขณะ server รันอยู่ — cache ยังไม่มี จึงโหลดใหม่จาก DB หนึ่งครั้งก่อนสรุปว่าไม่พบ
    users = await loadUsersFromDB().catch(() => users);
    user = byName();
  }
  const ok = user && (await bcrypt.compare(password, user.password).catch(() => false));
  if (!ok) {
    auth.recordFail(req, username);
    audit('auth', 'warn', `เข้าสู่ระบบไม่สำเร็จ (username: ${String(username).trim().slice(0, 50)})`, null);
    return res.status(401).json({ success: false, message: 'username หรือ password ไม่ถูกต้อง' });
  }
  auth.clearFails(req, username);
  try {
    auth.setCookie(req, res, await auth.createSession(req, user.id));
    audit('auth', 'info', `${user.username} เข้าสู่ระบบ`, user.username);
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'สร้าง session ไม่สำเร็จ', raw: err.message });
  }
});

app.get('/api/me', (req, res) => res.json({ success: true, user: publicUser(req.user) }));

app.post('/api/logout', async (req, res) => {
  await auth.destroySession(req).catch(() => {});
  auth.clearCookie(req, res);
  res.json({ success: true });
});

/* =========================================================
   USER CRUD API — ผู้ใช้งานระบบ + ใช้สำหรับ login
========================================================= */
app.get('/api/users', (req, res) => res.json(users.map(publicUser)));

app.post('/api/users', async (req, res) => {
  const { name, email, username, password, role } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อ-นามสกุล' });
  if (!username || !username.trim()) return res.status(400).json({ success: false, message: 'กรุณากรอก username' });
  if (!password || !password.trim()) return res.status(400).json({ success: false, message: 'กรุณากรอก password' });
  if (!role || !findRoleByName(role)) return res.status(400).json({ success: false, message: 'กรุณาเลือกสิทธิ์ (role) ที่มีอยู่จริง' });
  if (users.some((u) => u.username.toLowerCase() === username.trim().toLowerCase())) {
    return res.status(400).json({ success: false, message: 'username นี้ถูกใช้งานแล้ว' });
  }
  const user = {
    id: 'u' + crypto.randomUUID().slice(0, 8),
    name: name.trim(),
    email: (email || '').trim(),
    username: username.trim(),
    password: await bcrypt.hash(password, 10),
    role,
  };
  try {
    await upsertUserRow(user);
    users.push(user);
    audit('edit', 'info', `สร้างผู้ใช้งาน ${user.username} (${user.role})`, req.user.username);
    res.status(201).json(publicUser(user));
  } catch (err) {
    res.status(500).json({ success: false, message: 'สร้างผู้ใช้งานไม่สำเร็จ', raw: err.message });
  }
});

app.put('/api/users/:id', async (req, res) => {
  const u = findUser(req.params.id);
  if (!u) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งานนี้' });
  const { name, email, username, password, role } = req.body || {};
  if (username && users.some((x) => x.id !== u.id && x.username.toLowerCase() === username.trim().toLowerCase())) {
    return res.status(400).json({ success: false, message: 'username นี้ถูกใช้งานแล้ว' });
  }
  if (role && !findRoleByName(role)) return res.status(400).json({ success: false, message: 'ไม่พบสิทธิ์ (role) นี้' });
  if (name !== undefined) u.name = String(name).trim();
  if (email !== undefined) u.email = String(email).trim();
  if (username !== undefined) u.username = String(username).trim();
  if (password) u.password = await bcrypt.hash(password, 10);
  if (role !== undefined) u.role = role;
  try {
    await upsertUserRow(u);
    if (password && u.id !== req.user.id) await auth.destroyUserSessions(u.id); // เปลี่ยนรหัสคนอื่น -> ออกจากระบบทุกเครื่อง
    audit('edit', 'info', `แก้ไขผู้ใช้งาน ${u.username}`, req.user.username);
    res.json(publicUser(u));
  } catch (err) {
    res.status(500).json({ success: false, message: 'บันทึกผู้ใช้งานไม่สำเร็จ', raw: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  const idx = users.findIndex((u) => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งานนี้' });
  if (users.length <= 1) return res.status(400).json({ success: false, message: 'ต้องมีผู้ใช้งานอย่างน้อย 1 คนในระบบ' });
  if (req.params.id === req.user.id) return res.status(400).json({ success: false, message: 'ลบบัญชีที่กำลังใช้งานอยู่ไม่ได้' });
  try {
    audit('edit', 'warn', `ลบผู้ใช้งาน ${users[idx].username}`, req.user.username);
    await deleteUserRow(req.params.id); // sessions ของผู้ใช้นี้ถูกลบตาม ON DELETE CASCADE
    users.splice(idx, 1);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ลบผู้ใช้งานไม่สำเร็จ', raw: err.message });
  }
});

/* =========================================================
   ROLE API — Role คงที่ 3 แบบ (Admin/Engineer/Viewer) เท่านั้น
   แก้ได้แค่ permissions ของแต่ละ Role — เพิ่ม/ลบ/เปลี่ยนชื่อ Role ไม่ได้
========================================================= */
app.get('/api/roles', (req, res) => res.json(roles));

app.post('/api/roles', (req, res) => {
  res.status(403).json({ success: false, message: 'ระบบนี้มี Role คงที่ 3 แบบ (Admin/Engineer/Viewer) ไม่สามารถเพิ่ม Role ใหม่ได้' });
});

app.put('/api/roles/:id', async (req, res) => {
  const r = findRole(req.params.id);
  if (!r) return res.status(404).json({ success: false, message: 'ไม่พบ Role นี้' });
  const { name, permissions } = req.body || {};
  if (name !== undefined && name.trim() !== r.name) {
    return res.status(400).json({ success: false, message: 'Role พื้นฐานนี้ถูกล็อกไว้ แก้ชื่อไม่ได้' });
  }
  if (permissions !== undefined) r.permissions = { ...r.permissions, ...permissions };
  try {
    await upsertRoleRow(r);
    res.json(r);
  } catch (err) {
    res.status(500).json({ success: false, message: 'บันทึกสิทธิ์ไม่สำเร็จ', raw: err.message });
  }
});

app.delete('/api/roles/:id', (req, res) => {
  const r = findRole(req.params.id);
  if (!r) return res.status(404).json({ success: false, message: 'ไม่พบ Role นี้' });
  res.status(403).json({ success: false, message: 'Role พื้นฐานนี้ถูกล็อกไว้ ลบไม่ได้' });
});

/* =========================================================
   WORKER MASTER LIST API — แรงงานทั้งหมดในระบบ (มอบหมายเข้า Task แยกต่างหาก)
========================================================= */
app.get('/api/workers', (req, res) => res.json(workersMaster));

app.post('/api/workers', async (req, res) => {
  const { name, role } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อแรงงาน' });
  const w = { id: 'w' + crypto.randomUUID().slice(0, 8), name: name.trim(), role: (role || 'ช่างก่อสร้าง').trim() };
  try {
    await upsertWorkerRow(w);
    workersMaster.push(w);
    res.status(201).json(w);
  } catch (err) {
    res.status(500).json({ success: false, message: 'สร้างแรงงานไม่สำเร็จ', raw: err.message });
  }
});

app.put('/api/workers/:id', async (req, res) => {
  const w = workersMaster.find((x) => x.id === req.params.id);
  if (!w) return res.status(404).json({ success: false, message: 'ไม่พบแรงงานนี้' });
  const { name, role } = req.body || {};
  if (name !== undefined) w.name = String(name).trim();
  if (role !== undefined) w.role = String(role).trim();
  try {
    await upsertWorkerRow(w);
    res.json(w);
  } catch (err) {
    res.status(500).json({ success: false, message: 'บันทึกแรงงานไม่สำเร็จ', raw: err.message });
  }
});

app.delete('/api/workers/:id', async (req, res) => {
  const idx = workersMaster.findIndex((w) => w.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'ไม่พบแรงงานนี้' });
  try {
    await deleteWorkerRow(req.params.id);
    workersMaster.splice(idx, 1);
    // เอาแรงงานที่ถูกลบออกจาก Task ทุกอันที่มอบหมายไว้ด้วย กันข้อมูลค้าง
    const changedTasks = [];
    tasks.forEach((t) => {
      if (t.workers.includes(req.params.id)) {
        t.workers = t.workers.filter((id) => id !== req.params.id);
        changedTasks.push(t);
      }
    });
    await Promise.all(changedTasks.map((t) => upsertTaskRow(t)));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ลบแรงงานไม่สำเร็จ', raw: err.message });
  }
});

/* =========================================================
   ALERT CONFIG API — Discord webhook + สวิตช์แจ้งเตือน (persist + ทดสอบจริง)
========================================================= */
app.get('/api/alertconfig', (req, res) => res.json(alertConfig));

app.put('/api/alertconfig', async (req, res) => {
  const body = req.body || {};
  const editable = ['webhook', 'cameraOffline', 'serverOffline', 'aiStopped', 'internetDown', 'noImage'];
  editable.forEach((key) => {
    if (body[key] !== undefined) alertConfig[key] = body[key];
  });
  try {
    await saveAlertConfigDB(alertConfig);
    res.json(alertConfig);
  } catch (err) {
    res.status(500).json({ success: false, message: 'บันทึกการตั้งค่าแจ้งเตือนไม่สำเร็จ', raw: err.message });
  }
});

app.post('/api/alerts/test', async (req, res) => {
  const webhook = (alertConfig.webhook || '').trim();
  if (!webhook) {
    return res.status(400).json({ success: false, message: 'ยังไม่ได้ตั้งค่า Discord Webhook — กรอก URL แล้วกดบันทึกก่อน' });
  }
  try {
    const discordRes = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `🔔 CIVIL — ทดสอบการแจ้งเตือนจากระบบ (${new Date().toLocaleString('th-TH')})` }),
    });
    if (!discordRes.ok) {
      const errText = await discordRes.text().catch(() => '');
      return res.status(502).json({ success: false, message: 'ส่งไปยัง Discord ไม่สำเร็จ', raw: errText.slice(0, 300) });
    }
    res.json({ success: true, message: 'ส่งการแจ้งเตือนทดสอบไปยัง Discord สำเร็จ' });
  } catch (err) {
    res.status(502).json({ success: false, message: 'เชื่อมต่อ Discord Webhook ไม่สำเร็จ', raw: err.message });
  }
});

/* =========================================================
   STORAGE API — พื้นที่ดิสก์จริงของ snapshot + ตั้งค่า retention + สำรองข้อมูล
========================================================= */
function dirSizeBytes(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeBytes(full);
    else {
      try {
        total += fs.statSync(full).size;
      } catch (_) {}
    }
  }
  return total;
}
function countSnapshotFiles(dir) {
  let count = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) count += countSnapshotFiles(path.join(dir, entry.name));
    else if (entry.name.endsWith('.jpg')) count += 1;
  }
  return count;
}

app.get('/api/storage', (req, res) => {
  const usedBytes = dirSizeBytes(SNAPSHOTS_DIR);
  let totalBytes = null;
  try {
    const stat = fs.statfsSync(__dirname);
    totalBytes = stat.bsize * stat.blocks;
  } catch (_) {
    // fs.statfsSync ไม่รองรับบางแพลตฟอร์ม/เวอร์ชัน Node — ปล่อยเป็น null แล้วให้ frontend ซ่อนแถบเทียบสัดส่วน
  }
  res.json({
    ...storageConfig,
    usedBytes,
    totalBytes,
    snapshotCount: countSnapshotFiles(SNAPSHOTS_DIR),
  });
});

app.put('/api/storage', async (req, res) => {
  const body = req.body || {};
  if (body.autoDelete !== undefined) storageConfig.autoDelete = !!body.autoDelete;
  if (body.retentionDays !== undefined) {
    const days = Number(body.retentionDays);
    if (!days || days <= 0) return res.status(400).json({ success: false, message: 'จำนวนวันเก็บข้อมูลต้องมากกว่า 0' });
    storageConfig.retentionDays = days;
  }
  try {
    await saveStorageConfigDB(storageConfig);
    res.json(storageConfig);
  } catch (err) {
    res.status(500).json({ success: false, message: 'บันทึกการตั้งค่าพื้นที่จัดเก็บไม่สำเร็จ', raw: err.message });
  }
});

// ไฟล์ภาพถูกลบแล้ว -> เคลียร์ path ใน task_history เป็น NULL ด้วย (ไม่งั้นหน้า Report/ไทม์แลปส์ชี้ไปหาภาพที่ไม่มีอยู่ = ภาพไม่ขึ้น)
function forgetSnapshotRefs(urls) {
  if (!urls.length) return;
  pool.query('UPDATE task_history SET snapshot = NULL WHERE snapshot = ANY($1::text[])', [urls])
    .catch((err) => console.error('[snapshots] clear stale refs failed:', err.message));
}

// ลบ snapshot ที่เก่ากว่า retentionDays ทิ้งจริง — รันเป็นรอบ (ดู setInterval ด้านล่าง)
function sweepOldSnapshots() {
  if (!storageConfig.autoDelete) return;
  const cutoff = Date.now() - storageConfig.retentionDays * 24 * 60 * 60 * 1000;
  let taskDirs;
  try {
    taskDirs = fs.readdirSync(SNAPSHOTS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch (_) {
    return;
  }
  taskDirs.forEach((d) => {
    const dir = path.join(SNAPSHOTS_DIR, d.name);
    let files;
    try {
      files = fs.readdirSync(dir).filter((f) => FRAME_RE.test(f));
    } catch (_) {
      return;
    }
    const removed = [];
    files.forEach((f) => {
      const full = path.join(dir, f);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); removed.push(`/snapshots/${d.name}/${f}`); }
      } catch (_) {}
    });
    forgetSnapshotRefs(removed);
  });
}

// สำรองข้อมูล — pg_dump ทั้งฐานข้อมูล (ทุกตาราง รวมผู้ใช้/Task/ประวัติ) เป็นไฟล์ .dump (custom format)
// กู้คืนด้วย: pg_restore -d <db> --clean --if-exists civil-backup-*.dump
// ไม่รวมไฟล์ภาพ snapshot (อยู่ที่ snapshots/ บนดิสก์ — ขนาดใหญ่ ให้สำรองแยกด้วย rsync)
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP) || 14;
function runPgDump(outPath) {
  return new Promise((resolve, reject) => {
    const args = ['--format=custom', '--no-owner', '--file', outPath];
    if (process.env.DATABASE_URL) args.push(process.env.DATABASE_URL);
    else args.push(process.env.PGDATABASE || 'civil');
    const env = { ...process.env };
    if (!process.env.DATABASE_URL) {
      env.PGHOST = process.env.PGHOST || '127.0.0.1';
      env.PGPORT = String(Number(process.env.PGPORT) || 5432);
      env.PGUSER = process.env.PGUSER || 'civil_app';
      env.PGPASSWORD = process.env.PGPASSWORD || '';
    }
    const proc = spawn('pg_dump', args, { env });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => reject(new Error(`รัน pg_dump ไม่ได้ (ติดตั้ง postgresql-client?): ${err.message}`)));
    proc.on('close', (code) => (code === 0 ? resolve(outPath) : reject(new Error(stderr.trim().slice(-500) || `pg_dump exit ${code}`))));
  });
}
async function createBackupFile() {
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const filename = `civil-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`;
  const outPath = path.join(BACKUPS_DIR, filename);
  try {
    await runPgDump(outPath);
  } catch (err) {
    fs.rmSync(outPath, { force: true });
    throw err;
  }
  const old = fs.readdirSync(BACKUPS_DIR).filter((f) => /^civil-backup-.*\.dump$/.test(f)).sort().slice(0, -BACKUP_KEEP);
  old.forEach((f) => fs.rmSync(path.join(BACKUPS_DIR, f), { force: true }));
  return { filename, outPath };
}
app.post('/api/storage/backup', async (req, res) => {
  try {
    const { filename, outPath } = await createBackupFile();
    audit('snapshot', 'info', `สำรองฐานข้อมูล ${filename}`, req.user.username);
    res.download(outPath, filename);
  } catch (err) {
    audit('error', 'error', `สำรองฐานข้อมูลไม่สำเร็จ: ${err.message}`, req.user.username);
    res.status(500).json({ success: false, message: 'สำรองข้อมูลไม่สำเร็จ', raw: err.message });
  }
});

/* =========================================================
   AUTO START / PAUSE ตามเวลาทำงาน (schedule.js) — ทุก 15 วินาที เทียบเวลา Asia/Bangkok
   เปลี่ยนสถานะเฉพาะตอน "ข้ามเส้นเวลา" (เริ่มงาน / เริ่มพัก / จบพัก / เลิกงาน) ผู้ใช้กดเองระหว่างช่วงได้
   ไม่แตะ Task ที่ finished — สถานะเสร็จสิ้นต้องกดเองเท่านั้น
========================================================= */
const APP_TIMEZONE = process.env.APP_TIMEZONE || schedule.DEFAULT_TZ;
const PHASE_LABEL = { work: 'เริ่มงาน', break: 'เริ่มพัก', off: 'เลิกงาน' };
async function scheduleTick() {
  const nowMin = schedule.minutesNow(new Date(), APP_TIMEZONE);
  for (const t of tasks) {
    const { phase, status } = schedule.evaluate(t, nowMin);
    if (phase === (t.autoPhase || null) && !status) continue;
    const prev = { status: t.status, autoPhase: t.autoPhase, lastUpdate: t.lastUpdate };
    if (phase) t.autoPhase = phase; else delete t.autoPhase;
    if (status) t.status = status;
    if (status) t.lastUpdate = `${status === 'running' ? 'เริ่ม' : 'พัก'}อัตโนมัติ (${PHASE_LABEL[phase]})`;
    try {
      await upsertTaskRow(t);
      if (status) {
        audit('task', 'info', `Task "${t.name}" ${status === 'running' ? 'เริ่มการตรวจจับ' : 'พักการตรวจจับ'}อัตโนมัติ — ${PHASE_LABEL[phase]}`);
      }
    } catch (err) {
      t.status = prev.status; t.autoPhase = prev.autoPhase; t.lastUpdate = prev.lastUpdate; // DB เขียนไม่สำเร็จ -> คืนค่า cache ให้ตรงกับ DB แล้วลองใหม่รอบหน้า
      console.error(`[schedule] task ${t.id}:`, err.message);
    }
  }
}

/* =========================================================
   LOSS DATA WATCHER — Task ที่กำลังทำงานแต่ไม่มีภาพเข้ามาเกิน (snapshotInterval + NO_IMAGE_SECONDS)
   -> ขึ้นสถานะ "Loss data" (หน้าจอแสดงผ่าน task.imageLost) + แจ้งเตือน แล้วรอเช็คต่อเรื่อย ๆ
   ภาพกลับมาเมื่อไหร่ (lastImageAt ใหม่) สถานะกลับเป็นปกติเอง — ตัวเช็คนี้อ่านอย่างเดียว
   ไม่ยุ่งกับช่องทางรับภาพ (FTP / RTSP) ใช้แค่ t.lastImageAt ที่ pipeline ตรวจจับบันทึกไว้
========================================================= */
const NO_IMAGE_SECONDS = Number(process.env.NO_IMAGE_SECONDS) || 15;
const lostImageTasks = new Set(); // taskId ที่อยู่ในสถานะ Loss data
const runningSince = new Map(); // taskId -> epoch ms ที่เห็นว่าเริ่ม running (กัน false alarm ตอนเพิ่งกดเริ่ม/หลัง restart)
async function sendDiscordAlert(text) {
  const webhook = (alertConfig.webhook || '').trim();
  if (!webhook) return;
  try {
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text }) });
  } catch (err) {
    console.error('[alert] discord send failed:', err.message);
  }
}
async function imageWatchTick() {
  const now = Date.now();
  for (const t of tasks) {
    // เฉพาะ Task ที่ระบบควรได้รับภาพไปตรวจจับจริง (running + มีกล้อง + มี ROI) — ไม่มี ROI = ไม่มีการประมวลผลภาพ จึงไม่ใช่ "Loss"
    if (t.status !== 'running' || !t.cameraId || !t.roi || t.roi.length < 3) {
      runningSince.delete(t.id);
      lostImageTasks.delete(t.id);
      continue;
    }
    if (!runningSince.has(t.id)) runningSince.set(t.id, now);
    const lastMs = t.lastImageAt ? new Date(t.lastImageAt).getTime() : 0;
    const ageMs = now - Math.max(lastMs, runningSince.get(t.id));
    const limitMs = ((Number(t.snapshotInterval) || 30) + NO_IMAGE_SECONDS) * 1000;
    const lost = ageMs > limitMs;
    if (lost && !lostImageTasks.has(t.id)) {
      lostImageTasks.add(t.id);
      t.cameraStatus = 'disconnect';
      await upsertTaskRow(t).catch((e) => console.error('[watch] persist failed:', e.message));
      audit('camera', 'error', `Task "${t.name}" ไม่ได้รับภาพจากกล้องนาน ${Math.round(ageMs / 1000)} วินาที (Loss data)`);
      if (alertConfig.noImage) sendDiscordAlert(`⚠️ CIVIL — Task "${t.name}" ไม่ได้รับภาพจากกล้องเกิน ${Math.round(limitMs / 1000)} วินาที (Loss data)`);
    } else if (!lost && lostImageTasks.has(t.id)) {
      lostImageTasks.delete(t.id);
      audit('camera', 'info', `Task "${t.name}" ได้รับภาพจากกล้องอีกครั้ง — กลับสู่ปกติ`);
      if (alertConfig.noImage) sendDiscordAlert(`✅ CIVIL — Task "${t.name}" ได้รับภาพจากกล้องอีกครั้งแล้ว`);
    }
  }
}

/* =========================================================
   AI DETECTION — YOLOv11 (proxy ไปที่ yolo_service.py)
   ดึง snapshot จากกล้องของ Task -> ส่งไปให้ Python รัน YOLOv11
   -> ได้จำนวนบล็อกที่อยู่ใน ROI (นับจาก centroid) -> แปลงเป็นตารางเมตร
   ตามอัตราส่วน blocksPerSqm ของประเภทอิฐที่ Task นั้นใช้ -> อัปเดต task แล้ว persist
========================================================= */
// รับ jpeg ที่ได้มาแล้ว (ไม่ว่าจะดึงมาเองผ่าน RTSP หรือกล้อง push เข้ามาทาง FTP) แล้ววิ่ง pipeline ตรวจจับเดียวกันทั้งหมด
async function detectFromImageBuffer(t, jpeg) {
  const bt = findBrickType(t.brickType);
  if (!bt) return { success: false, status: 400, message: 'ไม่พบประเภทอิฐของ Task นี้ — ตั้งค่าใน Settings > Brick Types' };
  if (!t.roi || t.roi.length < 3) {
    return { success: false, status: 400, message: 'กรุณาวาด ROI ของ Task นี้ก่อนเริ่มตรวจจับ' };
  }

  t.lastImageAt = new Date().toISOString(); // ภาพมาถึงแล้ว (ตัวเช็ค "Loss data" ดูค่านี้) — persist ตอน upsertTaskRow ด้านล่าง
  try {
    // ปรับมุมภาพ (หมุน/พลิก/ซูม) ตามที่ตั้งไว้ต่อกล้อง ก่อนส่งเข้า YOLO และก่อนเก็บ snapshot —
    // ROI ของ Task วาดบนภาพที่ปรับแล้ว พิกัดจึงตรงกับที่ YOLO เห็นและภาพใน timeline
    const cam = t.cameraId ? findCamera(t.cameraId) : null;
    try {
      jpeg = await imageView.applyView(jpeg, cam && cam.view);
    } catch (viewErr) {
      return { success: false, status: 500, message: 'ปรับมุมภาพ (หมุน/พลิก/ซูม) ไม่สำเร็จ', raw: viewErr.message };
    }
    const imageBase64 = jpeg.toString('base64');
    lastSnapshotBuffers.set(t.id, jpeg); // เก็บภาพล่าสุดไว้ใน memory ให้ appendTaskHistorySnapshot หยิบไปบันทึกทุก 1 นาที

    const yoloRes = await fetch(`${YOLO_SERVICE_URL}/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: imageBase64,
        roi: t.roi,
        blocks_per_sqm: bt.blocksPerSqm,
        confidence: (t.confidence || 75) / 100,
        class_id: bt.classId ?? null, // ถ้า brickType นี้ระบุ class ของโมเดลไว้ นับเฉพาะ class นั้น
      }),
    });

    if (!yoloRes.ok) {
      const errText = await yoloRes.text().catch(() => '');
      return {
        success: false,
        status: 502,
        message: 'เรียกใช้งาน YOLOv11 service ไม่สำเร็จ — ตรวจสอบว่ารัน yolo_service.py อยู่หรือไม่',
        raw: errText.slice(0, 500),
      };
    }

    const result = await yoloRes.json();

    // โมเดลที่สอง (แยกจากโมเดลอิฐโดยสิ้นเชิง) — นับ "คน" ที่อยู่ในโซน ROI เดียวกันของ Task นี้
    // ไม่เกี่ยวข้องกับ t.workers (แรงงานที่มอบหมายเข้างานด้วยมือ) — เก็บแยกไว้ที่ t.peopleDetected
    let personResult = null;
    try {
      const personRes = await fetch(`${YOLO_SERVICE_URL}/detect-person`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: imageBase64,
          roi: t.roi,
          confidence: PERSON_DETECT_CONFIDENCE,
        }),
      });
      if (personRes.ok) personResult = await personRes.json();
    } catch (_) {
      // ตรวจจับคนล้มเหลวไม่ควรทำให้การนับอิฐ (ผลหลัก) เสียไปด้วย — ปล่อยผ่านเงียบ ๆ
    }

    // อัปเดตผลลัพธ์ AI กลับเข้า Task แล้ว persist ลง Postgres
    t.blocks = result.blocks_in_roi;
    t.area = result.area_m2;
    t.peopleDetected = personResult ? personResult.persons_in_roi : (t.peopleDetected || 0);
    t.cameraStatus = 'live';
    t.lastUpdate = 'เพิ่งตรวจจับ (AI)';
    await upsertTaskRow(t);
    // เก็บ bbox ล่าสุดไว้ใน memory (ไม่ persist ลง DB เพราะอัปเดตถี่มากตอน realtime)
    lastDetections.set(t.id, {
      detections: result.detections,
      image_width: result.image_width,
      image_height: result.image_height,
      personDetections: personResult ? personResult.detections : [],
      personCount: t.peopleDetected,
      at: Date.now(),
    });

    return { success: true, task: t, detection: result, personDetection: personResult };
  } catch (err) {
    t.cameraStatus = 'disconnect';
    await upsertTaskRow(t).catch((e) => console.error('[task] persist cameraStatus failed:', e.message));
    return { success: false, status: 502, message: 'ตรวจจับไม่สำเร็จ', raw: err.message };
  }
}

// Task ที่ผูกกล้องโหมด RTSP — server เป็นฝ่ายไปดึงภาพเอง (ffmpeg) แล้วส่งเข้า pipeline เดียวกับด้านบน
// Task ที่ผูกกล้องโหมด FTP ไม่ผ่านฟังก์ชันนี้ — ดู handleFtpUpload() ใน "FTP INGEST" ที่กล้อง push ภาพเข้ามาเอง
async function runDetectionForTask(t) {
  if (!t.cameraId) return { success: false, status: 400, message: 'Task นี้ยังไม่ได้เลือกกล้อง' };
  const cam = findCamera(t.cameraId);
  if (!cam) return { success: false, status: 400, message: 'ไม่พบกล้องที่ผูกกับ Task นี้' };
  if (cam.mode === 'ftp') {
    return { success: false, status: 400, message: 'กล้องนี้เป็นโหมด FTP push — ระบบรอรับภาพจากกล้องเข้ามาเอง ไม่ต้องกดตรวจจับด้วยตนเอง' };
  }
  const bt = findBrickType(t.brickType);
  if (!bt) return { success: false, status: 400, message: 'ไม่พบประเภทอิฐของ Task นี้ — ตั้งค่าใน Settings > Brick Types' };
  if (!t.roi || t.roi.length < 3) {
    return { success: false, status: 400, message: 'กรุณาวาด ROI ของ Task นี้ก่อนเริ่มตรวจจับ' };
  }
  try {
    const jpeg = await captureSnapshot(cam.url, 8000);
    return await detectFromImageBuffer(t, jpeg);
  } catch (err) {
    t.cameraStatus = 'disconnect';
    await upsertTaskRow(t).catch((e) => console.error('[task] persist cameraStatus failed:', e.message));
    return { success: false, status: 502, message: 'ตรวจจับไม่สำเร็จ', raw: err.message };
  }
}

app.post('/api/tasks/:id/detect', async (req, res) => {
  const t = findTask(req.params.id);
  if (!t) return res.status(404).json({ success: false, message: 'ไม่พบ Task นี้' });
  const result = await runDetectionForTask(t);
  if (!result.success) {
    const { status, ...body } = result;
    return res.status(status || 500).json(body);
  }
  res.json(result);
});

/* =========================================================
   AUTO DETECTION LOOP — ตรวจจับต่อเนื่องแบบ realtime ไม่ต้องกดปุ่ม
   ทันทีที่ Task อยู่สถานะ running + มีกล้อง + วาด ROI แล้ว ระบบจะดึงภาพแล้วรัน YOLO
   ต่อเนื่องไปเรื่อย ๆ (รอบถัดไปเริ่มทันทีที่รอบก่อนหน้าของ Task นั้นเสร็จ ไม่มีหน่วงเวลาคงที่)
========================================================= */
const AUTO_DETECT_TICK_MS = 1000; // ความละเอียดของตัว scheduler เอง — จังหวะตรวจจับจริงต่อ Task ดู snapshotInterval ของแต่ละ Task
const lastDetections = new Map(); // taskId -> { detections, image_width, image_height, at }
const inFlightDetections = new Set(); // taskId ที่กำลังตรวจจับอยู่ (กันซ้อนรอบ)
const lastDetectStartedAt = new Map(); // taskId -> epoch ms ของรอบตรวจจับล่าสุดที่เริ่ม (ใช้คุมจังหวะตาม snapshotInterval)

function autoDetectTick() {
  const now = Date.now();
  tasks.forEach((t) => {
    if (t.status !== 'running') return;
    if (!t.cameraId) return;
    const cam = findCamera(t.cameraId);
    if (!cam || cam.mode === 'ftp') return; // โหมด ftp รอรับภาพจากกล้อง push เข้ามาเอง ไม่ใช่ server ไปดึง
    if (!t.roi || t.roi.length < 3) return;
    if (inFlightDetections.has(t.id)) return; // รอบก่อนหน้ายังไม่เสร็จ ข้ามไปก่อน
    const intervalMs = Math.max(1, Number(t.snapshotInterval) || 30) * 1000;
    const last = lastDetectStartedAt.get(t.id) || 0;
    if (now - last < intervalMs) return; // ยังไม่ถึงรอบของ Task นี้ (ตั้งค่าที่ "ความถี่ตรวจจับ" ใน Task Detail)
    lastDetectStartedAt.set(t.id, now);
    inFlightDetections.add(t.id);
    runDetectionForTask(t).finally(() => inFlightDetections.delete(t.id));
  });
}

/* =========================================================
   FTP INGEST — สำหรับกล้องที่ไม่อยู่วง LAN เดียวกับ server (เช่น กล้อง 4G ต่างเครือข่าย)
   ถ้ากล้องรองรับ FTP/SFTP upload ในตัว (Dahua/Hikvision/Milesight บางรุ่น) ให้ตั้งกล้องเป็น
   camera.mode='ftp' แล้วตั้งค่า FTP ในตัวกล้องให้ส่ง snapshot มาที่ server นี้ตาม username/password
   ที่ระบบสุ่มให้ (ดู generateFtpCredentials) — พอไฟล์เข้ามา ระบบจะรันตรวจจับทันที (event-driven
   ไม่ใช่ polling แบบ autoDetectTick) ให้ทุก Task ที่ผูกกล้องตัวนั้นและอยู่สถานะ "กำลังดำเนินการ"
========================================================= */
const FtpSrv = require('ftp-srv');
const FTP_PORT = Number(process.env.FTP_PORT) || 2121;
// ต้องตั้งเป็น public IP ของเครื่องนี้ใน production ไม่งั้นกล้องต่อ passive mode ไม่ได้ (ดึงภาพไม่สำเร็จ)
const FTP_PASV_URL = process.env.FTP_PASV_URL || undefined;
const FTP_PASV_MIN = Number(process.env.FTP_PASV_MIN) || 50000;
const FTP_PASV_MAX = Number(process.env.FTP_PASV_MAX) || 50100;
const FTP_UPLOADS_DIR = path.join(__dirname, 'ftp-uploads');
if (!fs.existsSync(FTP_UPLOADS_DIR)) fs.mkdirSync(FTP_UPLOADS_DIR, { recursive: true });

function ftpUploadDirForCamera(camId) {
  const dir = path.join(FTP_UPLOADS_DIR, camId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const ftpServer = new FtpSrv({
  url: `ftp://0.0.0.0:${FTP_PORT}`,
  pasv_url: FTP_PASV_URL,
  pasv_min: FTP_PASV_MIN,
  pasv_max: FTP_PASV_MAX,
  greeting: ['CIVIL FTP ingest — สำหรับกล้องโหมด push เท่านั้น'],
});

ftpServer.on('login', ({ connection, username, password }, resolve, reject) => {
  const cam = cameras.find((c) => c.mode === 'ftp' && c.ftpUsername === username);
  if (!cam || cam.ftpPassword !== password) {
    return reject(new Error('username หรือ password ไม่ถูกต้อง'));
  }
  connection.on('STOR', (err, fileName) => {
    if (err) return;
    handleFtpUpload(cam, fileName).catch((e) => console.error('[ftp] handle upload failed:', e.message));
  });
  resolve({ root: ftpUploadDirForCamera(cam.id) });
});
ftpServer.on('client-error', ({ error }) => console.error('[ftp] client error:', error.message));
ftpServer.on('server-error', ({ error }) => console.error('[ftp] server error:', error.message));

// ไฟล์อัปโหลดเสร็จ -> วิ่ง pipeline ตรวจจับเดียวกับ RTSP ให้ทุก Task ที่ผูกกล้องนี้อยู่ แล้วลบไฟล์ทิ้ง
// (ผลจริงถูกเก็บถาวรแล้วผ่าน lastSnapshotBuffers/task_history เหมือนโหมด RTSP ทุกประการ)
async function handleFtpUpload(cam, fileName) {
  const filePath = path.join(ftpUploadDirForCamera(cam.id), path.basename(fileName));
  let jpeg;
  try {
    jpeg = fs.readFileSync(filePath);
  } catch (_) {
    return; // ไฟล์อาจถูกลบ/ย้ายไปแล้วก่อนอ่านทัน
  }

  lastFtpSnapshotByCamera.set(cam.id, jpeg);
  cam.status = 'live';
  upsertCameraRow(cam).catch((e) => console.error('[ftp] persist camera status failed:', e.message));

  const targets = tasks.filter((t) => t.cameraId === cam.id && t.status === 'running' && t.roi && t.roi.length >= 3);
  for (const t of targets) {
    if (inFlightDetections.has(t.id)) continue;
    inFlightDetections.add(t.id);
    lastDetectStartedAt.set(t.id, Date.now());
    try {
      await detectFromImageBuffer(t, jpeg);
    } catch (err) {
      console.error(`[ftp] detect failed for task ${t.id}:`, err.message);
    } finally {
      inFlightDetections.delete(t.id);
    }
  }

  fs.unlink(filePath, () => {}); // กันดิสก์ค้าง — ภาพที่ต้องเก็บถาวรอยู่ใน snapshots/ อยู่แล้ว
}

app.get('/api/ftp-info', (req, res) => {
  res.json({ port: FTP_PORT });
});

/* =========================================================
   RTSP CONNECTION TEST (ffprobe)
========================================================= */
function probeRtsp(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const args = [
      '-rtsp_transport', 'tcp',
      '-timeout', String(timeoutMs * 1000),
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,avg_frame_rate',
      '-of', 'json',
      url,
    ];
    const proc = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';
    let finished = false;

    const killTimer = setTimeout(() => {
      if (!finished) {
        finished = true;
        proc.kill('SIGKILL');
        resolve({ success: false, message: 'หมดเวลาการเชื่อมต่อ (timeout)', raw: stderr.trim() });
      }
    }, timeoutMs + 2000);

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(killTimer);
      resolve({ success: false, message: 'ไม่สามารถรัน ffprobe บนเซิร์ฟเวอร์ได้ (โปรดติดตั้ง ffmpeg)', raw: err.message });
    });
    proc.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(killTimer);
      if (code === 0) {
        let streamInfo = null;
        try {
          const parsed = JSON.parse(stdout);
          streamInfo = (parsed.streams && parsed.streams[0]) || null;
        } catch (_) {}
        resolve({ success: true, message: 'เชื่อมต่อกล้องสำเร็จ', stream: streamInfo });
      } else {
        resolve({
          success: false,
          message: 'เชื่อมต่อกล้องไม่สำเร็จ — ตรวจสอบ URL / username-password / network',
          raw: stderr.trim().slice(-800),
        });
      }
    });
  });
}

app.post('/api/test-rtsp', async (req, res) => {
  const { url, timeoutMs } = req.body || {};
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ success: false, message: 'กรุณากรอก Camera URL' });
  }
  if (!isLikelyRtspUrl(url)) {
    return res.status(400).json({ success: false, message: 'รูปแบบ URL ไม่ถูกต้อง ต้องขึ้นต้นด้วย rtsp:// หรือ rtsps://' });
  }
  const effectiveTimeout = Math.min(Math.max(Number(timeoutMs) || 8000, 2000), 20000);
  try {
    const result = await probeRtsp(url.trim(), effectiveTimeout);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดที่ไม่คาดคิด', raw: err.message });
  }
});

app.post('/api/cameras/:id/test', async (req, res) => {
  const cam = findCamera(req.params.id);
  if (!cam) return res.status(404).json({ success: false, message: 'ไม่พบกล้องนี้' });
  const result = await probeRtsp(cam.url, 8000);
  cam.status = result.success ? 'live' : 'disconnect';
  cam.lastTestedAt = new Date().toISOString();
  try {
    await upsertCameraRow(cam);
  } catch (err) {
    console.error('[camera] persist test result failed:', err.message);
  }
  res.json({ ...result, camera: cam });
});

/* =========================================================
   SNAPSHOT — single JPEG frame from RTSP
========================================================= */
function captureSnapshot(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const args = [
      '-rtsp_transport', 'tcp',
      '-y',
      '-timeout', String(timeoutMs * 1000),
      '-i', url,
      '-frames:v', '1',
      '-update', '1',
      '-q:v', '4',
      '-f', 'image2',
      'pipe:1',
    ];
    const proc = spawn('ffmpeg', args);
    const chunks = [];
    let stderr = '';
    let finished = false;

    const killTimer = setTimeout(() => {
      if (!finished) {
        finished = true;
        proc.kill('SIGKILL');
        reject(new Error('หมดเวลาในการดึงภาพ (timeout)'));
      }
    }, timeoutMs + 3000);

    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(killTimer);
      reject(err);
    });
    proc.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(killTimer);
      const buf = Buffer.concat(chunks);
      if (code === 0 && buf.length > 0) {
        resolve(buf);
      } else {
        reject(new Error(stderr.trim().slice(-500) || 'ดึงภาพไม่สำเร็จ'));
      }
    });
  });
}

app.get('/api/cameras/:id/snapshot', async (req, res) => {
  const cam = findCamera(req.params.id);
  if (!cam) return res.status(404).json({ success: false, message: 'ไม่พบกล้องนี้' });
  if (cam.mode === 'ftp') {
    const jpeg = lastFtpSnapshotByCamera.get(cam.id);
    if (!jpeg) return res.status(503).json({ success: false, message: 'ยังไม่มีภาพจากกล้องนี้ — รอกล้อง push เข้ามาก่อน' });
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-store');
    return res.send(jpeg);
  }
  try {
    const jpeg = await captureSnapshot(cam.url, 8000);
    cam.status = 'live';
    await upsertCameraRow(cam).catch((err) => console.error('[camera] persist status failed:', err.message));
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-store');
    res.send(jpeg);
  } catch (err) {
    cam.status = 'disconnect';
    await upsertCameraRow(cam).catch((e) => console.error('[camera] persist status failed:', e.message));
    res.status(502).json({ success: false, message: 'ดึงภาพจากกล้องไม่สำเร็จ', raw: err.message });
  }
});

// Ad-hoc snapshot from a raw URL (not saved) — ใช้ตอนดูภาพก่อนกดบันทึกกล้องใหม่
app.get('/api/snapshot', async (req, res) => {
  const url = req.query.url;
  if (!url || !isLikelyRtspUrl(url)) {
    return res.status(400).json({ success: false, message: 'ต้องระบุ url ที่ถูกต้อง (rtsp://...)' });
  }
  try {
    const jpeg = await captureSnapshot(url, 8000);
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-store');
    res.send(jpeg);
  } catch (err) {
    res.status(502).json({ success: false, message: 'ดึงภาพจากกล้องไม่สำเร็จ', raw: err.message });
  }
});

/* =========================================================
   LIVE STREAM — MJPEG (multipart/x-mixed-replace)
   ใช้ตรงกับ <img src="/api/cameras/:id/stream"> ได้เลย เห็นภาพสดจริง
========================================================= */
const activeStreamCleanups = new Set();

function startMjpegStream(url, res, { fps = 6, width = 960 } = {}) {
  const args = [
    '-rtsp_transport', 'tcp',
    '-i', url,
    '-an',
    '-f', 'mpjpeg',
    '-q:v', '6',
    '-r', String(fps),
    '-vf', `scale=${width}:-2`,
    'pipe:1',
  ];
  const proc = spawn('ffmpeg', args);

  res.set('Content-Type', 'multipart/x-mixed-replace;boundary=ffmpeg');
  res.set('Cache-Control', 'no-store');

  proc.stdout.pipe(res);

  let stderr = '';
  proc.stderr.on('data', (d) => {
    stderr += d.toString();
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });

  const cleanup = () => {
    activeStreamCleanups.delete(cleanup);
    if (!proc.killed) proc.kill('SIGKILL');
  };
  activeStreamCleanups.add(cleanup);

  proc.on('close', () => {
    if (!res.headersSent) {
      res.status(502).json({ success: false, message: 'ไม่สามารถเปิดสตรีมได้', raw: stderr.trim().slice(-500) });
    } else {
      res.end();
    }
  });
  proc.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({ success: false, message: 'ไม่สามารถรัน ffmpeg ได้', raw: err.message });
    } else {
      res.end();
    }
  });

  // ปิด ffmpeg ทันทีเมื่อฝั่ง client ตัดการเชื่อมต่อ (ปิดแท็บ/เปลี่ยนหน้า)
  res.on('close', cleanup);
  return cleanup;
}

app.get('/api/cameras/:id/stream', (req, res) => {
  const cam = findCamera(req.params.id);
  if (!cam) return res.status(404).json({ success: false, message: 'ไม่พบกล้องนี้' });
  const fps = Math.min(Math.max(Number(req.query.fps) || 6, 1), 15);
  const width = Math.min(Math.max(Number(req.query.width) || 960, 320), 1920);
  startMjpegStream(cam.url, res, { fps, width });
});

/* =========================================================
   Health check
========================================================= */
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Fallback to index.html for SPA-style routing (React app in client/dist)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});

/* =========================================================
   STARTUP — โหลด cache ในหน่วยความจำจาก Postgres ก่อน ค่อยเปิดรับ request
   (runMigrations สร้าง/อัปเดตตารางให้เองก่อนโหลด)
========================================================= */
async function main() {
  try {
    await pool.query('SELECT 1'); // fail fast ถ้าต่อ Postgres ไม่ได้ ดีกว่าเปิด server แล้วพังทีหลัง
    const applied = await runMigrations(pool);
    await pool.query("UPDATE tasks SET timelapse_status='failed' WHERE timelapse_status='building'"); // build ถูกขัดจังหวะโดย restart -> เปิดให้กดสร้างใหม่ (ไม่ค้างที่ 'กำลังสร้าง' ตลอดไป)
    if (applied.length) console.log(`[migrate] applied: ${applied.join(', ')}`);
    [cameras, tasks, brickTypes, roles, users, workersMaster, alertConfig, storageConfig] = await Promise.all([
      loadCamerasFromDB(),
      loadTasksFromDB(),
      loadBrickTypesFromDB(),
      loadRolesFromDB(),
      loadUsersFromDB(),
      loadWorkersFromDB(),
      loadAlertConfigFromDB(),
      loadStorageConfigFromDB(),
    ]);
  } catch (err) {
    console.error('FATAL: could not connect to / load from PostgreSQL:', err.message);
    process.exit(1);
  }

  setInterval(() => { appendTaskHistorySnapshot().catch((err) => console.error('[history] tick failed:', err.message)); }, HISTORY_SNAPSHOT_INTERVAL_MS);
  setInterval(sweepOldSnapshots, 60 * 60 * 1000); // เช็คทุก 1 ชั่วโมง
  setTimeout(sweepOldSnapshots, 30 * 1000); // ไล่เก็บตกหลัง restart/หยุดนาน ไม่รอถึงรอบชั่วโมงถัดไป
  setInterval(() => auth.sweepExpired().catch(() => {}), 60 * 60 * 1000);
  setInterval(() => { createBackupFile().then((b) => audit('snapshot', 'info', `สำรองฐานข้อมูลอัตโนมัติ ${b.filename}`)).catch((err) => audit('error', 'error', `สำรองฐานข้อมูลอัตโนมัติไม่สำเร็จ: ${err.message}`)); }, 24 * 60 * 60 * 1000);
  setInterval(autoDetectTick, AUTO_DETECT_TICK_MS);
  setInterval(() => imageWatchTick().catch((err) => console.error('[watch] tick failed:', err.message)), 5 * 1000);
  scheduleTick().catch((err) => console.error('[schedule] first tick failed:', err.message));
  setInterval(() => scheduleTick().catch((err) => console.error('[schedule] tick failed:', err.message)), 15 * 1000);

  try {
    await ftpServer.listen();
    console.log(`FTP ingest: listening on port ${FTP_PORT}${FTP_PASV_URL ? ` (pasv_url=${FTP_PASV_URL})` : ' (WARNING: FTP_PASV_URL not set — cameras from outside this host cannot connect in passive mode)'}`);
  } catch (err) {
    console.error('FTP ingest server failed to start:', err.message);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CIVIL server running on port ${PORT}`);
    console.log(`Cameras API:   GET/POST/PUT/DELETE  /api/cameras`);
    console.log(`Test RTSP:     POST /api/test-rtsp  { "url": "rtsp://..." }`);
    console.log(`Snapshot:      GET  /api/cameras/:id/snapshot`);
    console.log(`Live stream:   GET  /api/cameras/:id/stream`);
    console.log(`Brick types:   GET/POST/PUT/DELETE /api/bricktypes`);
    console.log(`Login:         POST /api/login  { "username", "password" } (session cookie)`);
    console.log(`Users:         GET/POST/PUT/DELETE /api/users`);
    console.log(`Roles:         GET/POST/PUT/DELETE /api/roles`);
    console.log(`AI Detect:     POST /api/tasks/:id/detect  (proxies brick model + person model to ${YOLO_SERVICE_URL})`);
    console.log(`Auto Detect:   continuous realtime loop (tick ${AUTO_DETECT_TICK_MS}ms) for every running task with camera + ROI`);
    console.log(`Task History:  GET  /api/tasks/:id/history?from=&to=&limit=  (snapshot every ${HISTORY_SNAPSHOT_INTERVAL_MS}ms per running task)`);
    console.log(`Time-lapse:    POST /api/tasks/:id/timelapse/build , GET /api/tasks/:id/timelapse (download mp4, or ?format=gif; auto-built when task finishes)`);
    console.log(`Workers:       GET/POST/PUT/DELETE /api/workers`);
    console.log(`Alerts:        GET/PUT /api/alertconfig , POST /api/alerts/test (real Discord webhook)`);
    console.log(`Storage:       GET/PUT /api/storage , POST /api/storage/backup (real disk usage + pg_dump backup, daily auto)`);
    console.log(`FTP ingest:    camera.mode='ftp' cameras push snapshots via FTP/SFTP client to port ${FTP_PORT} instead of server pulling RTSP`);
    console.log(`Postgres:      ${process.env.DATABASE_URL ? 'via DATABASE_URL' : `${process.env.PGHOST || '127.0.0.1'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'civil'}`}`);
  });
}

main();

process.on('SIGINT', () => {
  activeStreamCleanups.forEach((fn) => fn());
  process.exit(0);
});
