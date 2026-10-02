const test = require('node:test');
const assert = require('node:assert');
const { scheduledDayMinutes, taskProductivity, projectProductivity, DEFAULT_DAY_MINUTES } = require('../productivity');

test('scheduled day length subtracts the break', () => {
  assert.strictEqual(scheduledDayMinutes({ start: '08:00', breakStart: '12:00', breakEnd: '13:00', end: '17:00' }), 480);
  assert.strictEqual(scheduledDayMinutes({ start: '08:00', end: '17:00' }), 540);
  assert.strictEqual(scheduledDayMinutes({ start: '22:00', end: '06:00' }), 480); // past midnight
  assert.strictEqual(scheduledDayMinutes(null), DEFAULT_DAY_MINUTES);
  assert.strictEqual(scheduledDayMinutes({ start: 'x', end: '17:00' }), DEFAULT_DAY_MINUTES);
});

test('P = Q / (N x T), % diff and durations', () => {
  const task = { area: 24, expectedArea: 100, workers: ['a', 'b'], schedule: { start: '08:00', breakStart: '12:00', breakEnd: '13:00', end: '17:00' } };
  const r = taskProductivity(task, { runMinutes: 960 }, 10); // 960 min / 480 per day = 2 days
  assert.strictEqual(r.T, 2);
  assert.strictEqual(r.manDays, 4);
  assert.strictEqual(r.pActual, 6); // 24 / (2 x 2)
  assert.strictEqual(r.diffPct, -40); // (6 - 10) / 10
  assert.strictEqual(r.durationStd, 5); // 100 / (10 x 2)
  assert.strictEqual(r.durationForecast, 8.33); // 100 / (6 x 2)
  assert.strictEqual(r.remainingDays, 6.33); // 76 / 12
});

test('values that cannot be computed are null, never 0 or Infinity', () => {
  const noWorkers = taskProductivity({ area: 10, expectedArea: 50, workers: [] }, { runMinutes: 480 }, 8);
  assert.strictEqual(noWorkers.pActual, null);
  assert.strictEqual(noWorkers.durationStd, null);
  const noTime = taskProductivity({ area: 0, expectedArea: 50, workers: ['a'] }, { runMinutes: 0 }, 8);
  assert.strictEqual(noTime.pActual, null);
  assert.strictEqual(noTime.durationStd, 6.25); // planned duration only needs the standard
  const noStd = taskProductivity({ area: 10, expectedArea: 50, workers: ['a'] }, { runMinutes: 480 }, null);
  assert.strictEqual(noStd.pActual, 10);
  assert.strictEqual(noStd.diffPct, null);
});

test('project productivity = total Q / total man-days', () => {
  const p = projectProductivity([
    { Q: 24, manDays: 4, pStd: 10 },
    { Q: 6, manDays: 2, pStd: 4 },
    { Q: 0, manDays: 0, pStd: null },
    { Q: 150, manDays: 0, pStd: 5 }, // area but no logged time: excluded, or P would explode
  ]);
  assert.strictEqual(p.Q, 30);
  assert.strictEqual(p.pActual, 5); // 30 / 6
  assert.strictEqual(p.pStd, 8); // (10x4 + 4x2) / 6
  assert.strictEqual(p.diffPct, -37.5);
});

test('standard as a range: formulas use the middle, stdBand places P against the range', () => {
  const task = { area: 30, expectedArea: 100, workers: ['a'], schedule: {} };
  const r = taskProductivity(task, { runMinutes: 480 }, 22.5, { min: 20, max: 25 }); // P = 30 / (1 × 1) = 30
  assert.strictEqual(r.pActual, 30);
  assert.strictEqual(r.pStd, 22.5);
  assert.deepStrictEqual([r.pStdMin, r.pStdMax, r.stdBand], [20, 25, 'above']);
  assert.strictEqual(r.diffPct, 33.3);
  assert.strictEqual(taskProductivity({ ...task, area: 22 }, { runMinutes: 480 }, 22.5, { min: 20, max: 25 }).stdBand, 'within');
  assert.strictEqual(taskProductivity({ ...task, area: 9 }, { runMinutes: 480 }, 22.5, { min: 20, max: 25 }).stdBand, 'below');
  assert.strictEqual(taskProductivity(task, { runMinutes: 480 }, 10).stdBand, null); // single value: no band
});

test('brickArea: length × height of the wall face', () => {
  const { brickArea } = require('../productivity');
  assert.strictEqual(brickArea({ lengthCm: 40, heightCm: 20 }), 0.08);
  assert.strictEqual(brickArea({ lengthCm: 60, heightCm: 20, thicknessCm: 7.5 }), 0.12); // thickness ignored
});
