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
 * ตอนนี้ย้ายมาใช้ PostgreSQL แล้ว (ดู db.js + sql/schema.sql + migrate.js) แต่ยังคง
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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'client', 'dist'))); // serve the built React SPA (client/dist)
app.use('/snapshots', express.static(SNAPSHOTS_DIR));

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
const DEFAULT_TASKS = [
  {
    id: 't1', name: 'อาคาร A ชั้น 1 — ผนังด้านทิศเหนือ', zone: 'Zone A1', brickType: 'bt1',
    status: 'running', workers: ['w1', 'w2', 'w3'], area: 118, expectedArea: 200, blocks: 1450,
    cameraStatus: 'live', lastUpdate: '2 นาทีที่แล้ว', confidence: 75, snapshotInterval: 30, cameraId: null,
    schedule: { start: '08:00', breakStart: '12:00', breakEnd: '13:00', end: '17:00' },
    roi: [[0.18, 0.2], [0.82, 0.18], [0.86, 0.78], [0.14, 0.82]],
    progressSeries: [8, 15, 24, 30, 38, 47, 55, 60],
  },
  {
    id: 't2', name: 'อาคาร A ชั้น 2 — ผนังด้านทิศใต้', zone: 'Zone A2', brickType: 'bt2',
    status: 'pause', workers: ['w4'], area: 64, expectedArea: 180, blocks: 780,
    cameraStatus: 'connecting', lastUpdate: '14 นาทีที่แล้ว', confidence: 70, snapshotInterval: 30, cameraId: null,
    schedule: { start: '08:00', breakStart: '12:00', breakEnd: '13:00', end: '17:00' },
    roi: [], progressSeries: [5, 10, 14, 20, 26, 30, 33, 36],
  },
  {
    id: 't3', name: 'อาคาร B ชั้น 1 — เสาและผนังรับน้ำหนัก', zone: 'Zone B1', brickType: 'bt3',
    status: 'running', workers: ['w5', 'w6'], area: 150, expectedArea: 210, blocks: 1980,
    cameraStatus: 'live', lastUpdate: 'ไม่ถึงนาทีที่แล้ว', confidence: 80, snapshotInterval: 15, cameraId: null,
    schedule: { start: '07:30', breakStart: '12:00', breakEnd: '13:00', end: '16:30' },
    roi: [[0.12, 0.15], [0.88, 0.15], [0.88, 0.85], [0.12, 0.85]],
    progressSeries: [10, 22, 33, 44, 52, 60, 66, 71],
  },
  {
    id: 't4', name: 'อาคาร B ชั้น 2 — ผนังกั้นห้อง', zone: 'Zone B2', brickType: 'bt1',
    status: 'finished', workers: ['w1'], area: 96, expectedArea: 96, blocks: 1120,
    cameraStatus: 'disconnect', lastUpdate: '2 วันที่แล้ว', confidence: 75, snapshotInterval: 30, cameraId: null,
    schedule: { start: '08:00', breakStart: '12:00', breakEnd: '13:00', end: '17:00' },
    roi: [], progressSeries: [20, 40, 55, 68, 80, 90, 96, 100],
  },
  {
    id: 't5', name: 'อาคาร C ชั้น 1 — ผนังด้านหน้า', zone: 'Zone C1', brickType: 'bt2',
    status: 'running', workers: ['w2', 'w3', 'w4'], area: 40, expectedArea: 160, blocks: 410,
    cameraStatus: 'live', lastUpdate: '5 นาทีที่แล้ว', confidence: 72, snapshotInterval: 30, cameraId: null,
    schedule: { start: '08:00', breakStart: '12:00', breakEnd: '13:00', end: '17:00' },
    roi: [], progressSeries: [3, 7, 11, 15, 19, 22, 24, 25],
  },
  {
    id: 't6', name: 'อาคาร C ชั้น 2 — ผนังกันไฟ', zone: 'Zone C2', brickType: 'bt3',
    status: 'finished', workers: ['w5'], area: 110, expectedArea: 110, blocks: 1340,
    cameraStatus: 'disconnect', lastUpdate: '5 วันที่แล้ว', confidence: 75, snapshotInterval: 30, cameraId: null,
    schedule: { start: '08:00', breakStart: '12:00', breakEnd: '13:00', end: '17:00' },
    roi: [], progressSeries: [15, 35, 50, 65, 78, 88, 95, 100],
  },
];
const TASK_KNOWN_KEYS = new Set([
  'id', 'name', 'zone', 'brickType', 'status', 'workers', 'area', 'expectedArea',
  'blocks', 'peopleDetected', 'cameraStatus', 'lastUpdate', 'confidence',
  'snapshotInterval', 'cameraId', 'schedule', 'roi', 'progressSeries',
  'createdAt', 'timelapseStatus',
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
  return { ...obj, ...(row.extra || {}) };
}
async function loadTasksFromDB() {
  const { rows: countRows } = await pool.query('SELECT count(*)::int AS n FROM tasks');
  if (countRows[0].n === 0) {
    // First run on an empty DB — seed with default demo tasks so the UI isn't empty.
    for (const t of DEFAULT_TASKS) await upsertTaskRow(t);
  }
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
       camera_id, schedule, roi, progress_series, created_at, timelapse_status, extra
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name, zone=EXCLUDED.zone, brick_type=EXCLUDED.brick_type, status=EXCLUDED.status,
       workers=EXCLUDED.workers, area=EXCLUDED.area, expected_area=EXCLUDED.expected_area,
       blocks=EXCLUDED.blocks, people_detected=EXCLUDED.people_detected, camera_status=EXCLUDED.camera_status,
       last_update=EXCLUDED.last_update, confidence=EXCLUDED.confidence, snapshot_interval=EXCLUDED.snapshot_interval,
       camera_id=EXCLUDED.camera_id, schedule=EXCLUDED.schedule, roi=EXCLUDED.roi,
       progress_series=EXCLUDED.progress_series, created_at=EXCLUDED.created_at,
       timelapse_status=EXCLUDED.timelapse_status, extra=EXCLUDED.extra`,
    [
      t.id, t.name, t.zone || '', t.brickType || null, t.status || 'pause',
      JSON.stringify(Array.isArray(t.workers) ? t.workers : []),
      Number(t.area) || 0, Number(t.expectedArea) || 100, Number(t.blocks) || 0,
      t.peopleDetected === undefined ? null : Number(t.peopleDetected),
      t.cameraStatus || 'disconnect', t.lastUpdate || '', Number(t.confidence) || 75,
      Number(t.snapshotInterval) || 30, t.cameraId || null,
      JSON.stringify(t.schedule || {}), JSON.stringify(Array.isArray(t.roi) ? t.roi : []),
      JSON.stringify(Array.isArray(t.progressSeries) ? t.progressSeries : []),
      t.createdAt || null, t.timelapseStatus || null, JSON.stringify(extra),
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

async function insertTaskHistoryRow(taskId, entry) {
  await pool.query(
    `INSERT INTO task_history (task_id, at, blocks, area, people_detected, workers_assigned, snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [taskId, entry.at, entry.blocks, entry.area, entry.peopleDetected, entry.workersAssigned, entry.snapshot]
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
      `SELECT at, blocks, area, people_detected, workers_assigned, snapshot
       FROM task_history ${where} ORDER BY at DESC LIMIT $${params.length + 1}`,
      [...params, n]
    );
    rows = res.rows.reverse(); // กลับเป็นลำดับเวลาเก่า->ใหม่ เหมือน list.slice(-n) ของเดิม
  } else {
    const res = await pool.query(
      `SELECT at, blocks, area, people_detected, workers_assigned, snapshot
       FROM task_history ${where} ORDER BY at ASC`,
      params
    );
    rows = res.rows;
  }
  return rows.map((r) => ({
    at: r.at.toISOString(), blocks: r.blocks, area: r.area,
    peopleDetected: r.people_detected, workersAssigned: r.workers_assigned,
    snapshot: r.snapshot || null,
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
      const files = fs.readdirSync(taskDir).filter((f) => f.endsWith('.jpg')).sort();
      while (files.length > HISTORY_MAX_ENTRIES_PER_TASK) {
        fs.unlinkSync(path.join(taskDir, files.shift()));
      }
    }

    try {
      await insertTaskHistoryRow(t.id, {
        at, blocks: t.blocks, area: t.area, peopleDetected: t.peopleDetected || 0,
        workersAssigned: t.workers.length, snapshot: snapshotUrl,
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
function buildTimelapseForTask(taskId, cb) {
  const dir = path.join(SNAPSHOTS_DIR, taskId);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
  } catch (_) {
    return cb(new Error('ยังไม่มีภาพ snapshot ของ Task นี้'));
  }
  if (files.length === 0) return cb(new Error('ยังไม่มีภาพ snapshot ของ Task นี้'));

  const listLines = files.map((f) => `file '${f}'\nduration 1`);
  listLines.push(`file '${files[files.length - 1]}'`); // ffmpeg concat quirk: เฟรมสุดท้ายต้องมีบรรทัด file ซ้ำโดยไม่ระบุ duration
  fs.writeFileSync(path.join(dir, 'concat.txt'), listLines.join('\n'), 'utf-8');

  const proc = spawn(
    'ffmpeg',
    ['-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-vsync', 'vfr', '-pix_fmt', 'yuv420p', 'timelapse.mp4'],
    { cwd: dir }
  );
  let stderr = '';
  proc.stderr.on('data', (d) => (stderr += d.toString()));
  proc.on('close', (code) => {
    if (code === 0) cb(null, path.join(dir, 'timelapse.mp4'));
    else cb(new Error(stderr.trim().slice(-500) || 'สร้างวิดีโอไทม์แลปส์ไม่สำเร็จ'));
  });
  proc.on('error', (err) => cb(err));
}

/* =========================================================
   PERSISTENCE — brick_types (table: brick_types)
   blocksPerSqm = อิฐ/บล็อกกี่ก้อน เท่ากับพื้นที่ 1 ตารางเมตร (ผู้ใช้กำหนดเองผ่าน UI)
========================================================= */
const DEFAULT_BRICK_TYPES = [
  { id: 'bt1', name: 'อิฐบล็อก', blocksPerSqm: 12.5 },
  { id: 'bt2', name: 'อิฐมวลเบา', blocksPerSqm: 8.3 },
  { id: 'bt3', name: 'อิฐมอญ', blocksPerSqm: 80 },
];
function brickTypeRowToObj(row) {
  return { id: row.id, name: row.name, blocksPerSqm: Number(row.blocks_per_sqm), classId: row.class_id };
}
async function loadBrickTypesFromDB() {
  const { rows: countRows } = await pool.query('SELECT count(*)::int AS n FROM brick_types');
  if (countRows[0].n === 0) {
    for (const b of DEFAULT_BRICK_TYPES) await upsertBrickTypeRow({ ...b, classId: null });
  }
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
// Role คงที่ 3 แบบเท่านั้น (locked: true) — แก้ได้แค่ permissions เพิ่ม/ลบ/เปลี่ยนชื่อไม่ได้
const DEFAULT_ROLES = [
  { id: 'admin', name: 'Admin', locked: true, permissions: allPerms(true) },
  {
    id: 'engineer', name: 'Engineer', locked: true,
    permissions: { home: true, task: true, dashboard: true, reports: true, logs: true, settings: false },
  },
  {
    id: 'viewer', name: 'Viewer', locked: true,
    permissions: { home: true, task: false, dashboard: true, reports: true, logs: false, settings: false },
  },
];
const LOCKED_ROLE_IDS = new Set(['admin', 'engineer', 'viewer']);
function roleRowToObj(row) {
  return { id: row.id, name: row.name, permissions: row.permissions || {}, locked: LOCKED_ROLE_IDS.has(row.id) ? true : row.locked };
}
async function loadRolesFromDB() {
  const { rows: countRows } = await pool.query('SELECT count(*)::int AS n FROM roles');
  if (countRows[0].n === 0) {
    for (const r of DEFAULT_ROLES) await upsertRoleRow(r);
  }
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
   หมายเหตุ: เป็นระบบ mockup — เก็บรหัสผ่านแบบ plain text เหมือนเดิม (ย้ายที่เก็บจากไฟล์ JSON
   มาเป็นตาราง Postgres เฉย ๆ ไม่ได้เพิ่มการเข้ารหัส) ไม่เหมาะกับ production จริง
   (ควร hash และใช้ session/JWT ที่ปลอดภัยกว่านี้)
========================================================= */
const DEFAULT_USERS = [
  { id: 'u1', name: 'Admin User', email: 'admin@civil.co', username: 'admin', password: 'password', role: 'Admin' },
  { id: 'u2', name: 'วิศวกร กิจงาน', email: 'engineer@civil.co', username: 'engineer', password: 'password', role: 'Engineer' },
  { id: 'u3', name: 'ผู้บริหาร ดูงาน', email: 'viewer@civil.co', username: 'viewer', password: 'password', role: 'Viewer' },
];
function userRowToObj(row) {
  return { id: row.id, name: row.name, email: row.email, username: row.username, password: row.password, role: row.role };
}
async function loadUsersFromDB() {
  const { rows: countRows } = await pool.query('SELECT count(*)::int AS n FROM users');
  if (countRows[0].n === 0) {
    for (const u of DEFAULT_USERS) await upsertUserRow(u);
  }
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
// รหัสผ่านเก็บแบบ bcrypt hash ทั้งหมด — ฟังก์ชันนี้ตรวจ/แปลงรหัสผ่าน plaintext เก่า (จาก users.json เดิม
// หรือ DEFAULT_USERS ตอน seed ครั้งแรก) ให้เป็น hash อัตโนมัติตอน boot ครั้งเดียว ไม่ต้องรันสคริปต์แยก
function isBcryptHash(pw) {
  return typeof pw === 'string' && /^\$2[aby]\$\d{2}\$/.test(pw);
}
async function hashLegacyPlaintextPasswords() {
  for (const u of users) {
    if (!isBcryptHash(u.password)) {
      u.password = await bcrypt.hash(u.password, 10);
      await upsertUserRow(u);
    }
  }
}

/* =========================================================
   PERSISTENCE — workers (table: workers) — แรงงาน master list
========================================================= */
const DEFAULT_WORKERS = [
  { id: 'w1', name: 'สมชาย ใจดี', role: 'ช่างก่อสร้าง' },
  { id: 'w2', name: 'ประยุทธ ทองแดง', role: 'ช่างก่อสร้าง' },
  { id: 'w3', name: 'วิชัย รุ่งเรือง', role: 'หัวหน้าช่าง' },
  { id: 'w4', name: 'อนุชา ศรีสุข', role: 'ช่างก่อสร้าง' },
  { id: 'w5', name: 'มานพ พูลสวัสดิ์', role: 'ช่างก่อสร้าง' },
  { id: 'w6', name: 'ธีระ วงศ์สกุล', role: 'ช่างก่อสร้าง' },
];
function workerRowToObj(row) {
  return { id: row.id, name: row.name, role: row.role };
}
async function loadWorkersFromDB() {
  const { rows: countRows } = await pool.query('SELECT count(*)::int AS n FROM workers');
  if (countRows[0].n === 0) {
    for (const w of DEFAULT_WORKERS) await upsertWorkerRow(w);
  }
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
const DEFAULT_ALERT_CONFIG = {
  webhook: '', cameraOffline: true, serverOffline: true, aiStopped: true, internetDown: false, noImage: true,
};
function alertConfigRowToObj(row) {
  return {
    webhook: row.webhook, cameraOffline: row.camera_offline, serverOffline: row.server_offline,
    aiStopped: row.ai_stopped, internetDown: row.internet_down, noImage: row.no_image,
  };
}
async function loadAlertConfigFromDB() {
  const { rows } = await pool.query('SELECT * FROM alert_config WHERE id=1');
  if (rows.length === 0) {
    await saveAlertConfigDB(DEFAULT_ALERT_CONFIG);
    return { ...DEFAULT_ALERT_CONFIG };
  }
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
const DEFAULT_STORAGE_CONFIG = { autoDelete: true, retentionDays: 60 };
function storageConfigRowToObj(row) {
  return { autoDelete: row.auto_delete, retentionDays: row.retention_days };
}
async function loadStorageConfigFromDB() {
  const { rows } = await pool.query('SELECT * FROM storage_config WHERE id=1');
  if (rows.length === 0) {
    await saveStorageConfigDB(DEFAULT_STORAGE_CONFIG);
    return { ...DEFAULT_STORAGE_CONFIG };
  }
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

app.delete('/api/cameras/:id', async (req, res) => {
  const idx = cameras.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'ไม่พบกล้องนี้' });
  try {
    await deleteCameraRow(req.params.id);
    cameras.splice(idx, 1);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ลบกล้องไม่สำเร็จ', raw: err.message });
  }
});

/* =========================================================
   TASK CRUD API
========================================================= */

function withLastDetection(t) {
  return { ...t, lastDetection: lastDetections.get(t.id) || null };
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
    t.timelapseStatus = 'building';
    await upsertTaskRow(t).catch((err) => console.error('[task] persist timelapseStatus failed:', err.message));
    buildTimelapseForTask(t.id, (err) => {
      t.timelapseStatus = err ? 'failed' : 'ready';
      upsertTaskRow(t).catch((e) => console.error('[task] persist timelapseStatus failed:', e.message));
    });
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
  t.timelapseStatus = 'building';
  await upsertTaskRow(t).catch((err) => console.error('[task] persist timelapseStatus failed:', err.message));
  buildTimelapseForTask(t.id, (err) => {
    t.timelapseStatus = err ? 'failed' : 'ready';
    upsertTaskRow(t).catch((e) => console.error('[task] persist timelapseStatus failed:', e.message));
  });
  res.json({ success: true, message: 'กำลังสร้างวิดีโอไทม์แลปส์ (อาจใช้เวลาสักครู่ตามจำนวนภาพ)' });
});

app.get('/api/tasks/:id/timelapse', (req, res) => {
  const t = findTask(req.params.id);
  if (!t) return res.status(404).json({ success: false, message: 'ไม่พบ Task นี้' });
  const file = path.join(SNAPSHOTS_DIR, t.id, 'timelapse.mp4');
  if (!fs.existsSync(file)) {
    return res.status(404).json({ success: false, message: 'ยังไม่มีวิดีโอไทม์แลปส์ของ Task นี้ — ตั้งสถานะเป็น "เสร็จสิ้น" หรือกดสร้างใหม่ก่อน' });
  }
  res.download(file, `${t.name}-timelapse.mp4`);
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
   AUTH — LOGIN (mockup: ตรวจ username/password ตรงกับตาราง users)
   ไม่มี session/JWT จริง — ฝั่งหน้าเว็บเก็บ user object ไว้ใน localStorage เอง
========================================================= */
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'กรุณากรอก username และ password' });
  }
  const user = users.find((u) => u.username.toLowerCase() === String(username).trim().toLowerCase());
  const ok = user && (await bcrypt.compare(password, user.password).catch(() => false));
  if (!ok) {
    return res.status(401).json({ success: false, message: 'username หรือ password ไม่ถูกต้อง' });
  }
  res.json({ success: true, user: publicUser(user) });
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
    res.json(publicUser(u));
  } catch (err) {
    res.status(500).json({ success: false, message: 'บันทึกผู้ใช้งานไม่สำเร็จ', raw: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  const idx = users.findIndex((u) => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งานนี้' });
  if (users.length <= 1) return res.status(400).json({ success: false, message: 'ต้องมีผู้ใช้งานอย่างน้อย 1 คนในระบบ' });
  try {
    await deleteUserRow(req.params.id);
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
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg'));
    } catch (_) {
      return;
    }
    files.forEach((f) => {
      const full = path.join(dir, f);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch (_) {}
    });
  });
}

// สำรองข้อมูล — bundle ข้อมูลหลักจาก Postgres (ไม่รวมภาพ snapshot เพราะอาจใหญ่มาก) เป็น .tar.gz แล้วให้ดาวน์โหลด
// เดิม endpoint นี้ก็อปไฟล์ JSON ตรง ๆ; ตอนนี้ query จาก Postgres มา dump เป็น JSON ชื่อไฟล์เดิมแทน (ฟังก์ชัน/response shape เดิม)
app.post('/api/storage/backup', async (req, res) => {
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stagingDir = path.join(BACKUPS_DIR, `.staging-${stamp}`);
  fs.mkdirSync(stagingDir, { recursive: true });
  try {
    const dumps = {
      'tasks.json': tasks,
      'cameras.json': cameras,
      'users.json': users,
      'roles.json': roles,
      'brickTypes.json': brickTypes,
      'workers.json': workersMaster,
      'alertConfig.json': alertConfig,
      'storageConfig.json': storageConfig,
    };
    // taskHistory.json ยกเว้นการดึงทั้งหมดถ้าใหญ่มาก — ดึงมาเท่าที่มีจริงต่อ task (ตารางนี้โตต่อเนื่องไม่มี cap)
    const taskHistoryDump = {};
    for (const t of tasks) {
      const list = await queryTaskHistory(t.id, {});
      if (list.length) taskHistoryDump[t.id] = list;
    }
    dumps['taskHistory.json'] = taskHistoryDump;

    const filesToBackup = Object.keys(dumps);
    filesToBackup.forEach((f) => {
      fs.writeFileSync(path.join(stagingDir, f), JSON.stringify(dumps[f], null, 2), 'utf-8');
    });

    const filename = `civil-backup-${stamp}.tar.gz`;
    const outPath = path.join(BACKUPS_DIR, filename);
    const proc = spawn('tar', ['-czf', outPath, '-C', stagingDir, ...filesToBackup]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      if (code === 0) {
        res.download(outPath, filename);
      } else {
        res.status(500).json({ success: false, message: 'สำรองข้อมูลไม่สำเร็จ', raw: stderr.trim().slice(-500) });
      }
    });
    proc.on('error', (err) => {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      res.status(500).json({ success: false, message: 'รันคำสั่ง tar ไม่สำเร็จ', raw: err.message });
    });
  } catch (err) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    res.status(500).json({ success: false, message: 'สำรองข้อมูลไม่สำเร็จ', raw: err.message });
  }
});

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

  try {
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
   (ต้องรัน sql/schema.sql ให้ตารางมีอยู่ก่อน — ดู migrate.js สำหรับข้อมูล demo ชุดเดิม)
========================================================= */
async function main() {
  try {
    await pool.query('SELECT 1'); // fail fast ถ้าต่อ Postgres ไม่ได้ ดีกว่าเปิด server แล้วพังทีหลัง
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
    await hashLegacyPlaintextPasswords(); // แปลงรหัสผ่าน plaintext เก่า (ถ้ามี) เป็น bcrypt hash ครั้งเดียวตอน boot
  } catch (err) {
    console.error('FATAL: could not connect to / load from PostgreSQL:', err.message);
    process.exit(1);
  }

  setInterval(() => { appendTaskHistorySnapshot().catch((err) => console.error('[history] tick failed:', err.message)); }, HISTORY_SNAPSHOT_INTERVAL_MS);
  setInterval(sweepOldSnapshots, 60 * 60 * 1000); // เช็คทุก 1 ชั่วโมง
  setInterval(autoDetectTick, AUTO_DETECT_TICK_MS);

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
    console.log(`Login:         POST /api/login  { "username": "admin", "password": "password" }`);
    console.log(`Users:         GET/POST/PUT/DELETE /api/users`);
    console.log(`Roles:         GET/POST/PUT/DELETE /api/roles`);
    console.log(`AI Detect:     POST /api/tasks/:id/detect  (proxies brick model + person model to ${YOLO_SERVICE_URL})`);
    console.log(`Auto Detect:   continuous realtime loop (tick ${AUTO_DETECT_TICK_MS}ms) for every running task with camera + ROI`);
    console.log(`Task History:  GET  /api/tasks/:id/history?from=&to=&limit=  (snapshot every ${HISTORY_SNAPSHOT_INTERVAL_MS}ms per running task)`);
    console.log(`Time-lapse:    POST /api/tasks/:id/timelapse/build , GET /api/tasks/:id/timelapse (download mp4, auto-built when task finishes)`);
    console.log(`Workers:       GET/POST/PUT/DELETE /api/workers`);
    console.log(`Alerts:        GET/PUT /api/alertconfig , POST /api/alerts/test (real Discord webhook)`);
    console.log(`Storage:       GET/PUT /api/storage , POST /api/storage/backup (real disk usage + tar.gz backup)`);
    console.log(`FTP ingest:    camera.mode='ftp' cameras push snapshots via FTP/SFTP client to port ${FTP_PORT} instead of server pulling RTSP`);
    console.log(`Postgres:      ${process.env.DATABASE_URL ? 'via DATABASE_URL' : `${process.env.PGHOST || '127.0.0.1'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'civil'}`}`);
  });
}

main();

process.on('SIGINT', () => {
  activeStreamCleanups.forEach((fn) => fn());
  process.exit(0);
});
