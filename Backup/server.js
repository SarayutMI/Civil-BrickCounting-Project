/**
 * CIVIL — AI Brick Construction Monitoring
 * Full backend server
 *
 * ทำไมต้องมี backend:
 * เบราว์เซอร์เชื่อมต่อ RTSP โดยตรงไม่ได้ (ไม่ใช่โปรโตคอลของเว็บ) จึงให้ backend นี้
 * เป็นตัวกลางที่คุยกับกล้อง RTSP จริงแทน แล้วส่งผลลัพธ์/ภาพกลับมาที่หน้าเว็บผ่าน HTTP
 *
 * FEATURES:
 * 1) CRUD กล้อง (เพิ่ม/แก้ไข/ลบ/เลือก) — เก็บลงไฟล์ cameras.json (persist ข้ามการรีสตาร์ท)
 * 2) ทดสอบการเชื่อมต่อ RTSP จริงด้วย ffprobe (เหมือนเดิม)
 * 3) ดึงภาพนิ่ง (snapshot) จากกล้องจริงด้วย ffmpeg
 * 4) สตรีมภาพสด (MJPEG) จากกล้องจริงด้วย ffmpeg -f mpjpeg แล้วฝังใน <img> ได้ตรง ๆ
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'cameras.json');
const TASKS_FILE = path.join(__dirname, 'tasks.json');
const BRICKTYPES_FILE = path.join(__dirname, 'brickTypes.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const ROLES_FILE = path.join(__dirname, 'roles.json');
// ที่อยู่ของ Python microservice ที่รัน YOLOv11 (ดู yolo_service.py)
const YOLO_SERVICE_URL = process.env.YOLO_SERVICE_URL || 'http://127.0.0.1:8000';

app.use(express.json());
app.use(express.static(path.join(__dirname))); // serve index.html, app.js, style.css

/* =========================================================
   PERSISTENCE — cameras.json
========================================================= */
function loadCameras() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}
function saveCameras(camerasList) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(camerasList, null, 2), 'utf-8');
}
let cameras = loadCameras();

/* =========================================================
   PERSISTENCE — tasks.json
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
function loadTasks() {
  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (_) {
    // First run — seed with default demo tasks so the UI isn't empty, then persist.
    fs.writeFileSync(TASKS_FILE, JSON.stringify(DEFAULT_TASKS, null, 2), 'utf-8');
    return DEFAULT_TASKS.slice();
  }
}
function saveTasks(taskList) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(taskList, null, 2), 'utf-8');
}
let tasks = loadTasks();
function findTask(id) {
  return tasks.find((t) => t.id === id);
}

/* =========================================================
   PERSISTENCE — brickTypes.json
   blocksPerSqm = อิฐ/บล็อกกี่ก้อน เท่ากับพื้นที่ 1 ตารางเมตร (ผู้ใช้กำหนดเองผ่าน UI)
========================================================= */
const DEFAULT_BRICK_TYPES = [
  { id: 'bt1', name: 'อิฐบล็อก', blocksPerSqm: 12.5 },
  { id: 'bt2', name: 'อิฐมวลเบา', blocksPerSqm: 8.3 },
  { id: 'bt3', name: 'อิฐมอญ', blocksPerSqm: 80 },
];
function loadBrickTypes() {
  try {
    const raw = fs.readFileSync(BRICKTYPES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    // รองรับไฟล์เก่าที่ยังไม่มี blocksPerSqm
    return parsed.map((b) => ({ blocksPerSqm: 12.5, ...b }));
  } catch (_) {
    fs.writeFileSync(BRICKTYPES_FILE, JSON.stringify(DEFAULT_BRICK_TYPES, null, 2), 'utf-8');
    return DEFAULT_BRICK_TYPES.slice();
  }
}
function saveBrickTypes(list) {
  fs.writeFileSync(BRICKTYPES_FILE, JSON.stringify(list, null, 2), 'utf-8');
}
let brickTypes = loadBrickTypes();
function findBrickType(id) {
  return brickTypes.find((b) => b.id === id);
}

/* =========================================================
   PERSISTENCE — roles.json (สิทธิ์การเข้าถึงแต่ละเมนู/หน้า)
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
function loadRoles() {
  try {
    const raw = fs.readFileSync(ROLES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    // รองรับไฟล์เก่าที่ยังไม่มี flag locked บน role พื้นฐาน
    return parsed.map((r) => (LOCKED_ROLE_IDS.has(r.id) ? { ...r, locked: true } : r));
  } catch (_) {
    fs.writeFileSync(ROLES_FILE, JSON.stringify(DEFAULT_ROLES, null, 2), 'utf-8');
    return DEFAULT_ROLES.slice();
  }
}
function saveRoles(list) {
  fs.writeFileSync(ROLES_FILE, JSON.stringify(list, null, 2), 'utf-8');
}
let roles = loadRoles();
function findRole(id) {
  return roles.find((r) => r.id === id);
}
function findRoleByName(name) {
  return roles.find((r) => r.name.toLowerCase() === String(name || '').toLowerCase());
}

/* =========================================================
   PERSISTENCE — users.json (บัญชีผู้ใช้งาน + ใช้ login เข้าระบบ)
   หมายเหตุ: เป็นระบบ mockup — เก็บรหัสผ่านแบบ plain text ในไฟล์ local เท่านั้น
   ไม่เหมาะกับ production จริง (ควร hash และใช้ session/JWT ที่ปลอดภัยกว่านี้)
========================================================= */
const DEFAULT_USERS = [
  { id: 'u1', name: 'Admin User', email: 'admin@civil.co', username: 'admin', password: 'password', role: 'Admin' },
  { id: 'u2', name: 'วิศวกร กิจงาน', email: 'engineer@civil.co', username: 'engineer', password: 'password', role: 'Engineer' },
  { id: 'u3', name: 'ผู้บริหาร ดูงาน', email: 'viewer@civil.co', username: 'viewer', password: 'password', role: 'Viewer' },
];
function loadUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (_) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(DEFAULT_USERS, null, 2), 'utf-8');
    return DEFAULT_USERS.slice();
  }
}
function saveUsers(list) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2), 'utf-8');
}
let users = loadUsers();
function findUser(id) {
  return users.find((u) => u.id === id);
}
function publicUser(u) {
  const { password, ...pub } = u;
  return pub;
}

