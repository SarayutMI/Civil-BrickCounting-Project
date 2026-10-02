import { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBadge } from '../utils.jsx';
import * as api from '../api.js';
import { BBOX_COLOR_COUNTED, BBOX_COLOR_DETECTED, BBOX_COLOR_PERSON } from './BBoxCanvas.jsx';

/* Per-minute timeline for one task: image + numbers + progress chart for the SAME moment.
   Data = task_history rows (one per minute while the task runs). The slider, the chart cursor
   and the image are driven by one index, so they can never disagree. */

const GAP_MS = 2.5 * 60 * 1000; // > 2.5 min between rows = task was paused / no data (break, off-hours, loss of image)

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const localDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function dayRange(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { from: new Date(y, m - 1, d, 0, 0, 0).toISOString(), to: new Date(y, m - 1, d, 23, 59, 59, 999).toISOString() };
}

const MIN_SPAN_MS = 2 * 60 * 1000; // zooming in stops at a 2-minute window
const tms = (e) => new Date(e.at).getTime();

// Continuous runs of data (split wherever the gap between rows exceeds GAP_MS) — "focus" targets.
function dataSegments(entries) {
  const segs = [];
  let startI = 0;
  for (let i = 1; i <= entries.length; i++) {
    if (i === entries.length || tms(entries[i]) - tms(entries[i - 1]) > GAP_MS) {
      segs.push({ from: tms(entries[startI]), to: tms(entries[i - 1]), count: i - startI });
      startI = i;
    }
  }
  return segs;
}

// Clamp a [from, to] window to the day's data range, keeping at least MIN_SPAN_MS.
function clampView([a, b], full) {
  const span = Math.min(Math.max(b - a, MIN_SPAN_MS), full[1] - full[0] || MIN_SPAN_MS);
  let from = Math.max(a, full[0]);
  let to = from + span;
  if (to > full[1]) { to = Math.max(full[1], full[0] + span); from = to - span; }
  return [from, to];
}

