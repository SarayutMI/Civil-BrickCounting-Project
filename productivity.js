/**
 * CIVIL — labour productivity for the Reports page / PDF (pure, no I/O — unit tested in
 * test/productivity.test.js).
 *
 *   Productivity (จริง)  P = Q / (N × T)                       ตร.ม. / คน-วัน
 *     Q = ปริมาณงาน (ตร.ม.)      = task.area (พื้นที่ที่ AI นับได้ล่าสุด)
 *     N = จำนวนแรงงาน (คน)       = แรงงานที่มอบหมายเข้า Task (task.workers)
 *     T = เวลาที่ใช้ (วัน)        = นาทีทำงานจริงจาก timestamp ของภาพที่กล้องส่งมา (server.js taskImageUsage)
 *                                ÷ นาทีทำงานต่อวันตามตารางงานของ Task (หักพัก)
 *   % ความแตกต่าง = (P จริง − P มาตรฐาน) / P มาตรฐาน × 100    (+ สูงกว่ามาตรฐาน, − ต่ำกว่า)
 *   Duration = Q / (P × N)  วัน — ใช้ Q = พื้นที่เป้าหมายทั้งหมดของ Task
 *     ตามมาตรฐาน: P = P มาตรฐาน        คาดการณ์: P = P จริง
 * P มาตรฐานตั้งต่อประเภทอิฐ (brickType.standardProductivity, ตร.ม./คน-วัน). ค่ามาตรฐานที่ตีพิมพ์มักเป็นช่วง
 * (เช่น 8–12) — สูตรใช้ค่ากลางของช่วง และบอกเพิ่มว่า P จริงต่ำกว่า / อยู่ใน / สูงกว่าช่วง (stdBand).
 * Any value that cannot be computed (no workers, no time yet, no standard) is null — never 0 or
 * Infinity, so the UI can show "—" instead of a misleading number.
 */
const { toMinutes } = require('./schedule');

const DEFAULT_DAY_MINUTES = 8 * 60; // used when the task has no usable working-hours schedule

// Working minutes in one scheduled day: end − start, minus the break when it lies inside the day.
function scheduledDayMinutes(schedule) {
  const s = toMinutes(schedule && schedule.start);
  const e = toMinutes(schedule && schedule.end);
  if (s === null || e === null || s === e) return DEFAULT_DAY_MINUTES;
  let day = e > s ? e - s : 24 * 60 - s + e; // end before start = shift runs past midnight
  const bs = toMinutes(schedule.breakStart);
  const be = toMinutes(schedule.breakEnd);
  if (bs !== null && be !== null && be !== bs) day -= be > bs ? be - bs : 24 * 60 - bs + be;
  return day > 0 ? day : DEFAULT_DAY_MINUTES;
}

const pos = (n) => (Number.isFinite(n) && n > 0 ? n : null);
const round = (n, d = 2) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

/**
 * @param task   { area, expectedArea, workers: [], schedule }
 * @param usage  { runMinutes } — minutes the task actually worked (from image timestamps)
 * @param pStd   standard productivity of the task's brick type (ตร.ม./คน-วัน) or null
 * @param range  { min, max } when the standard is a published range (pStd = its middle), or null
 */
function taskProductivity(task, usage, pStd, range = null) {
  const Q = Math.max(Number(task.area) || 0, 0);
  const Qtotal = pos(Number(task.expectedArea));
  const N = Array.isArray(task.workers) ? task.workers.length : 0;
  const runMinutes = Math.max(Number(usage && usage.runMinutes) || 0, 0);
  const dayMinutes = scheduledDayMinutes(task.schedule);
  const T = runMinutes / dayMinutes;
  const std = pos(Number(pStd));

  const pActual = N > 0 && T > 0 ? Q / (N * T) : null;
  const diffPct = pActual !== null && std ? ((pActual - std) / std) * 100 : null;
  const durationStd = Qtotal && std && N > 0 ? Qtotal / (std * N) : null;
  const durationForecast = Qtotal && pos(pActual) && N > 0 ? Qtotal / (pActual * N) : null;
  const remaining = Qtotal !== null ? Math.max(Qtotal - Q, 0) : null;
  const remainingDays = remaining !== null && pos(pActual) && N > 0 ? remaining / (pActual * N) : null;
  const lo = range ? pos(Number(range.min)) : null, hi = range ? pos(Number(range.max)) : null;
  const stdBand = pActual === null || lo === null || hi === null ? null : pActual < lo ? 'below' : pActual > hi ? 'above' : 'within';

  return {
    Q: round(Q, 3), Qtotal, N, runMinutes, dayMinutes, T: round(T, 3),
    manDays: round(N * T, 6), // kept precise: project P divides by the sum of these
    pActual: round(pActual, 3), pStd: std, pStdMin: lo, pStdMax: hi, stdBand, diffPct: round(diffPct, 1),
    durationStd: round(durationStd, 2), durationForecast: round(durationForecast, 2), remainingDays: round(remainingDays, 2),
  };
}

// Whole-project figures: total area over total man-days (not an average of per-task P). Only tasks
// with recorded man-days count — area on a task with no logged time (or no workers) has no T to divide by.
function projectProductivity(rows) {
  const timed = rows.filter((r) => r.manDays > 0);
  const Q = timed.reduce((s, r) => s + (r.Q || 0), 0);
  const manDays = timed.reduce((s, r) => s + r.manDays, 0);
  const stdRows = rows.filter((r) => r.pStd && r.manDays);
  // standard weighted by the man-days actually spent on each task
  const stdMan = stdRows.reduce((s, r) => s + r.manDays, 0);
  const pStd = stdMan ? stdRows.reduce((s, r) => s + r.pStd * r.manDays, 0) / stdMan : null;
  const pActual = manDays > 0 ? Q / manDays : null;
  return {
    Q: round(Q, 3), manDays: round(manDays, 3), pActual: round(pActual, 3), pStd: round(pStd, 3),
    diffPct: pActual !== null && pStd ? round(((pActual - pStd) / pStd) * 100, 1) : null,
  };
}

// m² of wall one brick covers: length × height (cm) of the face that shows in the wall.
// size: { lengthCm, heightCm } — the thickness does not change the wall area.
function brickArea(size) {
  return Math.round((Number(size.lengthCm) * Number(size.heightCm)) / 10000 * 1e6) / 1e6;
}

module.exports = { brickArea, DEFAULT_DAY_MINUTES, scheduledDayMinutes, taskProductivity, projectProductivity };