/* =========================================================
   HELPERS
========================================================= */
function isLikelyRtspUrl(url) {
  return typeof url === 'string' && /^rtsps?:\/\/\S+$/i.test(url.trim());
}
function findCamera(id) {
  return cameras.find((c) => c.id === id);
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

app.post('/api/cameras', (req, res) => {
  const { name, url, zone } = req.body || {};
  if (!name || !url) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อและ URL ของกล้อง' });
  }
  if (!isLikelyRtspUrl(url)) {
    return res.status(400).json({ success: false, message: 'URL ต้องขึ้นต้นด้วย rtsp:// หรือ rtsps://' });
  }
  const cam = {
    id: crypto.randomUUID(),
    name: name.trim(),
    url: url.trim(),
    zone: (zone || '').trim(),
    status: 'unknown',
    createdAt: new Date().toISOString(),
  };
  cameras.push(cam);
  saveCameras(cameras);
  res.status(201).json(cam);
});

app.put('/api/cameras/:id', (req, res) => {
  const cam = findCamera(req.params.id);
  if (!cam) return res.status(404).json({ success: false, message: 'ไม่พบกล้องนี้' });
  const { name, url, zone } = req.body || {};
  if (url && !isLikelyRtspUrl(url)) {
    return res.status(400).json({ success: false, message: 'URL ต้องขึ้นต้นด้วย rtsp:// หรือ rtsps://' });
  }
  if (name) cam.name = name.trim();
  if (url) cam.url = url.trim();
  if (zone !== undefined) cam.zone = zone.trim();
  saveCameras(cameras);
  res.json(cam);
});

app.delete('/api/cameras/:id', (req, res) => {
  const idx = cameras.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'ไม่พบกล้องนี้' });
  cameras.splice(idx, 1);
  saveCameras(cameras);
  res.json({ success: true });
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

app.post('/api/tasks', (req, res) => {
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
  tasks.push(task);
  saveTasks(tasks);
  res.status(201).json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const t = findTask(req.params.id);
  if (!t) return res.status(404).json({ success: false, message: 'ไม่พบ Task นี้' });
  const body = req.body || {};
  const editable = [
    'name', 'zone', 'brickType', 'status', 'workers', 'area', 'expectedArea',
    'blocks', 'cameraStatus', 'lastUpdate', 'confidence', 'snapshotInterval',
    'cameraId', 'schedule', 'roi', 'progressSeries',
  ];
  editable.forEach((key) => {
    if (body[key] !== undefined) t[key] = body[key];
  });
  saveTasks(tasks);
  res.json(t);
});