const tickLabel = (t, span) => (span <= 10 * 60 * 1000
  ? new Date(t).toLocaleTimeString('th-TH', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  : hhmm(new Date(t)));

/* Progress chart for [view[0], view[1]] of the day. Drag = scrub the cursor; Ctrl/⌘ + wheel
   (or trackpad pinch) = zoom around the pointer. */
function TimelineChart({ entries, idx, onPick, view, onZoom }) {
  const W = 720, H = 190, L = 36, R = 36, T = 14, B = 26;
  const svgRef = useRef(null);
  const [t0, t1] = view;
  const span = Math.max(t1 - t0, 1);
  const x = (t) => L + ((t - t0) / span) * (W - L - R);
  const yPct = (v) => H - B - (Math.min(Math.max(v, 0), 100) / 100) * (H - T - B);

  // rows inside the window plus one neighbour each side, so lines run off the edges instead of stopping short
  let lo = entries.findIndex((e) => tms(e) >= t0);
  if (lo === -1) lo = entries.length - 1;
  let hi = entries.length - 1;
  for (let i = entries.length - 1; i >= 0; i--) { if (tms(entries[i]) <= t1) { hi = i; break; } }
  const a = Math.max(lo - 1, 0), b = Math.min(hi + 1, entries.length - 1);
  const vis = entries.slice(a, b + 1);
  const inView = entries.slice(lo, hi + 1).filter((e) => tms(e) >= t0 && tms(e) <= t1);
  const maxPeople = Math.max(...(inView.length ? inView : entries).map((e) => e.peopleDetected || 0), 1);
  const yPeople = (v) => H - B - (v / maxPeople) * (H - T - B);

  const pts = vis.map((e) => [x(tms(e)), yPct(e.progressPct ?? 0)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const gaps = [];
  for (let i = 1; i < vis.length; i++) {
    if (tms(vis[i]) - tms(vis[i - 1]) > GAP_MS) gaps.push([Math.max(x(tms(vis[i - 1])), L), Math.min(x(tms(vis[i])), W - R)]);
  }
  const barW = Math.min(Math.max(((W - L - R) * 60000) / span * 0.7, 2), 14); // ~one minute wide, readable when zoomed
  const ticks = 6;
  const cur = entries[idx];
  const curT = cur ? tms(cur) : null;
  const curVisible = curT !== null && curT >= t0 && curT <= t1;

  function timeAt(clientX) {
    const r = svgRef.current.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    return t0 + ((px - L) / (W - L - R)) * span;
  }
  function pick(ev) {
    const t = timeAt(ev.clientX);
    let best = lo, bd = Infinity;
    for (let i = lo; i <= hi; i++) { const d = Math.abs(tms(entries[i]) - t); if (d < bd) { bd = d; best = i; } }
    onPick(best);
  }

  // native listener: React's onWheel is passive, so it could not stop the page from zooming/scrolling
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (ev) => {
      if (!ev.ctrlKey && !ev.metaKey) return; // plain wheel keeps scrolling the page
      ev.preventDefault();
      const factor = Math.exp(ev.deltaY * 0.01);
      const at = Math.min(Math.max(timeAt(ev.clientX), t0), t1);
      onZoom([at - (at - t0) * factor, at + (t1 - at) * factor]);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="tl-chart" role="img" aria-label="กราฟความคืบหน้าตามเวลา"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e); }}
      onPointerMove={(e) => { if (e.buttons) pick(e); }}>
      <defs><clipPath id="tl-plot"><rect x={L} y={0} width={W - L - R} height={H - B} /></clipPath></defs>
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={yPct(v)} y2={yPct(v)} stroke="var(--divider)" strokeWidth="1" />
          <text x={L - 6} y={yPct(v) + 3} fontSize="10" fill="var(--muted)" textAnchor="end">{v}%</text>
        </g>
      ))}
      <text x={W - R + 6} y={T + 4} fontSize="10" fill="var(--purple)">{maxPeople} คน</text>
      <g clipPath="url(#tl-plot)">
        {gaps.map(([ga, gb], i) => <rect key={i} x={ga} y={T} width={Math.max(gb - ga, 0)} height={H - T - B} fill="var(--gray-tint)" />)}
        {vis.map((e, i) => (e.peopleDetected ? (
          <rect key={i} x={x(tms(e)) - barW / 2} y={yPeople(e.peopleDetected)} width={barW} height={H - B - yPeople(e.peopleDetected)} fill="var(--purple)" opacity="0.35" />
        ) : null))}
        {pts.length > 0 && <path d={`${line} L${pts[pts.length - 1][0]},${yPct(0)} L${pts[0][0]},${yPct(0)} Z`} fill="var(--accent)" opacity="0.08" />}
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" />
        {span <= 45 * 60 * 1000 && inView.map((e, i) => <circle key={i} cx={x(tms(e))} cy={yPct(e.progressPct ?? 0)} r="2.4" fill="var(--accent)" />)}
      </g>
      {Array.from({ length: ticks + 1 }, (_, i) => (
        <text key={i} x={L + ((W - L - R) * i) / ticks} y={H - 8} fontSize="10" fill="var(--muted)" textAnchor="middle">{tickLabel(t0 + (span * i) / ticks, span)}</text>
      ))}
      {curVisible && (
        <>
          <line x1={x(curT)} x2={x(curT)} y1={T} y2={H - B} stroke="var(--text)" strokeWidth="1" strokeDasharray="3 3" />
          <circle cx={x(curT)} cy={yPct(cur.progressPct ?? 0)} r="5" fill="var(--accent)" stroke="#fff" strokeWidth="2" />
        </>
      )}
    </svg>
  );
}

/* Whole-day strip under the chart: shows where the zoom window sits. Drag the window to pan,
   drag anywhere else to draw a new window, click to centre the window there. */
