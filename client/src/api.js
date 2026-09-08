/* ===================================================================
   CIVIL — API wrappers. One function per backend endpoint (server.js).
   Request/response shapes match server.js exactly — do not change
   without changing server.js too.
=================================================================== */

async function asJson(res) {
  try { return await res.json(); } catch (_) { return {}; }
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
export async function getTaskHistory(id, { from, to, limit } = {}) {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (limit) qs.set('limit', limit);
  const q = qs.toString();
  const res = await fetch(`/api/tasks/${id}/history${q ? `?${q}` : ''}`);
  if (!res.ok) return [];
  return res.json();
}
export function timelapseDownloadUrl(id) {
  return `/api/tasks/${id}/timelapse`;
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
  return res.json();
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
