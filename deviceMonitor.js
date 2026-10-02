/**
 * CIVIL — Device Monitor helpers (pure, no I/O — unit tested in test/deviceMonitor.test.js).
 *
 * ESP32 bridges POST their telemetry to /api/devices/heartbeat (see esp32-cam-bridge). This module
 * cleans that payload, keeps a short per-device history for the sparklines, and decides which
 * Discord alerts should fire or recover (edge-triggered: one message when a problem starts, one when
 * it clears — never a message every tick).
 */

const HISTORY_POINTS = 120; // ~30 min of history at one heartbeat every 15 s
const OFFLINE_AFTER_MS = 3 * 60 * 1000; // no heartbeat this long = device / site internet down
const CAMERA_FAIL_STREAK = 3; // camera fetch failed this many cycles in a row = camera offline

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v, max = 80) => (v === undefined || v === null ? null : String(v).slice(0, max));
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// Whitelist + type-check the ESP payload — nothing from the device is stored verbatim.
function sanitizeTelemetry(body) {
  const b = obj(body);
  const chip = obj(b.chip), heap = obj(b.heap), wifi = obj(b.wifi), tcp = obj(b.tcp), cycle = obj(b.cycle), cam = obj(b.camera), ftp = obj(b.ftp), dht = obj(b.dht);
  return {
    fw: str(b.fw, 40), uptimeMs: num(b.uptimeMs), resetReason: str(b.resetReason, 40),
    chip: { model: str(chip.model, 40), rev: num(chip.rev), cores: num(chip.cores), cpuMHz: num(chip.cpuMHz), flashBytes: num(chip.flashBytes), sketchBytes: num(chip.sketchBytes) },
    heap: { free: num(heap.free), min: num(heap.min), maxBlock: num(heap.maxBlock), total: num(heap.total) },
    chipTempC: num(b.chipTempC ?? b.tempC), // ESP32 internal chip sensor (older firmware sent it as tempC)
    dht: dht.present ? { present: true, tempC: num(dht.tempC), humidity: num(dht.humidity) } : { present: false },
    wifi: { ssid: str(wifi.ssid, 40), rssi: num(wifi.rssi), ip: str(wifi.ip, 40), channel: num(wifi.channel), bssid: str(wifi.bssid, 20) },
    tcp: { sndBuf: num(tcp.sndBuf), wnd: num(tcp.wnd) },
    cycle: { count: num(cycle.count), ok: num(cycle.ok), fail: num(cycle.fail), consecutiveFail: num(cycle.consecutiveFail), intervalMs: num(cycle.intervalMs), lastMs: num(cycle.lastMs), busyPct: num(cycle.busyPct) },
    camera: { ok: cam.ok === undefined ? null : !!cam.ok, failStreak: num(cam.failStreak), lastError: str(cam.lastError, 120), fetchMs: num(cam.fetchMs), bytes: num(cam.bytes) },
    ftp: { sessionOpen: ftp.sessionOpen === undefined ? null : !!ftp.sessionOpen, startMs: num(ftp.startMs), sendMs: num(ftp.sendMs), kbps: num(ftp.kbps) },
    lastUploadAgoMs: num(b.lastUploadAgoMs), prevIntervalMs: num(b.prevIntervalMs),
  };
}

/**
 * Merge one heartbeat into the device record (returns a new record).
 * `lastUploadAt` is derived on the server — the ESP has no wall clock, only "ms since".
 */
function applyHeartbeat(prev, data, { now = Date.now(), ip = null } = {}) {
  const lastUploadAt = data.lastUploadAgoMs !== null ? new Date(now - data.lastUploadAgoMs).toISOString() : (prev && prev.lastUploadAt) || null;
  const point = {
    at: new Date(now).toISOString(), heapFree: data.heap.free, chipTempC: data.chipTempC, rssi: data.wifi.rssi,
    kbps: data.ftp.kbps, gapMs: data.prevIntervalMs, dhtTemp: data.dht.present ? data.dht.tempC : null,
  };
  const history = [...((prev && prev.history) || []), point].slice(-HISTORY_POINTS);
  return { lastSeen: new Date(now).toISOString(), ip, lastUploadAt, data, history };
}

const isOnline = (rec, now = Date.now()) => !!rec && now - new Date(rec.lastSeen).getTime() < OFFLINE_AFTER_MS;
// Chip too hot: alarm at CHIP_HOT_C, stays on until it cools below CHIP_COOL_C (no flapping around one value).
// No reading (older firmware / sensor error) keeps the current state.
const CHIP_HOT_C = 75, CHIP_COOL_C = 70;
function chipHot(rec, wasHot = false) {
  const t = rec && rec.data ? rec.data.chipTempC : null;
  if (t === null || t === undefined) return wasHot;
  return t >= (wasHot ? CHIP_COOL_C : CHIP_HOT_C);
}
const cameraDown = (rec) => !!rec && rec.data && rec.data.camera && (rec.data.camera.failStreak || 0) >= CAMERA_FAIL_STREAK;

/**
 * Edge-triggered alert state: `active` = set of keys currently in alarm. `conditions` = { key: bool }
 * for this tick. Returns { active, fired: [keys that just started], cleared: [keys that just ended] }.
 */
function diffAlerts(active, conditions) {
  const next = new Set(active);
  const fired = [], cleared = [];
  for (const [key, bad] of Object.entries(conditions)) {
    if (bad && !next.has(key)) { next.add(key); fired.push(key); }
    if (!bad && next.has(key)) { next.delete(key); cleared.push(key); }
  }
  return { active: next, fired, cleared };
}

module.exports = { HISTORY_POINTS, OFFLINE_AFTER_MS, CAMERA_FAIL_STREAK, CHIP_HOT_C, CHIP_COOL_C, chipHot, sanitizeTelemetry, applyHeartbeat, isOnline, cameraDown, diffAlerts };