function TimelineNavigator({ entries, view, full, onView }) {
  const W = 720, H = 34, L = 36, R = 36;
  const ref = useRef(null);
  const drag = useRef(null);
  const span = Math.max(full[1] - full[0], 1);
  const x = (t) => L + ((t - full[0]) / span) * (W - L - R);
  const tAt = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    return full[0] + ((((clientX - r.left) / r.width) * W - L) / (W - L - R)) * span;
  };
  const line = entries.map((e, i) => `${i ? 'L' : 'M'}${x(tms(e)).toFixed(1)},${(H - 4 - ((e.progressPct ?? 0) / 100) * (H - 8)).toFixed(1)}`).join(' ');
  const segs = dataSegments(entries);

  function down(ev) {
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const t = tAt(ev.clientX);
    drag.current = t >= view[0] && t <= view[1] ? { mode: 'pan', start: t, view } : { mode: 'brush', start: t, moved: false };
  }
  function move(ev) {
    const d = drag.current;
    if (!d) return;
    const t = tAt(ev.clientX);
    if (d.mode === 'pan') onView(clampView([d.view[0] + (t - d.start), d.view[1] + (t - d.start)], full));
    else if (Math.abs(x(t) - x(d.start)) > 4) { d.moved = true; onView(clampView([Math.min(d.start, t), Math.max(d.start, t)], full)); }
  }
  function up(ev) {
    const d = drag.current;
    drag.current = null;
    if (d && d.mode === 'brush' && !d.moved) { // plain click: centre the current window there
      const t = tAt(ev.clientX), half = (view[1] - view[0]) / 2;
      onView(clampView([t - half, t + half], full));
    }
  }

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="tl-nav" aria-label="ภาพรวมทั้งวัน — ลากกรอบเพื่อเลื่อน หรือลากพื้นที่ว่างเพื่อเลือกช่วง"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }}>
      <rect x={L} y={2} width={W - L - R} height={H - 4} rx="4" fill="var(--gray-tint)" />
      {segs.map((sg, i) => <rect key={i} x={x(sg.from)} y={2} width={Math.max(x(sg.to) - x(sg.from), 2)} height={H - 4} fill="var(--accent)" opacity="0.14" />)}
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.2" opacity="0.7" />
      <rect x={x(view[0])} y={1} width={Math.max(x(view[1]) - x(view[0]), 3)} height={H - 2} rx="4" fill="var(--accent)" fillOpacity="0.12" stroke="var(--accent)" strokeWidth="1.5" style={{ cursor: 'grab' }} />
    </svg>
  );
}

/* AI boxes saved with this minute's frame, drawn over the <img>. The SVG uses the image's own
   pixel space with the same "contain" fit as the img, so boxes line up at any card size. */
function LabelOverlay({ label }) {
  const { image_width: w, image_height: h } = label;
  const roi = (label.roi || []).map(([px, py]) => `${px * w},${py * h}`).join(' ');
  const sw = Math.max(w, h) / 400; // ~2px lines whatever the image resolution
  const fs = Math.max(w, h) / 70;
  const box = (d, color, text, dashed, key) => (
    <g key={key}>
      <rect x={d.x1} y={d.y1} width={d.x2 - d.x1} height={d.y2 - d.y1} fill="none" stroke={color} strokeWidth={sw} strokeDasharray={dashed ? `${sw * 3} ${sw * 2}` : undefined} />
      <text x={d.x1 + sw} y={Math.max(d.y1 - sw * 1.5, fs)} fontSize={fs} fill={color} stroke="#000" strokeWidth={sw / 3} paintOrder="stroke">{text}</text>
    </g>
  );
  return (
    <svg className="tl-overlay" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {roi && <polygon points={roi} fill="rgba(0,113,227,.08)" stroke="#fff" strokeWidth={sw} strokeDasharray={`${sw * 4} ${sw * 3}`} />}
      {(label.detections || []).map((d, i) => box(d, d.in_roi ? BBOX_COLOR_COUNTED : BBOX_COLOR_DETECTED, `${Math.round(d.conf * 100)}%`, false, `b${i}`))}
      {(label.personDetections || []).map((d, i) => box(d, BBOX_COLOR_PERSON, `คน ${Math.round(d.conf * 100)}%`, d.in_roi === false, `p${i}`))}
    </svg>
  );
}

const DAY_CARDS = 14; // how many recent days-with-data to show as cards

function dayCardLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const today = localDateStr(new Date());
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const rel = dateStr === today ? 'วันนี้' : dateStr === localDateStr(yest) ? 'เมื่อวาน' : dt.toLocaleDateString('th-TH', { weekday: 'short' });
  return { rel, day: dt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) };
}