app.delete('/api/tasks/:id', (req, res) => {
  const idx = tasks.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'ไม่พบ Task นี้' });
  tasks.splice(idx, 1);
  saveTasks(tasks);
  res.json({ success: true });
});

/* =========================================================
   BRICK TYPE CRUD API  (ผู้ใช้กำหนด blocksPerSqm เองผ่าน Settings > Brick Types)
========================================================= */
app.get('/api/bricktypes', (req, res) => res.json(brickTypes));

app.post('/api/bricktypes', (req, res) => {
  const { name, blocksPerSqm } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อประเภทอิฐ' });
  const ratio = Number(blocksPerSqm);
  if (!ratio || ratio <= 0) return res.status(400).json({ success: false, message: 'กรุณากรอกจำนวนบล็อกต่อตารางเมตรให้ถูกต้อง' });
  const bt = { id: 'bt' + crypto.randomUUID().slice(0, 8), name: name.trim(), blocksPerSqm: ratio };
  brickTypes.push(bt);
  saveBrickTypes(brickTypes);
  res.status(201).json(bt);
});

app.put('/api/bricktypes/:id', (req, res) => {
  const bt = findBrickType(req.params.id);
  if (!bt) return res.status(404).json({ success: false, message: 'ไม่พบประเภทอิฐนี้' });
  const { name, blocksPerSqm } = req.body || {};
  if (name !== undefined) bt.name = String(name).trim();
  if (blocksPerSqm !== undefined) {
    const ratio = Number(blocksPerSqm);
    if (!ratio || ratio <= 0) return res.status(400).json({ success: false, message: 'จำนวนบล็อกต่อตารางเมตรต้องมากกว่า 0' });
    bt.blocksPerSqm = ratio;
  }
  saveBrickTypes(brickTypes);
  res.json(bt);
});

app.delete('/api/bricktypes/:id', (req, res) => {
  const idx = brickTypes.findIndex((b) => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'ไม่พบประเภทอิฐนี้' });
  brickTypes.splice(idx, 1);
  saveBrickTypes(brickTypes);
  res.json({ success: true });
});

/* =========================================================
   AUTH — LOGIN (mockup: ตรวจ username/password ตรงกับ users.json)
   ไม่มี session/JWT จริง — ฝั่งหน้าเว็บเก็บ user object ไว้ใน localStorage เอง
========================================================= */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'กรุณากรอก username และ password' });
  }
  const user = users.find(
    (u) => u.username.toLowerCase() === String(username).trim().toLowerCase() && u.password === password
  );
  if (!user) {
    return res.status(401).json({ success: false, message: 'username หรือ password ไม่ถูกต้อง' });
  }
  res.json({ success: true, user: publicUser(user) });
});

/* =========================================================
   USER CRUD API — ผู้ใช้งานระบบ + ใช้สำหรับ login
========================================================= */
app.get('/api/users', (req, res) => res.json(users.map(publicUser)));

app.post('/api/users', (req, res) => {
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
    password,
    role,
  };
  users.push(user);
  saveUsers(users);
  res.status(201).json(publicUser(user));
});

app.put('/api/users/:id', (req, res) => {
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
  if (password) u.password = password;
  if (role !== undefined) u.role = role;
  saveUsers(users);
  res.json(publicUser(u));
});

