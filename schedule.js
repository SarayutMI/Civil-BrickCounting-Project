/**
 * CIVIL — working-hours schedule logic (pure, no I/O — unit tested in test/schedule.test.js).
 *
 * A task's `schedule` is { start, breakStart, breakEnd, end } as "HH:MM" strings (server timezone,
 * APP_TIMEZONE, default Asia/Bangkok). The day is split into three phases:
 *   work  -> task should be running       break -> paused for the break       off -> paused, outside working hours
 * Blank / invalid fields disable that boundary (no break configured = no break phase, etc.).
 */
const DEFAULT_TZ = 'Asia/Bangkok';

function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

// minutes since local midnight in the given timezone
function minutesNow(date = new Date(), tz = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour').value) % 24;
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

const within = (t, from, to) => (from <= to ? t >= from && t < to : t >= from || t < to); // to < from = wraps past midnight

/** @returns 'work' | 'break' | 'off' | null (null = schedule has no usable start/end, so never auto-switch) */
function scheduledPhase(schedule, nowMin) {
  const start = toMinutes(schedule && schedule.start);
  const end = toMinutes(schedule && schedule.end);
  if (start === null || end === null || start === end) return null;
  if (!within(nowMin, start, end)) return 'off';
  const bs = toMinutes(schedule.breakStart);
  const be = toMinutes(schedule.breakEnd);
  if (bs !== null && be !== null && bs !== be && within(nowMin, bs, be)) return 'break';
  return 'work';
}

const statusForPhase = (phase) => (phase === 'work' ? 'running' : 'pause');

/**
 * Edge-triggered: only acts when the phase CHANGES since the last tick (lastPhase is persisted in
 * tasks.auto_phase). So a manual pause/start in the middle of a phase is respected until the next
 * boundary. A brand-new task (lastPhase null) just records the phase without touching its status.
 * @returns { phase, status|null } — status is the new status to apply, null = leave as is
 */
function evaluate(task, nowMin) {
  const phase = scheduledPhase(task.schedule, nowMin);
  if (phase === null || task.status === 'finished') return { phase: task.status === 'finished' ? null : phase, status: null };
  if (task.autoPhase === undefined || task.autoPhase === null) return { phase, status: null };
  if (phase === task.autoPhase) return { phase, status: null };
  const status = statusForPhase(phase);
  return { phase, status: status === task.status ? null : status };
}

module.exports = { DEFAULT_TZ, toMinutes, minutesNow, scheduledPhase, statusForPhase, evaluate };
