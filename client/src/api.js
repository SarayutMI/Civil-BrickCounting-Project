/* ===================================================================
   CIVIL — API wrappers. One function per backend endpoint (server.js).
   Request/response shapes match server.js exactly — do not change
   without changing server.js too.
=================================================================== */

// Any 401 from the API means the server-side session ended — tell App to show the login page.
// (login itself legitimately returns 401 for a wrong password, so it is excluded.)
const rawFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const res = await rawFetch(input, init);
  const url = typeof input === 'string' ? input : input.url;
  if (res.status === 401 && url.startsWith('/api/') && url !== '/api/login' && url !== '/api/me') {
    window.dispatchEvent(new Event('civil:unauthorized'));
  }
  if (res.status === 423) window.dispatchEvent(new Event('civil:tasks-changed'));
  return res;
};

async function asJson(res) {
  try { return await res.json(); } catch (_) { return {}; }
}

export async function setTaskLock(id, locked) {
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/lock`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locked }),
  });
  return { ok: res.ok, data: await asJson(res) };
}

/* ---------------- AUTH ---------------- */
export async function login(username, password) {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await asJson(res);
  return { ok: res.ok, data };
}

export async function me() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return null;
    return (await res.json()).user || null;
  } catch (_) {
    return null;
  }
}
export async function logout() {
  try { await fetch('/api/logout', { method: 'POST' }); } catch (_) { /* session cookie expires on its own */ }
}
// Device Monitor: ESP32 telemetry + server / AI / Discord health (server.js GET /api/devices)
export async function getDevices() {
  try {
    const res = await fetch('/api/devices');
    return res.ok ? res.json() : null;
  } catch (_) {
    return null;
  }
}
export async function getLogs(limit = 500) {
  const res = await fetch(`/api/logs?limit=${limit}`);
  return res.ok ? res.json() : [];
}

/* ---------------- TASKS ---------------- */
export async function getTasks() {
  const res = await fetch('/api/tasks');
  return res.json();
}
export async function getTask(id) {
  const res = await fetch(`/api/tasks/${id}`);
  if (!res.ok) return null;
  return res.json();
}
export async function createTask(body) {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await asJson(res);
  return { ok: res.ok, data };
}
export async function patchTask(id, partial) {
  const res = await fetch(`/api/tasks/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  });
  const data = await asJson(res);
  return { ok: res.ok, data };
}
export async function deleteTask(id) {
  const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
  const data = await asJson(res);
  return { ok: res.ok, data };
}
// Use one corrected ROI on every saved frame of a task (roi: null = back to the AI ROI).
export async function applyLabelRoi(taskId, roi) {
  const res = await fetch(`/api/tasks/${taskId}/label-frames/apply-roi`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roi }) });
  return { ok: res.ok, data: await asJson(res) };
}
// Copy a task with its settings + full history (images, AI boxes, human labels) — the copy has no camera.
export async function duplicateTask(id, name) {
  const res = await fetch(`/api/tasks/${id}/duplicate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  return { ok: res.ok, data: await asJson(res) };
}
// Delete a task's history, images and labels (settings stay). confirmName must equal the task name.
export async function clearTaskData(id, confirmName) {
  const res = await fetch(`/api/tasks/${id}/clear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmName }) });
  return { ok: res.ok, data: await asJson(res) };
}
// detections=true also returns each minute's AI boxes (Timeline "AI Label" view) — heavier, so opt-in.
export async function getTaskHistory(id, { from, to, limit, detections } = {}) {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (limit) qs.set('limit', limit);
  if (detections) qs.set('detections', '1');
  const q = qs.toString();
  const res = await fetch(`/api/tasks/${id}/history${q ? `?${q}` : ''}`);
  if (!res.ok) return [];
  return res.json();
}
// Productivity (P = Q / (N x T), % vs standard, durations) for every task — see productivity.js
/* ---------------- HUMAN-IN-THE-LOOP LABEL REVIEW ---------------- */
export async function getLabelFrames(taskId) {
  const res = await fetch(`/api/tasks/${taskId}/label-frames`);
  return res.ok ? res.json() : [];
}
export async function getLabelFrame(taskId, frameId) {
  const res = await fetch(`/api/tasks/${taskId}/label-frames/${frameId}`);
  return res.ok ? res.json() : null;
}
// body: { added, removed, note } or { clear: true }
export async function saveLabelFrame(taskId, frameId, body) {
  const res = await fetch(`/api/tasks/${taskId}/label-frames/${frameId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await asJson(res);
  return { ok: res.ok, data };
}
// ทำเครื่องหมายตรวจแล้ว (ใช้ผล AI ตามเดิม) — ids = ภาพที่เลือก, ไม่ส่ง = ทุกภาพที่ยังไม่ตรวจ
export async function markLabelFramesReviewed(taskId, ids) {
  const res = await fetch(`/api/tasks/${taskId}/label-frames/mark-reviewed`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ids ? { ids } : {}),
  });
  const data = await asJson(res);
  return { ok: res.ok, data };
}
// ตัดภาพออกจากการนับ (excluded: true, reason) หรือกู้คืน (excluded: false) — หลายภาพพร้อมกันได้
export async function excludeLabelFrames(taskId, ids, excluded, reason) {
  const res = await fetch(`/api/tasks/${taskId}/label-frames/exclude`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, excluded, reason }),
  });
  const data = await asJson(res);
  return { ok: res.ok, data };
}
// ลบภาพที่ตัดออกแล้วทิ้งถาวร (ภาพ + จำนวนที่ AI นับ + ผลตรวจแก้) — กู้คืนไม่ได้
export async function deleteLabelFrame(taskId, frameId) {
  const res = await fetch(`/api/tasks/${taskId}/label-frames/${frameId}`, { method: 'DELETE' });
  const data = await asJson(res);
  return { ok: res.ok, data };
}
export async function getLabelSummary(taskId) {
  const res = await fetch(`/api/tasks/${taskId}/label-summary`);
  return res.ok ? res.json() : null;
}

// Productivity + work time (from image timestamps) for one task — Task Detail page
export async function getTaskProductivity(id) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok';
  const res = await fetch(`/api/tasks/${id}/productivity?tz=${encodeURIComponent(tz)}`);
  if (!res.ok) return null;
  return res.json();
}
export async function getProductivityReport() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok';
  const res = await fetch(`/api/reports/productivity?tz=${encodeURIComponent(tz)}`);
  if (!res.ok) return null;
  return res.json();
}
// Days (in the viewer's time zone) that have timeline rows for a task, newest first: [{ date, count, first, last }]
export async function getTaskHistoryDays(id) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok';
  const res = await fetch(`/api/tasks/${id}/history/days?tz=${encodeURIComponent(tz)}`);
  if (!res.ok) return [];
  return res.json();
}
// format: 'mp4' | 'gif'. inline=true -> playable in <video>/<img>; otherwise the server sends it as a download.
export function timelapseUrl(id, { format = 'mp4', inline = false, v } = {}) {
  const qs = new URLSearchParams({ format });
  if (inline) qs.set('inline', '1');
  if (v) qs.set('v', v);
  return `/api/tasks/${id}/timelapse?${qs}`;
}
export async function buildTimelapse(id) {
  const res = await fetch(`/api/tasks/${id}/timelapse/build`, { method: 'POST' });
  const data = await asJson(res);
  return { ok: res.ok, data };
}

/* ---------------- BRICK TYPES ---------------- */
export async function getBrickTypes() {
  const res = await fetch('/api/bricktypes');
  return res.json();
}
export async function createBrickType(body) {
  const res = await fetch('/api/bricktypes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await asJson(res);
  return { ok: res.ok, data };
}
export async function updateBrickType(id, body) {
  const res = await fetch(`/api/bricktypes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await asJson(res);
  return { ok: res.ok, data };
}
export async function deleteBrickType(id) {
  const res = await fetch(`/api/bricktypes/${id}`, { method: 'DELETE' });
  return res.ok;
}

/* ---------------- WORKERS ---------------- */
export async function getWorkers() {
  const res = await fetch('/api/workers');
  return res.json();
}
export async function createWorker(body) {
  const res = await fetch('/api/workers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await asJson(res);
  return { ok: res.ok, data };
}
export async function deleteWorker(id) {
  const res = await fetch(`/api/workers/${id}`, { method: 'DELETE' });
  return res.ok;
}

/* ---------------- USERS ---------------- */
export async function getUsers() {
  const res = await fetch('/api/users');
  return res.ok ? res.json() : [];
}
export async function createUser(body) {
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await asJson(res);
  return { ok: res.ok, data };
}
export async function updateUser(id, body) {
  const res = await fetch(`/api/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await asJson(res);
  return { ok: res.ok, data };
}
export async function deleteUser(id) {
  const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
  const data = await asJson(res);
  return { ok: res.ok, data };
}

/* ---------------- ROLES ---------------- */
export async function getRoles() {
  const res = await fetch('/api/roles');
  return res.json();
}
export async function updateRole(id, body) {
  const res = await fetch(`/api/roles/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await asJson(res);
  return { ok: res.ok, data };
}

/* ---------------- CAMERAS ---------------- */
export async function getCameras() {
  const res = await fetch('/api/cameras');
  return res.json();
}
export async function createCamera(body) {
  const res = await fetch('/api/cameras', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await asJson(res);
  return { ok: res.ok, data };
}
export async function deleteCamera(id) {
  const res = await fetch(`/api/cameras/${id}`, { method: 'DELETE' });
  const data = await asJson(res);
  return { ok: res.ok, data };
}
export async function testCamera(id) {
  const res = await fetch(`/api/cameras/${id}/test`, { method: 'POST' });
  const data = await asJson(res);
  return { ok: res.ok, data };
}
export async function testRtsp(url, timeoutMs = 8000) {
  const res = await fetch('/api/test-rtsp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, timeoutMs }),
  });
  return asJson(res);
}
export async function saveCameraView(id, view) {
  const res = await fetch(`/api/cameras/${id}/view`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(view),
  });
  const data = await asJson(res);
  return { ok: res.ok, data };
}
export function cameraSnapshotUrl(id) {
  return `/api/cameras/${id}/snapshot?_=${Date.now()}`;
}
export function adhocSnapshotUrl(url) {
  return `/api/snapshot?url=${encodeURIComponent(url)}&_=${Date.now()}`;
}
export function cameraStreamUrl(id, { fps = 6, width = 960 } = {}) {
  return `/api/cameras/${id}/stream?fps=${fps}&width=${width}&_=${Date.now()}`;
}
export async function getFtpInfo() {
  const res = await fetch('/api/ftp-info');
  return res.json();
}
export async function regenerateFtpPassword(id) {
  const res = await fetch(`/api/cameras/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regenerateFtpPassword: true }),
  });
  const data = await asJson(res);
  return { ok: res.ok, data };
}

/* ---------------- ALERT CONFIG ---------------- */
export async function getAlertConfig() {
  const res = await fetch('/api/alertconfig');
  return res.json();
}
export async function updateAlertConfig(body) {
  const res = await fetch('/api/alertconfig', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}
export async function testAlert() {
  const res = await fetch('/api/alerts/test', { method: 'POST' });
  const data = await asJson(res);
  return { ok: res.ok, data };
}

/* ---------------- STORAGE ---------------- */
export async function getStorage() {
  const res = await fetch('/api/storage');
  return res.json();
}
export async function updateStorage(body) {
  const res = await fetch('/api/storage', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}
export async function runBackup() {
  const res = await fetch('/api/storage/backup', { method: 'POST' });
  if (!res.ok) {
    const data = await asJson(res);
    return { ok: false, message: data.message || 'สำรองข้อมูลไม่สำเร็จ' };
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : 'civil-backup.tar.gz';
  return { ok: true, blob, filename };
}