app.delete('/api/users/:id', (req, res) => {
  const idx = users.findIndex((u) => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งานนี้' });
  if (users.length <= 1) return res.status(400).json({ success: false, message: 'ต้องมีผู้ใช้งานอย่างน้อย 1 คนในระบบ' });
  users.splice(idx, 1);
  saveUsers(users);
  res.json({ success: true });
});

/* =========================================================
   ROLE API — Role คงที่ 3 แบบ (Admin/Engineer/Viewer) เท่านั้น
   แก้ได้แค่ permissions ของแต่ละ Role — เพิ่ม/ลบ/เปลี่ยนชื่อ Role ไม่ได้
========================================================= */
app.get('/api/roles', (req, res) => res.json(roles));

app.post('/api/roles', (req, res) => {
  res.status(403).json({ success: false, message: 'ระบบนี้มี Role คงที่ 3 แบบ (Admin/Engineer/Viewer) ไม่สามารถเพิ่ม Role ใหม่ได้' });
});

app.put('/api/roles/:id', (req, res) => {
  const r = findRole(req.params.id);
  if (!r) return res.status(404).json({ success: false, message: 'ไม่พบ Role นี้' });
  const { name, permissions } = req.body || {};
  if (name !== undefined && name.trim() !== r.name) {
    return res.status(400).json({ success: false, message: 'Role พื้นฐานนี้ถูกล็อกไว้ แก้ชื่อไม่ได้' });
  }
  if (permissions !== undefined) r.permissions = { ...r.permissions, ...permissions };
  saveRoles(roles);
  res.json(r);
});

app.delete('/api/roles/:id', (req, res) => {
  const r = findRole(req.params.id);
  if (!r) return res.status(404).json({ success: false, message: 'ไม่พบ Role นี้' });
  res.status(403).json({ success: false, message: 'Role พื้นฐานนี้ถูกล็อกไว้ ลบไม่ได้' });
});

/* =========================================================
   AI DETECTION — YOLOv11 (proxy ไปที่ yolo_service.py)
   ดึง snapshot จากกล้องของ Task -> ส่งไปให้ Python รัน YOLOv11
   -> ได้จำนวนบล็อกที่อยู่ใน ROI (นับจาก centroid) -> แปลงเป็นตารางเมตร
   ตามอัตราส่วน blocksPerSqm ของประเภทอิฐที่ Task นั้นใช้ -> อัปเดต task แล้ว persist
========================================================= */
async function runDetectionForTask(t) {
  if (!t.cameraId) return { success: false, status: 400, message: 'Task นี้ยังไม่ได้เลือกกล้อง' };
  const cam = findCamera(t.cameraId);
  if (!cam) return { success: false, status: 400, message: 'ไม่พบกล้องที่ผูกกับ Task นี้' };
  const bt = findBrickType(t.brickType);
  if (!bt) return { success: false, status: 400, message: 'ไม่พบประเภทอิฐของ Task นี้ — ตั้งค่าใน Settings > Brick Types' };
  if (!t.roi || t.roi.length < 3) {
    return { success: false, status: 400, message: 'กรุณาวาด ROI ของ Task นี้ก่อนเริ่มตรวจจับ' };
  }

  try {
    const jpeg = await captureSnapshot(cam.url, 8000);
    const imageBase64 = jpeg.toString('base64');

    const yoloRes = await fetch(`${YOLO_SERVICE_URL}/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: imageBase64,
        roi: t.roi,
        blocks_per_sqm: bt.blocksPerSqm,
        confidence: (t.confidence || 75) / 100,
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

    // อัปเดตผลลัพธ์ AI กลับเข้า Task แล้ว persist ลง tasks.json
    t.blocks = result.blocks_in_roi;
    t.area = result.area_m2;
    t.cameraStatus = 'live';
    t.lastUpdate = 'เพิ่งตรวจจับ (AI)';
    saveTasks(tasks);
    // เก็บ bbox ล่าสุดไว้ใน memory (ไม่ persist ลงไฟล์ เพราะอัปเดตถี่มากตอน realtime)
    lastDetections.set(t.id, {
      detections: result.detections,
      image_width: result.image_width,
      image_height: result.image_height,
      at: Date.now(),
    });

    return { success: true, task: t, detection: result };
  } catch (err) {
    t.cameraStatus = 'disconnect';
    saveTasks(tasks);
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
const AUTO_DETECT_TICK_MS = 1000;
const lastDetections = new Map(); // taskId -> { detections, image_width, image_height, at }
const inFlightDetections = new Set(); // taskId ที่กำลังตรวจจับอยู่ (กันซ้อนรอบ)

function autoDetectTick() {
  tasks.forEach((t) => {
    if (t.status !== 'running') return;
    if (!t.cameraId) return;
    if (!t.roi || t.roi.length < 3) return;
    if (inFlightDetections.has(t.id)) return; // รอบก่อนหน้ายังไม่เสร็จ ข้ามไปก่อน
    inFlightDetections.add(t.id);
    runDetectionForTask(t).finally(() => inFlightDetections.delete(t.id));
  });
}
setInterval(autoDetectTick, AUTO_DETECT_TICK_MS);

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
  saveCameras(cameras);
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
    saveCameras(cameras);
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-store');
    res.send(jpeg);
  } catch (err) {
    cam.status = 'disconnect';
    saveCameras(cameras);
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

// Fallback to index.html for SPA-style routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

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
  console.log(`AI Detect:     POST /api/tasks/:id/detect  (proxies to ${YOLO_SERVICE_URL})`);
  console.log(`Auto Detect:   continuous realtime loop (tick ${AUTO_DETECT_TICK_MS}ms) for every running task with camera + ROI`);
});

process.on('SIGINT', () => {
  activeStreamCleanups.forEach((fn) => fn());
  process.exit(0);
});
