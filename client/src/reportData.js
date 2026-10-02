/* ===================================================================
   Report data shared by the Reports pages and the PDF / Word exports:
   loading (productivity + full history per task), sampling the history
   into a readable table, and the per-day summary of a task.
=================================================================== */
import * as api from './api.js';

export const SAMPLE_MINUTES = 30; // exported tables: one row per 30 minutes of recorded work
export const MAX_ROWS_PER_TASK = 48; // keeps exported files a sane size for long-running tasks
const GAP_MS = 150 * 1000; // images further apart than this = break / off-hours / no image (same as server)

const pad = (n) => String(n).padStart(2, '0');
export const localDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const imgTime = (e) => new Date(e.imageAt || e.at).getTime();

export const sourceLabel = (t) => (t.resultSource === 'human' ? '② ผลตรวจแก้โดยคน (HITL)' : '① ผล AI');

// Productivity for the given tasks + each task's full history, fetched in parallel. `tasks` in the
// result carry the area / blocks of each task's chosen result set (AI or human-corrected).
export async function loadReportData(tasks) {
  const [prod, histList] = await Promise.all([
    api.getProductivityReport(),
    Promise.all(tasks.map((t) => api.getTaskHistory(t.id).catch(() => []))),
  ]);
  const histories = new Map(tasks.map((t, i) => [t.id, (histList[i] || []).filter((e) => e && e.at)]));
  const wanted = new Set(tasks.map((t) => t.id));
  const prodTasks = (prod?.tasks || []).filter((p) => wanted.has(p.taskId));
  // area / blocks as the task's chosen result: option 1 = AI, option 2 = human-corrected (HITL)
  const byId = new Map(prodTasks.map((p) => [p.taskId, p]));
  const effective = tasks.map((t) => {
    const p = byId.get(t.id);
    return p && p.resultSource === 'human' ? { ...t, area: p.Q, blocks: p.blocks, resultSource: 'human' } : { ...t, resultSource: 'ai' };
  });
  return { prod: prod ? { ...prod, tasks: prodTasks } : null, histories, tasks: effective };
}

// First row of every SAMPLE_MINUTES bucket, plus the very last row; evenly thinned to MAX_ROWS_PER_TASK.
export function sampleHistory(hist) {
  if (hist.length === 0) return [];
  const out = [];
  let lastBucket = null;
  for (const e of hist) {
    const b = Math.floor(new Date(e.at).getTime() / (SAMPLE_MINUTES * 60000));
    if (b !== lastBucket) { out.push(e); lastBucket = b; }
  }
  if (out[out.length - 1] !== hist[hist.length - 1]) out.push(hist[hist.length - 1]);
  if (out.length <= MAX_ROWS_PER_TASK) return out;
  const step = (out.length - 1) / (MAX_ROWS_PER_TASK - 1);
  return Array.from({ length: MAX_ROWS_PER_TASK }, (_, i) => out[Math.round(i * step)]);
}

// Rows saved before progress_pct existed have no value — derive it from area / target instead.
export function progressOf(e, expected) {
  const p = e.progressPct ?? (expected ? (Number(e.area) / expected) * 100 : null);
  return p === null || p === undefined ? null : p;
}

/**
 * One row per calendar day (viewer's time zone) of a task's history, oldest first:
 * work time from image timestamps (same rule as the server), images, area/blocks at the end of the
 * day, what was gained that day, and that day's productivity P = gained area / (N × T_day).
 */
export function dailySummary(hist, { N = 0, dayMinutes = 480 } = {}) {
  const byDay = new Map();
  for (const e of hist) {
    const k = localDateStr(new Date(e.at));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }
  let prevArea = null, prevBlocks = null;
  return [...byDay.keys()].sort().map((date) => {
    const rows = byDay.get(date);
    const times = [...new Set(rows.filter((e) => e.snapshot).map(imgTime))].sort((a, b) => a - b);
    let workMs = 0;
    for (let i = 1; i < times.length; i++) { const g = times[i] - times[i - 1]; if (g <= GAP_MS) workMs += g; }
    const last = rows[rows.length - 1];
    const areaEnd = Number(last.area) || 0;
    const blocksEnd = Number(last.blocks) || 0;
    const areaStart = prevArea ?? (Number(rows[0].area) || 0);
    const blocksStart = prevBlocks ?? (Number(rows[0].blocks) || 0);
    prevArea = areaEnd; prevBlocks = blocksEnd;
    const workMinutes = workMs / 60000;
    const T = workMinutes / dayMinutes;
    const gained = areaEnd - areaStart;
    const people = rows.map((e) => e.peopleDetected || 0);
    return {
      date,
      first: rows[0].at, last: last.at,
      images: times.length,
      workMinutes,
      blocksEnd, blocksGained: blocksEnd - blocksStart,
      areaEnd, areaGained: gained,
      peopleAvg: people.reduce((s, v) => s + v, 0) / people.length,
      peopleMax: Math.max(...people),
      pDay: N > 0 && T > 0 ? gained / (N * T) : null,
    };
  });
}