// Small cards for the days that actually have timeline data (newest first); click to jump there.
function DayCards({ days, date, onPick }) {
  if (!days || days.length === 0) return null;
  const shown = days.slice(0, DAY_CARDS);
  return (
    <div className="tl-days" role="listbox" aria-label="วันที่มีข้อมูล">
      <span className="tl-days-label cell-muted">วันที่มีข้อมูล</span>
      {shown.map((d) => {
        const { rel, day } = dayCardLabel(d.date);
        return (
          <button
            key={d.date} type="button" role="option" aria-selected={d.date === date}
            className={`tl-day${d.date === date ? ' active' : ''}`} onClick={() => onPick(d.date)}
            title={`${d.date} · ${hhmm(new Date(d.first))}–${hhmm(new Date(d.last))} · ${d.count} นาที`}
          >
            <span className="tl-day-rel">{rel}</span>
            <strong>{day}</strong>
            <span className="tl-day-count">{d.count.toLocaleString()} นาที</span>
          </button>
        );
      })}
      {days.length > DAY_CARDS && <span className="cell-muted" style={{ fontSize: 12 }}>+{days.length - DAY_CARDS} วัน (เลือกจากปฏิทิน)</span>}
    </div>
  );
}

// fixedTaskId: show only that task (per-task report page) — hides the task picker
export default function TaskTimeline({ tasks, fixedTaskId }) {
  const [taskId, setTaskId] = useState(fixedTaskId || tasks[0]?.id || '');
  useEffect(() => { if (fixedTaskId) setTaskId(fixedTaskId); }, [fixedTaskId]);
  const [date, setDate] = useState(() => localDateStr(new Date()));
  const [days, setDays] = useState(null); // [{ date, count, first, last }] newest first; null = loading
  const [daysTaskId, setDaysTaskId] = useState(null); // task the `days` list (and default date) belongs to
  const [entries, setEntries] = useState(null); // null = loading
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [viewMode, setViewMode] = useState('raw'); // 'raw' | 'ai' — which image the frame shows (kept while scrubbing / playing)
  const [zoom, setZoom] = useState(null); // null = whole day, else [fromMs, toMs] of the chart window
  const followLive = useRef(true); // stay on the newest minute unless the user moved away

  useEffect(() => { if (!taskId && tasks[0]) setTaskId(tasks[0].id); }, [tasks, taskId]);

  // Which days have data. On task change, open the newest day that has data (today if it has any)
  // instead of an empty today. Refreshed every 5 min so a new day shows up without reloading.
  useEffect(() => {
    if (!taskId) return undefined;
    let cancelled = false;
    setDays(null);
    setEntries(null); // don't show the previous task's data while this one loads
    async function loadDays(first) {
      const list = await api.getTaskHistoryDays(taskId);
      if (cancelled) return;
      setDays(list);
      if (first) { setDate(list[0]?.date || localDateStr(new Date())); setDaysTaskId(taskId); }
    }
    loadDays(true);
    const id = setInterval(() => loadDays(false), 5 * 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [taskId]);

  useEffect(() => {
    if (!taskId || daysTaskId !== taskId) return undefined; // wait until this task's default date is picked
    let cancelled = false;
    setEntries(null);
    setZoom(null);
    followLive.current = true;
    async function load(first) {
      const list = (await api.getTaskHistory(taskId, { ...dayRange(date), detections: true })).filter((e) => e && e.at);
      if (cancelled) return;
      setEntries(list);
      setIdx((cur) => (first || followLive.current ? Math.max(list.length - 1, 0) : Math.min(cur, Math.max(list.length - 1, 0))));
    }
    load(true);
    const isToday = date === localDateStr(new Date());
    const id = isToday ? setInterval(() => load(false), 60000) : null;
    return () => { cancelled = true; if (id) clearInterval(id); };
  }, [taskId, date, daysTaskId]);

  const n = entries ? entries.length : 0;
  useEffect(() => { setImgFailed(false); }, [idx, entries]);
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => setIdx((i) => { if (i >= n - 1) { setPlaying(false); return i; } return i + 1; }), 450);
    return () => clearInterval(id);
  }, [playing, n]);
  useEffect(() => { // preload the next frames so scrubbing / playing does not flash
    if (!entries) return;
    for (let k = 1; k <= 3; k++) { const s = entries[idx + k]?.snapshot; if (s) new Image().src = s; }
  }, [entries, idx]);

  // chart window: the whole day's data range, or the zoomed part of it
  const full = useMemo(() => {
    if (!entries || entries.length === 0) return null;
    const a = tms(entries[0]), b = tms(entries[entries.length - 1]);
    return b - a >= MIN_SPAN_MS ? [a, b] : [a - MIN_SPAN_MS / 2, b + MIN_SPAN_MS / 2];
  }, [entries]);
  const view = full && zoom ? clampView(zoom, full) : full;
  const segments = useMemo(() => (entries && entries.length ? dataSegments(entries) : []), [entries]);
  const zoomTo = (v) => setZoom(v && full ? clampView(v, full) : null);
  const zoomBy = (factor) => {
    if (!view) return;
    const c = entries[idx] ? Math.min(Math.max(tms(entries[idx]), view[0]), view[1]) : (view[0] + view[1]) / 2;
    zoomTo([c - (c - view[0]) * factor, c + (view[1] - c) * factor]);
  };
  // keep the selected minute on screen while playing / scrubbing inside a zoomed window
  useEffect(() => {
    if (!zoom || !full || !entries || !entries[idx]) return;
    const t = tms(entries[idx]);
    const [a, b] = clampView(zoom, full);
    if (t < a || t > b) setZoom(clampView([t - (b - a) / 2, t + (b - a) / 2], full));
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = entries && entries[idx];
  const prev = entries && idx > 0 ? entries[idx - 1] : null;
  const delta = cur && prev ? cur.blocks - prev.blocks : null;
  const task = tasks.find((t) => t.id === taskId);
  const stats = useMemo(() => (cur ? [
    ['เวลา', new Date(cur.at).toLocaleTimeString('th-TH', { hour12: false })],
    [cur.corrected ? 'บล็อก (ตรวจแก้)' : 'บล็อกที่นับได้', `${cur.blocks.toLocaleString()}${delta ? ` (${delta > 0 ? '+' : ''}${delta})` : ''}`],
    ['พื้นที่', `${Number(cur.area).toFixed(1)} m²${task ? ` / ${task.expectedArea}` : ''}`],
    ['ความคืบหน้า', `${cur.progressPct ?? 0}%`],
    [cur.corrected ? 'คน (ตรวจแก้)' : 'คนที่ตรวจพบ (AI)', `${cur.peopleDetected || 0} คน`],
  ] : []), [cur, delta, task]);

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-head">
        <h3>Timeline รายนาที</h3>
        <div className="toolbar">
          {!fixedTaskId && (
            <select className="select" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <input className="input" type="date" value={date} max={localDateStr(new Date())} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
      </div>
      <div className="card-body">
        {taskId && <DayCards days={days} date={date} onPick={setDate} />}
        {!taskId ? <div className="cell-muted">ยังไม่มี Task</div>
          : entries === null ? <div className="cell-muted" style={{ padding: 40, textAlign: 'center' }}>กำลังโหลดข้อมูล...</div>
          : n === 0 ? (
            <div className="empty-state"><div className="e-title">{days && days.length === 0 ? 'Task นี้ยังไม่มีข้อมูล Timeline' : 'ไม่มีข้อมูลในวันที่เลือก'}</div><div className="e-desc">{days && days.length > 0 ? 'เลือกวันที่มีข้อมูลจากการ์ดด้านบน — ' : ''}ระบบบันทึกทุก 1 นาทีเฉพาะตอน Task อยู่สถานะ "กำลังดำเนินการ"</div></div>
          ) : (
            <>
              <div className="tl-grid">
                <div className="tl-frame">
                  {cur.snapshot && !imgFailed
                    ? <img key={cur.snapshot} src={cur.snapshot} alt={`ภาพเวลา ${hhmm(new Date(cur.at))}`} onError={() => setImgFailed(true)} />
                    : <div className="tl-noimg">{cur.snapshot ? 'ไม่พบไฟล์ภาพ (อาจถูกลบตามนโยบายเก็บข้อมูล)' : 'ไม่มีภาพในนาทีนี้'}</div>}
                  {viewMode === 'ai' && cur.snapshot && !imgFailed && cur.detections?.image_width && <LabelOverlay label={cur.detections} />}
                  <div className="tabs tl-viewtabs" role="tablist" aria-label="รูปแบบภาพ">
                    <button type="button" role="tab" aria-selected={viewMode === 'raw'} className={`tab-btn${viewMode === 'raw' ? ' active' : ''}`} onClick={() => setViewMode('raw')}>Raw</button>
                    <button type="button" role="tab" aria-selected={viewMode === 'ai'} className={`tab-btn${viewMode === 'ai' ? ' active' : ''}`} onClick={() => setViewMode('ai')}>AI Label</button>
                  </div>
                  {viewMode === 'ai' && cur.snapshot && !imgFailed && (
                    <span className="tl-labelinfo">{cur.detections?.image_width
                      ? `อิฐ ${cur.detections.detections.filter((d) => d.in_roi).length}/${cur.detections.detections.length} · คน ${cur.detections.personDetections.length}`
                      : 'ไม่มีข้อมูล label ของนาทีนี้ (บันทึกก่อนเปิดใช้ หรือยังตรวจจับไม่เสร็จ)'}</span>
                  )}
                  <span className="tl-stamp">{new Date(cur.at).toLocaleString('th-TH', { hour12: false })}</span>
                </div>
                <div className="tl-stats">
                  {stats.map(([k, v]) => <div key={k} className="tl-stat"><span>{k}</span><strong>{v}</strong></div>)}
                  <div className="tl-stat"><span>สถานะ</span>{cur.status ? <StatusBadge status={cur.status} /> : <strong>—</strong>}</div>
                </div>
              </div>

              <div className="tl-controls">
                <button className="btn btn-secondary btn-sm" onClick={() => { if (idx >= n - 1) setIdx(0); setPlaying((p) => !p); }}>{playing ? 'หยุด' : 'เล่น'}</button>
                <input type="range" min={0} max={Math.max(n - 1, 0)} value={idx} aria-label="เลื่อนดูตามเวลา"
                  onChange={(e) => { followLive.current = Number(e.target.value) >= n - 1; setPlaying(false); setIdx(Number(e.target.value)); }} />
                <span className="cell-muted text-mono" style={{ fontSize: 12 }}>{idx + 1}/{n}</span>
              </div>
              <div className="tl-range cell-muted"><span>{hhmm(new Date(entries[0].at))}</span><span>{hhmm(new Date(entries[n - 1].at))}</span></div>

              <div className="tl-zoombar">
                <div className="tl-zoombtns">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => zoomBy(1 / 2)} title="ซูมเข้า (หรือ Ctrl/⌘ + เลื่อนล้อเมาส์บนกราฟ)">＋</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => zoomBy(2)} disabled={!zoom} title="ซูมออก">－</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => { const t = tms(cur); zoomTo([t - 15 * 60000, t + 15 * 60000]); }} title="โฟกัส ±15 นาทีรอบจุดที่เลือก">โฟกัสจุดที่เลือก</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setZoom(null)} disabled={!zoom}>ทั้งวัน</button>
                  <span className="cell-muted text-mono" style={{ fontSize: 12 }}>{hhmm(new Date(view[0]))}–{hhmm(new Date(view[1]))}</span>
                </div>
                {segments.length > 1 && (
                  <div className="tl-segs">
                    <span className="cell-muted" style={{ fontSize: 12 }}>ช่วงที่มีข้อมูล:</span>
                    {segments.map((sg, i) => {
                      const active = zoom && Math.abs(view[0] - sg.from) < 2 * 60000 + (sg.to - sg.from) * 0.1 && Math.abs(view[1] - sg.to) < 2 * 60000 + (sg.to - sg.from) * 0.1;
                      return (
                        <button key={i} type="button" className={`tl-seg${active ? ' active' : ''}`}
                          onClick={() => { const padMs = Math.max((sg.to - sg.from) * 0.05, 60000); zoomTo([sg.from - padMs, sg.to + padMs]); }}>
                          {hhmm(new Date(sg.from))}–{hhmm(new Date(sg.to))} <small>{sg.count} นาที</small>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <TimelineChart entries={entries} idx={idx} view={view} onZoom={zoomTo}
                onPick={(i) => { followLive.current = i >= n - 1; setPlaying(false); setIdx(i); }} />
              <TimelineNavigator entries={entries} view={view} full={full} onView={zoomTo} />
              <div className="tl-legend cell-muted">
                <span><i style={{ background: 'var(--accent)' }} />ความคืบหน้า (%)</span>
                <span><i style={{ background: 'var(--purple)', opacity: 0.5 }} />คนที่ตรวจพบ</span>
                <span><i style={{ background: 'var(--gray-tint)', border: '1px solid var(--divider-strong)' }} />ไม่มีข้อมูล (พัก / นอกเวลา / ขาดภาพ)</span>
              </div>
            </>
          )}
      </div>
    </div>
  );
}
