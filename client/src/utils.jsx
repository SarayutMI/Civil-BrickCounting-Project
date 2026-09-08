/* ===================================================================
   Small shared helpers ported from app.js (statusBadge/cameraBadge/etc).
=================================================================== */
const STATUS_MAP = { running: ['badge-running', 'กำลังดำเนินการ'], pause: ['badge-pause', 'พัก'], finished: ['badge-finished', 'เสร็จสิ้น'] };
export function StatusBadge({ status }) {
  const [cls, label] = STATUS_MAP[status] || ['badge-finished', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}
export function statusLabel(status) {
  return (STATUS_MAP[status] || [null, status])[1];
}

const CAMERA_MAP = { live: ['badge-live', 'Live'], connecting: ['badge-connecting', 'Connecting'], disconnect: ['badge-disconnect', 'Disconnect'] };
export function CameraBadge({ status }) {
  const [cls, label] = CAMERA_MAP[status] || ['badge-disconnect', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function cameraStatusLabel(status) {
  return { live: '🟢 Live', disconnect: '🔴 ขาดการเชื่อมต่อ', unknown: '⚪ ยังไม่ทดสอบ' }[status] || '⚪ ยังไม่ทดสอบ';
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? gb.toFixed(1) + ' GB' : (bytes / 1024 ** 2).toFixed(1) + ' MB';
}

export function brickName(brickTypes, id) {
  return (brickTypes.find((b) => b.id === id) || {}).name || '—';
}
export function workerName(workersMaster, id) {
  return (workersMaster.find((w) => w.id === id) || {}).name || '—';
}

export function pct(area, expectedArea) {
  return expectedArea ? Math.round((area / expectedArea) * 100) : 0;
}

export function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
