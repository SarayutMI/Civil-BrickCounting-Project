const test = require('node:test');
const assert = require('node:assert');
const { scheduledPhase, evaluate, minutesNow, toMinutes } = require('../schedule');

const S = { start: '08:00', breakStart: '12:00', breakEnd: '13:00', end: '17:00' };
const m = toMinutes;

test('phases across a normal day', () => {
  assert.strictEqual(scheduledPhase(S, m('07:59')), 'off');
  assert.strictEqual(scheduledPhase(S, m('08:00')), 'work');
  assert.strictEqual(scheduledPhase(S, m('11:59')), 'work');
  assert.strictEqual(scheduledPhase(S, m('12:00')), 'break');
  assert.strictEqual(scheduledPhase(S, m('12:59')), 'break');
  assert.strictEqual(scheduledPhase(S, m('13:00')), 'work');
  assert.strictEqual(scheduledPhase(S, m('16:59')), 'work');
  assert.strictEqual(scheduledPhase(S, m('17:00')), 'off');
});

test('no break configured, or invalid fields, never invents a break', () => {
  assert.strictEqual(scheduledPhase({ start: '08:00', end: '17:00', breakStart: '', breakEnd: '' }, m('12:30')), 'work');
  assert.strictEqual(scheduledPhase({ start: '', end: '17:00' }, m('12:30')), null);
  assert.strictEqual(scheduledPhase({ start: '25:00', end: '17:00' }, m('12:30')), null);
  assert.strictEqual(scheduledPhase(null, m('12:30')), null);
});

test('overnight shift wraps past midnight', () => {
  const N = { start: '22:00', end: '06:00', breakStart: '02:00', breakEnd: '03:00' };
  assert.strictEqual(scheduledPhase(N, m('23:30')), 'work');
  assert.strictEqual(scheduledPhase(N, m('00:30')), 'work');
  assert.strictEqual(scheduledPhase(N, m('02:30')), 'break');
  assert.strictEqual(scheduledPhase(N, m('06:00')), 'off');
  assert.strictEqual(scheduledPhase(N, m('12:00')), 'off');
});

test('edge-triggered: acts only when phase changes', () => {
  const t = (over) => ({ schedule: S, status: 'running', autoPhase: 'work', ...over });
  assert.deepStrictEqual(evaluate(t(), m('10:00')), { phase: 'work', status: null });
  assert.deepStrictEqual(evaluate(t(), m('12:00')), { phase: 'break', status: 'pause' });
  assert.deepStrictEqual(evaluate(t({ status: 'pause', autoPhase: 'break' }), m('13:00')), { phase: 'work', status: 'running' });
  assert.deepStrictEqual(evaluate(t(), m('17:00')), { phase: 'off', status: 'pause' });
});

test('manual override is respected until the next boundary', () => {
  // user paused by hand mid-morning: same phase -> untouched
  assert.deepStrictEqual(evaluate({ schedule: S, status: 'pause', autoPhase: 'work' }, m('10:00')), { phase: 'work', status: null });
  // user started by hand during the break: untouched, then auto-paused at the next boundary (end of day)
  assert.deepStrictEqual(evaluate({ schedule: S, status: 'running', autoPhase: 'break' }, m('12:30')), { phase: 'break', status: null });
});

test('finished tasks are never touched; new tasks only record the phase', () => {
  assert.deepStrictEqual(evaluate({ schedule: S, status: 'finished', autoPhase: 'work' }, m('12:00')), { phase: null, status: null });
  assert.deepStrictEqual(evaluate({ schedule: S, status: 'pause' }, m('10:00')), { phase: 'work', status: null });
});

test('server down across a boundary catches up on the first tick', () => {
  assert.deepStrictEqual(evaluate({ schedule: S, status: 'running', autoPhase: 'work' }, m('14:00')), { phase: 'work', status: null });
  assert.deepStrictEqual(evaluate({ schedule: S, status: 'running', autoPhase: 'work' }, m('18:00')), { phase: 'off', status: 'pause' });
});

test('minutesNow honours the timezone', () => {
  const d = new Date('2026-01-01T00:30:00Z'); // 07:30 in Bangkok (UTC+7)
  assert.strictEqual(minutesNow(d, 'Asia/Bangkok'), 7 * 60 + 30);
  assert.strictEqual(minutesNow(d, 'UTC'), 30);
});
