const test = require('node:test');
const assert = require('node:assert');
const { sanitizeTelemetry, applyHeartbeat, isOnline, cameraDown, chipHot, diffAlerts, HISTORY_POINTS, OFFLINE_AFTER_MS } = require('../deviceMonitor');

test('sanitizeTelemetry keeps known fields, types them, drops the rest', () => {
  const d = sanitizeTelemetry({ heap: { free: '123456', evil: 1 }, wifi: { rssi: -61, ssid: 'x'.repeat(200) }, camera: { ok: 1 }, extra: 'nope', dht: { present: false, tempC: 30 } });
  assert.strictEqual(d.heap.free, 123456);
  assert.strictEqual(d.heap.evil, undefined);
  assert.strictEqual(d.wifi.ssid.length, 40);
  assert.strictEqual(d.camera.ok, true);
  assert.strictEqual(d.extra, undefined);
  assert.deepStrictEqual(d.dht, { present: false });
  assert.strictEqual(sanitizeTelemetry(null).chipTempC, null);
  assert.strictEqual(sanitizeTelemetry({ tempC: 41.5 }).chipTempC, 41.5); // older firmware field
  assert.strictEqual(sanitizeTelemetry({ chipTempC: 44 }).chipTempC, 44);
});

test('applyHeartbeat derives the upload time from "ms ago" and caps history', () => {
  const now = Date.parse('2026-09-27T10:00:00Z');
  const data = sanitizeTelemetry({ lastUploadAgoMs: 4000, prevIntervalMs: 9000, ftp: { kbps: 48 } });
  let rec = applyHeartbeat(null, data, { now, ip: '1.2.3.4' });
  assert.strictEqual(rec.lastUploadAt, '2026-09-27T09:59:56.000Z');
  assert.strictEqual(rec.history[0].gapMs, 9000);
  for (let i = 0; i < HISTORY_POINTS + 5; i++) rec = applyHeartbeat(rec, data, { now: now + i * 1000 });
  assert.strictEqual(rec.history.length, HISTORY_POINTS);
});

test('online / camera-down checks', () => {
  const now = Date.now();
  assert.ok(isOnline({ lastSeen: new Date(now - 10000).toISOString() }, now));
  assert.ok(!isOnline({ lastSeen: new Date(now - OFFLINE_AFTER_MS - 1).toISOString() }, now));
  assert.ok(!isOnline(null, now));
  assert.ok(cameraDown({ data: { camera: { failStreak: 3 } } }));
  assert.ok(!cameraDown({ data: { camera: { failStreak: 1 } } }));
});

test('diffAlerts is edge-triggered', () => {
  let r = diffAlerts(new Set(), { a: true, b: false });
  assert.deepStrictEqual([r.fired, r.cleared], [['a'], []]);
  r = diffAlerts(r.active, { a: true, b: false });
  assert.deepStrictEqual([r.fired, r.cleared], [[], []]); // still bad: no repeat
  r = diffAlerts(r.active, { a: false, b: true });
  assert.deepStrictEqual([r.fired, r.cleared], [['b'], ['a']]);
});

test('chipHot alarms at 75°C and clears only below 70°C', () => {
  const at = (c) => ({ data: { chipTempC: c } });
  assert.ok(!chipHot(at(74)));
  assert.ok(chipHot(at(75)));
  assert.ok(chipHot(at(72), true)); // already hot: still on between 70 and 75
  assert.ok(!chipHot(at(69.9), true));
  assert.ok(chipHot(at(null), true)); // no reading keeps the state
  assert.ok(!chipHot(null));
});
