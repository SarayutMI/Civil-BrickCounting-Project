import { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBadge } from '../utils.jsx';
import * as api from '../api.js';

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

function TimelineChart({ entries, idx, onPick }) {
  const W = 720, H = 190, L = 36, R = 36, T = 14, B = 26;
  const t0 = new Date(entries[0].at).getTime();
  const t1 = new Date(entries[entries.length - 1].at).getTime();
  const span = Math.max(t1 - t0, 1);
  const x = (e) => (entries.length === 1 ? (L + W - R) / 2 : L + ((new Date(e.at).getTime() - t0) / span) * (W - L - R));
  const yPct = (v) => H - B - (Math.min(Math.max(v, 0), 100) / 100) * (H - T - B);
  const maxPeople = Math.max(...entries.map((e) => e.peopleDetected || 0), 1);
  const yPeople = (v) => H - B - (v / maxPeople) * (H - T - B);

  const pts = entries.map((e) => [x(e), yPct(e.progressPct ?? 0)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const gaps = [];
  for (let i = 1; i < entries.length; i++) {
    if (new Date(entries[i].at) - new Date(entries[i - 1].at) > GAP_MS) gaps.push([x(entries[i - 1]), x(entries[i])]);
  }
  const ticks = 6;
  const cur = entries[idx];

  function pick(ev) {
    const svg = ev.currentTarget;
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let best = 0, bd = Infinity;
    entries.forEach((e, i) => { const d = Math.abs(x(e) - px); if (d < bd) { bd = d; best = i; } });
    onPick(best);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="tl-chart" role="img" aria-label="กราฟความคืบหน้าตามเวลา"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e); }}
      onPointerMove={(e) => { if (e.buttons) pick(e); }}>
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={yPct(v)} y2={yPct(v)} stroke="var(--divider)" strokeWidth="1" />
          <text x={L - 6} y={yPct(v) + 3} fontSize="10" fill="var(--muted)" textAnchor="end">{v}%</text>
        </g>
      ))}
      <text x={W - R + 6} y={T + 4} fontSize="10" fill="var(--purple)">{maxPeople} คน</text>
      {gaps.map(([a, b], i) => <rect key={i} x={a} y={T} width={b - a} height={H - T - B} fill="var(--gray-tint)" />)}
      {entries.map((e, i) => (e.peopleDetected ? (
        <rect key={i} x={x(e) - 1.5} y={yPeople(e.peopleDetected)} width="3" height={H - B - yPeople(e.peopleDetected)} fill="var(--purple)" opacity="0.35" />
      ) : null))}
      <path d={`${line} L${pts[pts.length - 1][0]},${yPct(0)} L${pts[0][0]},${yPct(0)} Z`} fill="var(--accent)" opacity="0.08" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" />
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const tt = new Date(t0 + (span * i) / ticks);
        return <text key={i} x={L + ((W - L - R) * i) / ticks} y={H - 8} fontSize="10" fill="var(--muted)" textAnchor="middle">{hhmm(tt)}</text>;
      })}
      <line x1={x(cur)} x2={x(cur)} y1={T} y2={H - B} stroke="var(--text)" strokeWidth="1" strokeDasharray="3 3" />
      <circle cx={x(cur)} cy={yPct(cur.progressPct ?? 0)} r="5" fill="var(--accent)" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

export default function TaskTimeline({ tasks }) {
  const [taskId, setTaskId] = useState(tasks[0]?.id || '');
  const [date, setDate] = useState(() => localDateStr(new Date()));
  const [entries, setEntries] = useState(null); // null = loading
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const followLive = useRef(true); // stay on the newest minute unless the user moved away

  useEffect(() => { if (!taskId && tasks[0]) setTaskId(tasks[0].id); }, [tasks, taskId]);

  useEffect(() => {
    if (!taskId) return undefined;
    let cancelled = false;
    setEntries(null);
    followLive.current = true;
    async function load(first) {
      const list = (await api.getTaskHistory(taskId, dayRange(date))).filter((e) => e && e.at);
      if (cancelled) return;
      setEntries(list);
      setIdx((cur) => (first || followLive.current ? Math.max(list.length - 1, 0) : Math.min(cur, Math.max(list.length - 1, 0))));
    }
    load(true);
    const isToday = date === localDateStr(new Date());
    const id = isToday ? setInterval(() => load(false), 60000) : null;
    return () => { cancelled = true; if (id) clearInterval(id); };
  }, [taskId, date]);

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

  const cur = entries && entries[idx];
  const prev = entries && idx > 0 ? entries[idx - 1] : null;
  const delta = cur && prev ? cur.blocks - prev.blocks : null;
  const task = tasks.find((t) => t.id === taskId);
  const stats = useMemo(() => (cur ? [
    ['เวลา', new Date(cur.at).toLocaleTimeString('th-TH', { hour12: false })],
    ['บล็อกที่นับได้', `${cur.blocks.toLocaleString()}${delta ? ` (${delta > 0 ? '+' : ''}${delta})` : ''}`],
    ['พื้นที่', `${Number(cur.area).toFixed(1)} m²${task ? ` / ${task.expectedArea}` : ''}`],
    ['ความคืบหน้า', `${cur.progressPct ?? 0}%`],
    ['คนที่ตรวจพบ (AI)', `${cur.peopleDetected || 0} คน`],
  ] : []), [cur, delta, task]);

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-head">
        <h3>Timeline รายนาที</h3>
        <div className="toolbar">
          <select className="select" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            {tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input className="input" type="date" value={date} max={localDateStr(new Date())} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
      </div>
      <div className="card-body">
        {!taskId ? <div className="cell-muted">ยังไม่มี Task</div>
          : entries === null ? <div className="cell-muted" style={{ padding: 40, textAlign: 'center' }}>กำลังโหลดข้อมูล...</div>
          : n === 0 ? (
            <div className="empty-state"><div className="e-title">ไม่มีข้อมูลในวันที่เลือก</div><div className="e-desc">ระบบบันทึกทุก 1 นาทีเฉพาะตอน Task อยู่สถานะ "กำลังดำเนินการ"</div></div>
          ) : (
            <>
              <div className="tl-grid">
                <div className="tl-frame">
                  {cur.snapshot && !imgFailed
                    ? <img key={cur.snapshot} src={cur.snapshot} alt={`ภาพเวลา ${hhmm(new Date(cur.at))}`} onError={() => setImgFailed(true)} />
                    : <div className="tl-noimg">{cur.snapshot ? 'ไม่พบไฟล์ภาพ (อาจถูกลบตามนโยบายเก็บข้อมูล)' : 'ไม่มีภาพในนาทีนี้'}</div>}
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

              <TimelineChart entries={entries} idx={idx} onPick={(i) => { followLive.current = i >= n - 1; setPlaying(false); setIdx(i); }} />
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
