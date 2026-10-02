import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from './Toast.jsx';
import { ResultSourceToggle } from './ProductivityReport.jsx';
import * as api from '../api.js';

/* ===================================================================
   Human-in-the-loop label review for one task's saved frames.
   Tools (like any drawing editor) — the full shortcut list is in SHORTCUTS (press ? on the page):
   - N  สร้างกรอบ: drag to draw a new box of the chosen class — อิฐบล็อก (B) / คน (H, or P)
   - V  เลือก / ย้าย: click a drawn box to select, drag to move, drag a corner to resize;
        B / H changes the selected box's class, arrow keys nudge it (Shift = bigger steps),
        Tab cycles through the drawn boxes, Ctrl/⌘+D duplicates the selected one
   - click an AI box (in either tool) to mark it wrong, click again to restore
   - Delete removes the selection, Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z (or Ctrl+Y) redo, Esc deselect
   - R  แก้ ROI: drag a corner to move it, drag a "+" on an edge to add a corner,
        double-click a corner to remove it; "วาด ROI ใหม่" = click the corners, then click the
        first one (or Enter) to close. The corrected ROI is saved with the frame, or applied to
        every frame with "ใช้ ROI นี้กับทุกภาพ"
   - X takes the current frame out of the count (camera moved / blocked / broken image). Frames can
     also be ticked in the list (Shift+click = range) and taken out or restored together; a taken-out
     frame can be deleted for good from its row. Taken-out frames are not counted anywhere (server).
   - ← / → or A / D change frame (arrows only when nothing is selected), S saves, Shift+S saves and
     goes to the next frame, F hides / shows the AI boxes
   The count shown is recomputed live with the same rules the server
   uses (humanLabels.js): a brick counts when its centre is inside the ROI
   (the corrected ROI if one was drawn); people are counted over the whole frame (ROI ignored).
=================================================================== */

function pointInPolygon(x, y, poly) {
  if (!Array.isArray(poly) || poly.length < 3) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const dayTime = (iso) => new Date(iso).toLocaleString('th-TH', { hour12: false, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
// shown in the "คีย์ลัด" panel (? key) — keep in step with onKey below
const SHORTCUTS = [
  ['เครื่องมือ', [['N', 'สร้างกรอบใหม่ (ลากบนภาพ)'], ['V', 'เลือก / ย้าย / ย่อขยายกรอบ'], ['R', 'แก้ ROI']]],
  ['ประเภทกรอบ', [['B', 'อิฐบล็อก (หรือเปลี่ยนกรอบที่เลือกเป็นอิฐ)'], ['H', 'คน (หรือเปลี่ยนกรอบที่เลือกเป็นคน) · P ก็ได้']]],
  ['แก้กรอบ', [['Delete / Backspace', 'ลบกรอบที่เลือก'], ['Ctrl/⌘ + D', 'ทำซ้ำกรอบที่เลือก'], ['Tab / Shift+Tab', 'เลือกกรอบถัดไป / ก่อนหน้า'],
    ['← ↑ → ↓', 'ขยับกรอบที่เลือก (Shift = ทีละมาก)'], ['คลิกกรอบ AI', 'ลบ / คืนกรอบของ AI'], ['Esc', 'ยกเลิกการเลือก / ยกเลิกวาด ROI']]],
  ['ประวัติ', [['Ctrl/⌘ + Z', 'Undo'], ['Ctrl/⌘ + Shift + Z หรือ Ctrl + Y', 'Redo']]],
  ['ภาพ', [['A / ←', 'ภาพก่อนหน้า'], ['D / →', 'ภาพถัดไป'], ['F', 'ซ่อน / แสดงกรอบของ AI'], ['S หรือ Ctrl/⌘ + S', 'บันทึก'], ['Shift + S', 'บันทึก แล้วไปภาพถัดไป']]],
  ['ROI (โหมด R)', [['ลากมุม', 'ย้ายมุม'], ['ลาก +', 'เพิ่มมุม'], ['ดับเบิลคลิกมุม', 'ลบมุม'], ['Enter', 'ปิด ROI ที่วาดใหม่']]],
  ['ตัดภาพออก', [['X', 'ตัดภาพนี้ออกจากการนับ / กู้คืน'], ['คลิกช่องติ๊ก', 'เลือกหลายภาพ'], ['Shift + คลิกช่องติ๊ก', 'เลือกเป็นช่วง']]],
  ['อื่น ๆ', [['?', 'เปิด / ปิดหน้านี้']]],
];
const FILTERS = [['all', 'ทั้งหมด'], ['todo', 'ยังไม่ตรวจ'], ['done', 'ตรวจแล้ว'], ['excluded', 'ตัดออกแล้ว']];
// keep in step with EXCLUDE_REASONS in server.js
const EXCLUDE_REASONS = [['camera_moved', 'ย้ายกล้อง / กล้องเบี้ยว'], ['blocked', 'ภาพถูกบัง'], ['bad_image', 'ภาพเสีย / มืด / เบลอ'], ['off_hours', 'นอกเวลาทำงาน'], ['other', 'อื่น ๆ']];
const reasonText = (k) => (EXCLUDE_REASONS.find(([v]) => v === k) || [null, 'อื่น ๆ'])[1];
// latest frame still counted = where the task's current numbers come from
const latestCounted = (list, skip = new Set()) => { for (let i = list.length - 1; i >= 0; i--) if (!list[i].excluded && !skip.has(list[i].id)) return list[i]; return null; };

function SummaryPanel({ summary, frames, blocksPerSqm, onOpen, taskId, onSourceChanged }) {
  if (!summary) return <div className="cell-muted" style={{ padding: 30 }}>กำลังโหลด...</div>;
  const s = summary.stats;
  const pctTxt = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);
  const last = frames[frames.length - 1];
  const fin = summary.finalCorrected;
  const W = 640, H = 150, L = 30, R = 10, T = 10, B = 22;
  const pts = summary.frames;
  const t0 = pts.length ? new Date(pts[0].at).getTime() : 0, t1 = pts.length ? new Date(pts[pts.length - 1].at).getTime() : 1;
  const max = Math.max(1, ...pts.map((f) => Math.max(f.aiBlocks, f.correctedBlocks)));
  const x = (f) => (pts.length === 1 ? (L + W - R) / 2 : L + ((new Date(f.at).getTime() - t0) / Math.max(t1 - t0, 1)) * (W - L - R));
  const y = (v) => H - B - (v / max) * (H - T - B);
  const line = (key) => pts.map((f, i) => `${i ? 'L' : 'M'}${x(f).toFixed(1)},${y(f[key]).toFixed(1)}`).join(' ');
  return (
    <div className="le-summary">
      <div className="prod-kpis">
        <div className="prod-kpi"><span>ภาพที่ตรวจแล้ว</span><strong>{s.reviewed} / {frames.length}</strong><small>ภาพ</small></div>
        <div className="prod-kpi"><span>ผลหลังตรวจแก้ (ภาพล่าสุดที่ตรวจ)</span><strong>{fin ? `${fin.blocks.toLocaleString()} บล็อก` : '—'}</strong><small>{fin ? `${blocksPerSqm ? `${(fin.blocks * blocksPerSqm).toFixed(3)} ตร.ม. · ` : ''}AI นับได้ ${last?.blocks ?? '—'} บล็อก` : 'ยังไม่ได้ตรวจแก้ภาพไหน'}</small></div>
        <div className="prod-kpi"><span>AI ทายถูก (precision)</span><strong>{pctTxt(s.precision)}</strong><small>กรอบ AI ที่คนเก็บไว้ · ลบ {s.removed} จาก {s.aiBoxes}</small></div>
        <div className="prod-kpi"><span>AI หาเจอ (recall)</span><strong>{pctTxt(s.recall)}</strong><small>อิฐจริงที่ AI เจอ · คนเพิ่ม {s.added} กรอบ</small></div>
      </div>
      <div className="prod-kpis">
        <div className="prod-kpi"><span>คน: AI ตรวจพบรวม</span><strong>{s.people.aiBoxes}</strong><small>กรอบคนในภาพที่ตรวจแล้ว</small></div>
        <div className="prod-kpi"><span>คน: ลบ / เพิ่ม</span><strong>−{s.people.removed} / +{s.people.added}</strong><small>กรอบที่คนตรวจแก้</small></div>
        <div className="prod-kpi"><span>AI ตรวจคนถูก (precision)</span><strong>{pctTxt(s.people.precision)}</strong><small>กรอบคนของ AI ที่เก็บไว้</small></div>
        <div className="prod-kpi"><span>AI หาคนเจอ (recall)</span><strong>{pctTxt(s.people.recall)}</strong><small>คนจริงที่ AI เจอ</small></div>
      </div>
      <div className="rs-card">
        <div>
          <strong>บันทึกเป็นผลลัพธ์ของงานนี้</strong>
          <p>งานนี้มีผลลัพธ์ 2 ชุด — ① ผลที่ AI นับ (ต้นฉบับ ไม่ถูกแก้ทับ) และ ② ผลหลังคนตรวจแก้ (ใช้ภาพล่าสุดที่ตรวจแก้แล้ว).
            ชุดที่เลือกจะถูกใช้ใน Productivity, Reports, PDF และ Word — สลับกลับได้ตลอด</p>
        </div>
        <ResultSourceToggle taskId={taskId} value={summary.resultSource} available={!!fin} aiBlocks={last?.blocks}
          humanLatest={fin} onChanged={(src) => onSourceChanged && onSourceChanged(src)} />
      </div>
      {pts.length > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} className="le-chart">
          {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="var(--divider)" /><text x={L - 4} y={y(max * f) + 3} fontSize="9" textAnchor="end" fill="var(--muted)">{Math.round(max * f)}</text></g>)}
          <path d={line('aiBlocks')} fill="none" stroke="#9aa1ab" strokeWidth="2" strokeDasharray="5 4" />
          <path d={line('correctedBlocks')} fill="none" stroke="var(--accent)" strokeWidth="2.2" />
          {pts.map((f) => <circle key={f.id} cx={x(f)} cy={y(f.correctedBlocks)} r="3" fill="var(--accent)" />)}
          <text x={W - R} y={T + 4} fontSize="10" textAnchor="end" fill="var(--muted)">— ผลหลังตรวจแก้  - - AI</text>
        </svg>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr><th>เวลาภาพ</th><th>อิฐ AI</th><th>ลบ</th><th>เพิ่ม</th><th>อิฐหลังแก้</th><th>พื้นที่หลังแก้</th><th>คน AI</th><th>คนหลังแก้</th><th>ผู้ตรวจ</th><th>หมายเหตุ</th></tr></thead>
          <tbody>
            {summary.frames.length === 0 ? <tr><td colSpan={10}><div className="empty-state"><div className="e-title">ยังไม่ได้ตรวจแก้ภาพไหน</div></div></td></tr>
              : [...summary.frames].reverse().map((f) => (
                <tr key={f.id} className="clickable" onClick={() => onOpen(f.id)}>
                  <td>{dayTime(f.at)}</td><td>{f.aiInRoi}</td><td className="le-minus">−{f.removedInRoi}</td><td className="le-plus">+{f.addedInRoi}</td>
                  <td className="cell-strong">{f.correctedBlocks}</td><td>{f.correctedArea ?? '—'}</td>
                  <td>{f.aiPersonCount}{f.removedPersonCount ? <span className="le-minus"> −{f.removedPersonCount}</span> : null}{f.addedPersonCount ? <span className="le-plus"> +{f.addedPersonCount}</span> : null}</td>
                  <td className="cell-strong">{f.correctedPeople}</td><td className="cell-muted">{f.by || '—'}</td><td className="cell-muted">{f.note || ''}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LabelEditor({ task, onClose, onSourceChanged, onTaskChanged }) {
  const toast = useToast();
  const [tab, setTab] = useState('label');
  const [frames, setFrames] = useState(null);
  const [filter, setFilter] = useState('all');
  const [curId, setCurId] = useState(null);
  const [frame, setFrame] = useState(null); // full frame (boxes + labels)
  const [added, setAdded] = useState([]); // [{x1,y1,x2,y2}] 0..1
  const [removed, setRemoved] = useState(() => new Set()); // AI brick boxes marked wrong
  const [removedPersons, setRemovedPersons] = useState(() => new Set()); // AI person boxes marked wrong
  const [tool, setTool] = useState('brick'); // what a drag draws: 'brick' | 'person'
  const [note, setNote] = useState('');
  const [mode, setMode] = useState('draw'); // 'draw' = new box | 'select' = select / move / resize | 'roi' = edit the ROI
  const [roiDraft, setRoiDraft] = useState(null); // corrected ROI of this frame ([[x,y]...] 0..1), null = the AI ROI
  const [roiNew, setRoiNew] = useState(null); // corners clicked so far while redrawing the ROI
  const [selected, setSelected] = useState(null); // index into added
  const [drag, setDrag] = useState(null); // { kind: 'draw'|'move'|'resize'|'click', x0,y0,x1,y1, idx, corner, orig, before, moved }
  const [past, setPast] = useState([]); // undo stack of { added, removed, removedPersons, roi }
  const [future, setFuture] = useState([]); // redo stack
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState(null);
  const [showAi, setShowAi] = useState(true); // F: hide the AI boxes to see the bricks underneath
  const [showHelp, setShowHelp] = useState(false); // ?: shortcut list
  const [picked, setPicked] = useState(() => new Set()); // frames ticked in the list (take out / restore together)
  const [lastPick, setLastPick] = useState(null); // anchor for Shift+click range
  const [reason, setReason] = useState('camera_moved');
  const [excluding, setExcluding] = useState(false);
  const svgRef = useRef(null);

  const loadFrames = useCallback(async () => {
    const list = await api.getLabelFrames(task.id);
    setFrames(list);
    return list;
  }, [task.id]);
  useEffect(() => { loadFrames().then((list) => { if (list.length) setCurId(list[list.length - 1].id); }); }, [loadFrames]);
  useEffect(() => { if (tab === 'summary') api.getLabelSummary(task.id).then(setSummary); }, [tab, task.id, frames]);

  // load one frame and seed the draft from what was saved
  useEffect(() => {
    if (!curId) return;
    let cancelled = false;
    setFrame(null);
    api.getLabelFrame(task.id, curId).then((f) => {
      if (cancelled || !f) return;
      setFrame(f);
      setAdded(f.labels?.added || []);
      setRemoved(new Set(f.labels?.removed || []));
      setRemovedPersons(new Set(f.labels?.removedPersons || []));
      setNote(f.labels?.note || '');
      setRoiDraft(f.labels?.roi || null); setRoiNew(null);
      setSelected(null); setDrag(null); setPast([]); setFuture([]); setDirty(false);
    });
    return () => { cancelled = true; };
  }, [task.id, curId]);

  const shown = useMemo(() => (frames || []).filter((f) => (filter === 'excluded' ? f.excluded
    : filter === 'todo' ? !f.excluded && f.correctedBlocks === null : filter === 'done' ? !f.excluded && f.correctedBlocks !== null : true)), [frames, filter]);
  const excludedCount = useMemo(() => (frames || []).filter((f) => f.excluded).length, [frames]);
  const idx = frames ? frames.findIndex((f) => f.id === curId) : -1;

  function go(delta) {
    if (!frames || idx < 0) return;
    const next = frames[idx + delta];
    if (!next) return;
    if (dirty && !window.confirm('ยังไม่ได้บันทึกการแก้ไขของภาพนี้ ต้องการข้ามไปโดยไม่บันทึก?')) return;
    setCurId(next.id);
  }
  /* ---- take frames out of the count / restore (rows + images stay) ---- */
  function togglePick(f, shift) {
    const list = [...shown].reverse(); // same order as the list on screen
    setPicked((s0) => {
      const n = new Set(s0);
      const on = !n.has(f.id);
      const a = shift && lastPick ? list.findIndex((x) => x.id === lastPick) : -1;
      const b = list.findIndex((x) => x.id === f.id);
      if (a >= 0 && b >= 0) list.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => (on ? n.add(x.id) : n.delete(x.id)));
      else if (on) n.add(f.id); else n.delete(f.id);
      return n;
    });
    setLastPick(f.id);
  }
  async function setExcluded(ids, excluded) {
    if (!ids.length || excluding) return;
    const byId = new Map(frames.map((f) => [f.id, f]));
    const targets = ids.map((id) => byId.get(id)).filter((f) => f && !!f.excluded !== excluded);
    if (!targets.length) { toast(excluded ? 'ภาพที่เลือกถูกตัดออกอยู่แล้ว' : 'ภาพที่เลือกยังนับอยู่แล้ว'); return; }
    const ats = targets.map((f) => f.at).sort();
    const when = targets.length === 1 ? `ภาพเวลา ${dayTime(ats[0])}` : `${targets.length} ภาพ (${dayTime(ats[0])} – ${dayTime(ats[ats.length - 1])})`;
    // what the task's current numbers become (they follow the latest counted frame)
    const before = latestCounted(frames);
    const after = excluded ? latestCounted(frames, new Set(targets.map((f) => f.id)))
      : latestCounted(frames.map((f) => (targets.includes(f) ? { ...f, excluded: false } : f)));
    const impact = before?.id === after?.id ? ''
      : `\n\nตัวเลขปัจจุบันของงานจะเปลี่ยน (ตามภาพล่าสุดที่นับ):\nอิฐ ${before ? before.blocks : 0} → ${after ? after.blocks : 0} บล็อก · พื้นที่ ${before ? before.area : 0} → ${after ? after.area : 0} ตร.ม.`;
    const msg = excluded
      ? `ตัด${when} ออกจากการนับ?\nเหตุผล: ${reasonText(reason)}\n\nภาพจะไม่ถูกนับในกราฟ, Productivity, รายงาน และไทม์แลปส์ (กู้คืนได้ภายหลัง)${impact}`
      : `กู้คืน${when} กลับมานับ?${impact}`;
    if (!window.confirm(msg)) return;
    setExcluding(true);
    const { ok, data } = await api.excludeLabelFrames(task.id, targets.map((f) => f.id), excluded, reason);
    setExcluding(false);
    if (!ok) { toast((data && data.message) || (excluded ? 'ตัดภาพออกไม่สำเร็จ' : 'กู้คืนภาพไม่สำเร็จ')); return; }
    const changed = new Set(data.changed);
    const patch = excluded ? { excluded: true, excludedReason: data.reason } : { excluded: false, excludedReason: null };
    setFrames((list) => list.map((f) => (changed.has(f.id) ? { ...f, ...patch } : f)));
    if (changed.has(curId)) setFrame((f) => (f ? { ...f, ...patch } : f));
    setPicked(new Set());
    if (data.task && onTaskChanged) onTaskChanged(data.task);
    toast(excluded ? `ตัดออกจากการนับแล้ว ${changed.size} ภาพ` : `กู้คืนแล้ว ${changed.size} ภาพ`, 'success');
  }
  // this frame and every frame after it — the usual case: the camera was moved / taken down at the end
  const fromHereIds = () => (idx < 0 ? [] : frames.slice(idx).filter((f) => !f.excluded).map((f) => f.id));
  // ลบภาพที่ตัดออกแล้วทิ้งถาวร (ภาพ + จำนวนที่ AI นับ + ผลตรวจแก้) — กู้คืนไม่ได้
  async function removeFrame(f) {
    const msg = `ลบภาพเวลา ${dayTime(f.at)} ทิ้งถาวร?\n\nไฟล์ภาพ จำนวนอิฐ/คนที่ AI นับ และผลตรวจแก้ของภาพนี้จะถูกลบ — กู้คืนไม่ได้`;
    if (!window.confirm(msg)) return;
    const { ok, data } = await api.deleteLabelFrame(task.id, f.id);
    if (!ok) { toast((data && data.message) || 'ลบภาพไม่สำเร็จ'); return; }
    const i = frames.findIndex((x) => x.id === f.id);
    const list = frames.filter((x) => x.id !== f.id);
    setFrames(list);
    setPicked((s0) => { const n = new Set(s0); n.delete(f.id); return n; });
    if (f.id === curId) {
      const next = list[i] || list[i - 1] || null; // ภาพถัดไปตามเวลา หรือภาพก่อนหน้าถ้าลบภาพสุดท้าย
      setDirty(false);
      setCurId(next ? next.id : null);
      if (!next) setFrame(null);
    }
    toast('ลบภาพถาวรแล้ว', 'success');
  }
  function open(id) {
    if (id === curId) { setTab('label'); return; }
    if (dirty && !window.confirm('ยังไม่ได้บันทึกการแก้ไขของภาพนี้ ต้องการข้ามไปโดยไม่บันทึก?')) return;
    setCurId(id); setTab('label');
  }

  const det = frame?.detections;
  const iw = det?.image_width || 1, ih = det?.image_height || 1;
  // with a corrected ROI the AI bricks are re-tested by their centres (same as the server)
  const aiBoxes = useMemo(() => (det?.detections || []).map((d, i) => {
    const b = { i, x1: d.x1 / iw, y1: d.y1 / ih, x2: d.x2 / iw, y2: d.y2 / ih, conf: d.conf };
    return { ...b, inRoi: roiDraft ? pointInPolygon((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, roiDraft) : d.in_roi };
  }), [det, iw, ih, roiDraft]);
  const aiPersons = useMemo(() => (det?.personDetections || []).map((d, i) => ({ i, x1: d.x1 / iw, y1: d.y1 / ih, x2: d.x2 / iw, y2: d.y2 / ih, conf: d.conf })), [det, iw, ih]);
  const aiRoi = frame?.roi || [];
  const roi = roiDraft || aiRoi;
  const counts = useMemo(() => {
    const inR = (b) => pointInPolygon((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, roi);
    const isBrick = (b) => (b.cls || 'brick') === 'brick';
    const aiInRoi = det ? aiBoxes.filter((b) => b.inRoi).length : (frame?.blocks || 0);
    const removedInRoi = aiBoxes.filter((b) => b.inRoi && removed.has(b.i)).length;
    const addedInRoi = added.filter((b) => isBrick(b) && inR(b)).length;
    const aiP = det?.personDetections ? aiPersons.length : (frame?.peopleDetected || 0); // people: whole frame
    const remP = aiPersons.filter((b) => removedPersons.has(b.i)).length;
    const addP = added.filter((b) => !isBrick(b)).length;
    return {
      aiInRoi, removedInRoi, addedInRoi, corrected: Math.max(aiInRoi - removedInRoi + addedInRoi, 0),
      aiP, remP, addP, correctedPeople: Math.max(aiP - remP + addP, 0), outside: added.filter((b) => isBrick(b) && !inR(b)).length,
    };
  }, [det, aiBoxes, aiPersons, removed, removedPersons, added, roi, frame]);

  async function save(andNext = false) {
    if (!frame) return;
    setSaving(true);
    const res = await api.saveLabelFrame(task.id, frame.id, { added, removed: [...removed], removedPersons: [...removedPersons], note, roi: roiDraft });
    setSaving(false);
    if (!res.ok) { toast(res.data.message || 'บันทึกไม่สำเร็จ'); return; }
    setDirty(false);
    const switched = res.data.resultSource === 'human' && (task.resultSource || 'ai') !== 'human';
    if (switched && onSourceChanged) onSourceChanged('human');
    toast(`บันทึกแล้ว — ภาพนี้นับได้ ${res.data.correctedBlocks} บล็อก · ${res.data.correctedPeople} คน · Report / Productivity อัปเดตตามผลตรวจแก้แล้ว${switched ? ' (งานนี้เปลี่ยนไปใช้ตัวเลือกที่ 2 — สลับกลับได้ที่แท็บ "สรุปผล")' : ''}`, 'success');
    const list = await loadFrames();
    if (andNext) { const i = list.findIndex((f) => f.id === frame.id); if (list[i + 1]) setCurId(list[i + 1].id); }
  }
  async function clearReview() {
    if (!frame || !window.confirm('ล้างผลตรวจแก้ของภาพนี้ กลับไปใช้ค่าของ AI?')) return;
    const res = await api.saveLabelFrame(task.id, frame.id, { clear: true });
    if (!res.ok) { toast(res.data.message || 'ล้างไม่สำเร็จ'); return; }
    setAdded([]); setRemoved(new Set()); setRemovedPersons(new Set()); setNote(''); setRoiDraft(null); setRoiNew(null); setDirty(false);
    await loadFrames();
    toast('ล้างผลตรวจแก้แล้ว');
  }

  /* ---- edit history (undo / redo) ---- */
  const snapshot = () => ({ added, removed: [...removed], removedPersons: [...removedPersons], roi: roiDraft });
  function restore(snap) {
    setAdded(snap.added); setRemoved(new Set(snap.removed)); setRemovedPersons(new Set(snap.removedPersons)); setRoiDraft(snap.roi); setRoiNew(null);
    setSelected((sel) => (sel !== null && sel < snap.added.length ? sel : null)); // keep the selection if that box still exists
    setDirty(true);
  }
  function pushHistory(before = snapshot()) {
    setPast((p) => [...p.slice(-99), before]);
    setFuture([]);
    setDirty(true);
  }
  function undo() {
    if (!past.length) return;
    setFuture((f) => [snapshot(), ...f].slice(0, 100));
    restore(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  }
  function redo() {
    if (!future.length) return;
    setPast((p) => [...p, snapshot()]);
    restore(future[0]);
    setFuture((f) => f.slice(1));
  }

  /* ---- edits ---- */
  function deleteSelected() {
    if (selected === null) return;
    pushHistory();
    setAdded((a) => a.filter((_, i) => i !== selected));
    setSelected(null);
  }
  function setSelectedClass(cls) {
    if (selected === null || (added[selected]?.cls || 'brick') === cls) return;
    pushHistory();
    setAdded((a) => a.map((b, i) => (i === selected ? { ...b, cls } : b)));
  }
  function nudge(dx, dy) {
    if (selected === null) return;
    pushHistory();
    setAdded((a) => a.map((b, i) => {
      if (i !== selected) return b;
      const mx = Math.min(Math.max(dx, -b.x1), 1 - b.x2), my = Math.min(Math.max(dy, -b.y1), 1 - b.y2);
      return { ...b, x1: b.x1 + mx, x2: b.x2 + mx, y1: b.y1 + my, y2: b.y2 + my };
    }));
  }
  function duplicateSelected() {
    if (selected === null || !added[selected]) return;
    const b = added[selected], w = b.x2 - b.x1, h = b.y2 - b.y1;
    const x1 = Math.min(b.x1 + 0.015, 1 - w), y1 = Math.min(b.y1 + 0.015, 1 - h);
    pushHistory();
    setAdded((a) => [...a, { ...b, x1, y1, x2: x1 + w, y2: y1 + h }]);
    setSelected(added.length);
    setMode('select');
  }
  function cycleSelection(dir) {
    if (!added.length) return;
    setMode('select');
    setSelected((s) => (s === null ? (dir > 0 ? 0 : added.length - 1) : (s + dir + added.length) % added.length));
  }
  function toggleAiBox(hit) {
    pushHistory();
    const setter = hit.kind === 'person' ? setRemovedPersons : setRemoved;
    setter((s) => { const n = new Set(s); if (n.has(hit.i)) n.delete(hit.i); else n.add(hit.i); return n; });
  }
  function clearFrame() {
    if (!added.length && !removed.size && !removedPersons.size && !roiDraft) return;
    pushHistory();
    setAdded([]); setRemoved(new Set()); setRemovedPersons(new Set()); setRoiDraft(null); setRoiNew(null); setSelected(null);
  }

  /* ---- ROI ---- */
  function resetRoi() {
    if (!roiDraft) return;
    pushHistory();
    setRoiDraft(null); setRoiNew(null);
  }
  function finishRoiNew(pts) {
    setRoiNew(null);
    if (pts.length < 3) { toast('ROI ต้องมีอย่างน้อย 3 จุด'); return; }
    pushHistory();
    setRoiDraft(pts);
  }
  function removeRoiPoint(i) {
    if (roi.length <= 3) { toast('ROI ต้องมีอย่างน้อย 3 จุด'); return; }
    pushHistory();
    setRoiDraft(roi.filter((_, k) => k !== i));
  }
  async function applyRoiToAll() {
    const target = roiDraft;
    const msg = target
      ? `ใช้ ROI นี้กับทุกภาพของงาน (${frames.length} ภาพ)?\nการแก้กรอบที่ทำไว้ในแต่ละภาพยังอยู่ ทุกภาพจะถูกนับใหม่ด้วย ROI นี้และถือว่าตรวจแล้ว`
      : 'คืน ROI เดิมของ AI ให้ทุกภาพที่เคยแก้ ROI?';
    if (!window.confirm(msg)) return;
    const { ok, data } = await api.applyLabelRoi(task.id, target);
    if (!ok) { toast(data.message || 'ไม่สำเร็จ'); return; }
    setDirty(false);
    if (data.resultSource === 'human' && (task.resultSource || 'ai') !== 'human' && onSourceChanged) onSourceChanged('human');
    toast(target ? `ใช้ ROI นี้กับ ${data.frames} ภาพแล้ว` : `คืน ROI เดิมให้ ${data.frames} ภาพแล้ว`, 'success');
    await loadFrames();
  }

  // keyboard shortcuts (ignored while typing in the note box)
  useEffect(() => {
    function onKey(e) {
      if (tab !== 'label' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      const k = e.key.toLowerCase(), mod = e.metaKey || e.ctrlKey;
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod && k === 's') { e.preventDefault(); save(e.shiftKey); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (mod) return;
      if (e.key === '?') { setShowHelp((v) => !v); return; }
      if (showHelp) { if (e.key === 'Escape') setShowHelp(false); return; } // panel open: other keys do nothing
      if (e.key === 'Tab') { e.preventDefault(); cycleSelection(e.shiftKey ? -1 : 1); return; }
      const step = e.shiftKey ? 0.02 : 0.003;
      if (selected !== null && e.key.startsWith('Arrow')) {
        e.preventDefault();
        nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
      } else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (selected !== null) { e.preventDefault(); deleteSelected(); } }
      else if (e.key === 'Enter' && roiNew) { e.preventDefault(); finishRoiNew(roiNew); }
      else if (e.key === 'Escape') { if (roiNew) setRoiNew(null); else setSelected(null); }
      else if (k === 'r') { setMode('roi'); setSelected(null); }
      else if (k === 's') { e.preventDefault(); save(e.shiftKey); }
      else if (k === 'a') go(-1);
      else if (k === 'd') go(1);
      else if (k === 'f') setShowAi((v) => !v);
      else if (k === 'x') { if (frame) setExcluded([frame.id], !frame.excluded); }
      else if (k === 'n') { setMode('draw'); setSelected(null); setRoiNew(null); }
      else if (k === 'v') { setMode('select'); setRoiNew(null); }
      else if (k === 'b' || k === 'h' || k === 'p') { const cls = k === 'b' ? 'brick' : 'person'; setTool(cls); if (mode === 'select') setSelectedClass(cls); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---- pointer handling: hit-testing done here, so the same click logic works in both tools ---- */
  function pt(e) {
    const r = svgRef.current.getBoundingClientRect();
    return [Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1), Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1)];
  }
  const svgPx = () => { const r = svgRef.current?.getBoundingClientRect(); return r && r.width ? r : { width: 800, height: 450 }; };
  const inside = (b, x, y) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
  function hitHuman(x, y) {
    for (let i = added.length - 1; i >= 0; i--) if (inside(added[i], x, y)) return i;
    return null;
  }
  function hitCorner(x, y) {
    if (selected === null || !added[selected]) return null;
    const b = added[selected], r = svgPx(), tx = 9 / r.width, ty = 9 / r.height;
    const corners = { nw: [b.x1, b.y1], ne: [b.x2, b.y1], sw: [b.x1, b.y2], se: [b.x2, b.y2] };
    return Object.keys(corners).find((c) => Math.abs(x - corners[c][0]) < tx && Math.abs(y - corners[c][1]) < ty) || null;
  }
  // smallest AI box (brick or person) under the point — the one the user most likely meant
  function hitAi(x, y) {
    if (!showAi) return null;
    const all = [...aiBoxes.map((b) => ({ ...b, kind: 'brick' })), ...aiPersons.map((b) => ({ ...b, kind: 'person' }))].filter((b) => inside(b, x, y));
    all.sort((a, b) => (a.x2 - a.x1) * (a.y2 - a.y1) - (b.x2 - b.x1) * (b.y2 - b.y1));
    return all[0] || null;
  }
  // ROI corner / edge-midpoint under the point (within ~10 px)
  function hitRoi(x, y) {
    const r = svgPx(), tx = 10 / r.width, ty = 10 / r.height;
    const near = (p) => Math.abs(x - p[0]) < tx && Math.abs(y - p[1]) < ty;
    const v = roi.findIndex(near);
    if (v >= 0) return { kind: 'vertex', i: v };
    const m = roi.findIndex((p, i) => near(mid(p, roi[(i + 1) % roi.length])));
    return m >= 0 ? { kind: 'mid', i: m } : null;
  }
  function down(e) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = pt(e);
    const base = { x0: x, y0: y, x1: x, y1: y, moved: false };
    if (mode === 'roi') {
      if (roiNew) { setDrag({ ...base, kind: 'roiClick' }); return; }
      const h = hitRoi(x, y);
      if (!h) return;
      const before = snapshot();
      if (h.kind === 'mid') { // add a corner on that edge and drag it
        const pts = [...roi.slice(0, h.i + 1), [x, y], ...roi.slice(h.i + 1)];
        setRoiDraft(pts);
        setDrag({ ...base, kind: 'roiVertex', idx: h.i + 1, before, moved: true });
      } else {
        setDrag({ ...base, kind: 'roiVertex', idx: h.i, before });
      }
      return;
    }
    if (mode === 'select') {
      const corner = hitCorner(x, y);
      if (corner) { setDrag({ ...base, kind: 'resize', idx: selected, corner, orig: added[selected], before: snapshot() }); return; }
      const h = hitHuman(x, y);
      if (h !== null) { setSelected(h); setDrag({ ...base, kind: 'move', idx: h, orig: added[h], before: snapshot() }); return; }
      setSelected(null);
      setDrag({ ...base, kind: 'click' });
      return;
    }
    setSelected(null);
    setDrag({ ...base, kind: 'draw' });
  }
  function move(e) {
    if (!drag) return;
    const [x, y] = pt(e);
    const r = svgPx();
    const moved = drag.moved || Math.abs((x - drag.x0) * r.width) > 3 || Math.abs((y - drag.y0) * r.height) > 3;
    if (drag.kind === 'roiVertex' && moved) {
      setRoiDraft((cur) => (cur || roi).map((p, i) => (i === drag.idx ? [x, y] : p)));
    } else if (drag.kind === 'move' && moved) {
      const o = drag.orig;
      const dx = Math.min(Math.max(x - drag.x0, -o.x1), 1 - o.x2), dy = Math.min(Math.max(y - drag.y0, -o.y1), 1 - o.y2);
      setAdded((a) => a.map((b, i) => (i === drag.idx ? { ...b, x1: o.x1 + dx, x2: o.x2 + dx, y1: o.y1 + dy, y2: o.y2 + dy } : b)));
    } else if (drag.kind === 'resize' && moved) {
      const o = drag.orig, c = drag.corner;
      const nx1 = c.includes('w') ? x : o.x1, nx2 = c.includes('e') ? x : o.x2;
      const ny1 = c.includes('n') ? y : o.y1, ny2 = c.includes('s') ? y : o.y2;
      setAdded((a) => a.map((b, i) => (i === drag.idx ? { ...b, x1: Math.min(nx1, nx2), x2: Math.max(nx1, nx2), y1: Math.min(ny1, ny2), y2: Math.max(ny1, ny2) } : b)));
    }
    setDrag((d) => ({ ...d, x1: x, y1: y, moved }));
  }
  function up() {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === 'roiVertex') { if (d.moved) pushHistory(d.before); return; }
    if (d.kind === 'roiClick') { // redrawing: add a corner, or close on the first one
      const r = svgPx(), first = roiNew[0];
      if (first && roiNew.length >= 3 && Math.abs(d.x0 - first[0]) < 10 / r.width && Math.abs(d.y0 - first[1]) < 10 / r.height) finishRoiNew(roiNew);
      else setRoiNew((pts) => [...pts, [d.x0, d.y0]]);
      return;
    }
    if ((d.kind === 'move' || d.kind === 'resize') && d.moved) {
      // one undo step for the whole drag; drop boxes resized down to nothing
      setAdded((a) => a.filter((b) => b.x2 - b.x1 >= 0.004 && b.y2 - b.y1 >= 0.004));
      pushHistory(d.before);
      return;
    }
    if (d.kind === 'draw' && d.moved) {
      const b = { x1: Math.min(d.x0, d.x1), y1: Math.min(d.y0, d.y1), x2: Math.max(d.x0, d.x1), y2: Math.max(d.y0, d.y1), cls: tool };
      if (b.x2 - b.x1 < 0.004 || b.y2 - b.y1 < 0.004) return; // too small to be a box
      pushHistory();
      setAdded((a) => [...a, b]);
      return;
    }
    if (d.kind === 'draw' || d.kind === 'click') { // a plain click: toggle the AI box under it
      const hit = hitAi(d.x0, d.y0);
      if (hit) toggleAiBox(hit);
    }
  }
  const sel = selected !== null ? added[selected] : null;
  const roiEdited = !!roiDraft;
  const hs = (() => { const r = svgPx(); return { w: 8 / r.width, h: 8 / r.height }; })();

  return (
    <div className="view active">
      {showHelp && (
        <div className="le-help-scrim" onClick={() => setShowHelp(false)}>
          <div className="le-help card" role="dialog" aria-label="คีย์ลัด" onClick={(e) => e.stopPropagation()}>
            <div className="card-head"><h3>⌨ คีย์ลัด — ตรวจแก้ Label</h3><button className="btn btn-ghost btn-sm" onClick={() => setShowHelp(false)}>ปิด (Esc)</button></div>
            <div className="card-body le-help-body">
              {SHORTCUTS.map(([group, list]) => (
                <div key={group} className="le-help-group">
                  <div className="le-help-title">{group}</div>
                  {list.map(([keys, what]) => <div key={keys} className="le-help-row"><kbd>{keys}</kbd><span>{what}</span></div>)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="detail-back"><button className="btn btn-secondary" onClick={() => { if (!dirty || window.confirm('ยังไม่ได้บันทึก ออกโดยไม่บันทึก?')) onClose(); }}>← กลับ Task Detail</button></div>
      <div className="section-head">
        <div><h2>ตรวจแก้ Label (Human-in-the-loop)</h2><p>{task.name} · ลบกรอบที่ AI ทายผิด และตีกรอบอิฐบล็อกหรือคนที่ AI มองไม่เห็น เพื่อให้จำนวนบล็อกและจำนวนคนแม่นขึ้น</p></div>
        <div className="tabs">
          <button className={`tab-btn${tab === 'label' ? ' active' : ''}`} onClick={() => setTab('label')}>ตรวจแก้ภาพ</button>
          <button className={`tab-btn${tab === 'summary' ? ' active' : ''}`} onClick={() => setTab('summary')}>สรุปผล</button>
        </div>
      </div>

      {tab === 'summary' ? (
        <div className="card"><div className="card-body"><SummaryPanel summary={summary} frames={(frames || []).filter((f) => !f.excluded)} blocksPerSqm={summary?.blocksPerSqm} onOpen={open} taskId={task.id}
          onSourceChanged={(src) => { setSummary((sm) => ({ ...sm, resultSource: src })); toast(src === 'human' ? 'งานนี้ใช้ผลตรวจแก้ (ตัวเลือกที่ 2) แล้ว' : 'งานนี้กลับไปใช้ผล AI (ตัวเลือกที่ 1)', 'success'); onSourceChanged && onSourceChanged(src); }} /></div></div>
      ) : frames === null ? (
        <div className="cell-muted" style={{ padding: 30 }}>กำลังโหลด...</div>
      ) : frames.length === 0 ? (
        <div className="card"><div className="card-body"><div className="empty-state"><div className="e-title">งานนี้ยังไม่มีภาพที่บันทึกไว้</div></div></div></div>
      ) : (
        <div className="le-grid">
          <div className="card le-list">
            <div className="le-filters">{FILTERS.map(([k, l]) => <button key={k} className={`tl-seg${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{l}{k === 'excluded' && excludedCount ? ` ${excludedCount}` : ''}</button>)}</div>
            <div className="le-items">
              {[...shown].reverse().map((f) => (
                <div key={f.id} role="button" tabIndex={0} className={`le-item${f.id === curId ? ' active' : ''}${f.excluded ? ' excluded' : ''}${picked.has(f.id) ? ' picked' : ''}`} onClick={() => open(f.id)}
                  onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(f.id); } }}>
                  <input type="checkbox" className="le-pick" checked={picked.has(f.id)} aria-label={`เลือกภาพเวลา ${dayTime(f.at)}`} title="เลือกหลายภาพ (Shift+คลิก = เลือกเป็นช่วง)"
                    onClick={(e) => { e.stopPropagation(); togglePick(f, e.shiftKey); }} onChange={() => {}} />
                  <span className="le-time">{dayTime(f.at)}{f.roiEdited && <span className="le-roi-tag" title="แก้ ROI แล้ว">ROI</span>}</span>
                  <span className="le-counts">อิฐ {f.blocks}{f.correctedBlocks !== null ? <b> → {f.correctedBlocks}</b> : null} · คน {f.peopleDetected}{f.correctedPeople !== null && f.correctedPeople !== undefined ? <b> → {f.correctedPeople}</b> : null}</span>
                  {f.excluded ? <span className="le-excl-tag" title="ไม่นับในกราฟ / Productivity / รายงาน">⊘ {reasonText(f.excludedReason)}</span>
                    : f.correctedBlocks !== null ? <span className="le-done">✓</span> : !f.hasBoxes ? <span className="le-nobox" title="ภาพนี้บันทึกก่อนมีการเก็บกรอบ AI">ไม่มีกรอบ AI</span> : null}
                  {f.excluded && <button type="button" className="le-del" title="ลบภาพนี้ทิ้งถาวร (กู้คืนไม่ได้)" aria-label={`ลบภาพเวลา ${dayTime(f.at)} ทิ้งถาวร`}
                    onClick={(e) => { e.stopPropagation(); removeFrame(f); }}>🗑</button>}
                </div>
              ))}
            </div>
            {picked.size > 0 && (
              <div className="le-bulk">
                <div className="le-bulk-head"><b>เลือก {picked.size} ภาพ</b><button className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>ยกเลิกการเลือก</button></div>
                <select className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="เหตุผลที่ตัดออก">
                  {EXCLUDE_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <div className="le-bulk-btns">
                  <button className="btn btn-danger btn-sm" disabled={excluding} onClick={() => setExcluded([...picked], true)}>⊘ ตัดออกจากการนับ</button>
                  <button className="btn btn-secondary btn-sm" disabled={excluding} onClick={() => setExcluded([...picked], false)}>↺ กู้คืน</button>
                </div>
              </div>
            )}
          </div>

          <div className="card le-canvas-card">
            <div className="le-toolbar">
              <button className="btn btn-secondary btn-sm" onClick={() => go(-1)} disabled={idx <= 0}>‹ ภาพก่อน</button>
              <span className="text-mono">{frame ? dayTime(frame.at) : '...'} · ภาพ {idx + 1}/{frames.length}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => go(1)} disabled={idx >= frames.length - 1}>ภาพถัดไป ›</button>
            </div>
            <div className="le-tools" role="toolbar" aria-label="เครื่องมือแก้ไขกรอบ">
              <div className="tabs le-tool" role="radiogroup" aria-label="เครื่องมือ">
                <button role="radio" aria-checked={mode === 'draw'} className={`tab-btn${mode === 'draw' ? ' active' : ''}`} onClick={() => { setMode('draw'); setSelected(null); }} title="สร้างกรอบใหม่ — ลากบนภาพ (N)">✚ สร้างกรอบ</button>
                <button role="radio" aria-checked={mode === 'select'} className={`tab-btn${mode === 'select' ? ' active' : ''}`} onClick={() => { setMode('select'); setRoiNew(null); }} title="เลือก / ย้าย / ย่อขยายกรอบ (V)">⬚ เลือก / ย้าย</button>
                <button role="radio" aria-checked={mode === 'roi'} className={`tab-btn${mode === 'roi' ? ' active' : ''}`} onClick={() => { setMode('roi'); setSelected(null); }} title="แก้ ROI — ลากมุมเพื่อย้าย ลาก + เพื่อเพิ่มมุม ดับเบิลคลิกมุมเพื่อลบ (R)">⬠ แก้ ROI{roiEdited ? ' •' : ''}</button>
              </div>
              {mode === 'roi' ? (
                <div className="le-tool-btns le-roi-btns">
                  <button className={`btn btn-sm ${roiNew ? 'btn-primary' : 'btn-secondary'}`} onClick={() => (roiNew ? finishRoiNew(roiNew) : setRoiNew([]))} title="คลิกมุมทีละจุดบนภาพ แล้วคลิกจุดแรก (หรือ Enter) เพื่อปิด ROI · Esc ยกเลิก">
                    {roiNew ? `✓ ปิด ROI (${roiNew.length} จุด)` : '✎ วาด ROI ใหม่'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={resetRoi} disabled={!roiEdited} title="กลับไปใช้ ROI เดิมของ AI ในภาพนี้">↺ คืน ROI เดิม</button>
                  <button className="btn btn-secondary btn-sm" onClick={applyRoiToAll} disabled={!roiEdited && !frames.some((f) => f.roiEdited)}
                    title={roiEdited ? 'ใช้ ROI ที่แก้นี้กับทุกภาพของงาน' : 'คืน ROI เดิมให้ทุกภาพที่เคยแก้ ROI'}>{roiEdited ? '⧉ ใช้ ROI นี้กับทุกภาพ' : '↺ คืน ROI เดิมทุกภาพ'}</button>
                </div>
              ) : (
              <div className="tabs le-tool" role="radiogroup" aria-label="ประเภทกรอบ">
                <button role="radio" aria-checked={(sel ? sel.cls || 'brick' : tool) === 'brick'} className={`tab-btn le-tool-brick${(sel ? sel.cls || 'brick' : tool) === 'brick' ? ' active' : ''}`}
                  onClick={() => { setTool('brick'); if (sel) setSelectedClass('brick'); }} title="อิฐบล็อก (B) — ถ้าเลือกกรอบอยู่ จะเปลี่ยนกรอบนั้นเป็นอิฐ">▭ อิฐบล็อก</button>
                <button role="radio" aria-checked={(sel ? sel.cls || 'brick' : tool) === 'person'} className={`tab-btn le-tool-person${(sel ? sel.cls || 'brick' : tool) === 'person' ? ' active' : ''}`}
                  onClick={() => { setTool('person'); if (sel) setSelectedClass('person'); }} title="คน (H) — ถ้าเลือกกรอบอยู่ จะเปลี่ยนกรอบนั้นเป็นคน">👷 คน</button>
              </div>
              )}
              <div className="le-tool-btns">
                <button className="btn btn-secondary btn-sm" onClick={undo} disabled={!past.length} title="ย้อนกลับ (Ctrl/⌘+Z)">↶ Undo</button>
                <button className="btn btn-secondary btn-sm" onClick={redo} disabled={!future.length} title="ทำซ้ำ (Ctrl/⌘+Shift+Z)">↷ Redo</button>
                <button className="btn btn-secondary btn-sm" onClick={deleteSelected} disabled={selected === null} title="ลบกรอบที่เลือก (Delete)">🗑 ลบกรอบ</button>
                <button className="btn btn-secondary btn-sm" onClick={duplicateSelected} disabled={selected === null} title="ทำซ้ำกรอบที่เลือก (Ctrl/⌘+D)">⧉ ทำซ้ำ</button>
                <button className={`btn btn-sm ${showAi ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setShowAi((v) => !v)} title="ซ่อน / แสดงกรอบของ AI (F)">{showAi ? '◌ ซ่อนกรอบ AI' : '◉ แสดงกรอบ AI'}</button>
                <button className="btn btn-ghost btn-sm" onClick={clearFrame} title="ล้างการแก้ทั้งหมดในภาพนี้ (Undo ได้)">ล้างทั้งภาพ</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowHelp(true)} title="คีย์ลัดทั้งหมด (?)">⌨ คีย์ลัด</button>
              </div>
            </div>
            <div className="le-stage">
              {frame && (
                <div className="le-imgwrap">
                  <img src={frame.snapshot} alt="" draggable={false} />
                  <svg ref={svgRef} viewBox="0 0 1 1" preserveAspectRatio="none" className={`le-svg mode-${mode}${roiNew ? ' roi-new' : ''}`}
                    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
                    {roiEdited && aiRoi.length >= 3 && <polygon className="le-roi-old" points={aiRoi.map((p) => p.join(',')).join(' ')} vectorEffect="non-scaling-stroke" />}
                    {roi.length >= 3 && !roiNew && <polygon className={`le-roi${roiEdited ? ' edited' : ''}`} points={roi.map((p) => p.join(',')).join(' ')} vectorEffect="non-scaling-stroke" />}
                    {showAi && aiBoxes.map((b) => {
                      const off = removed.has(b.i);
                      return (
                        <g key={`a${b.i}`} className={`le-ai${off ? ' off' : ''}${b.inRoi ? ' in' : ''}`}>
                          <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} vectorEffect="non-scaling-stroke" />
                          {off && <path d={`M${b.x1} ${b.y1} L${b.x2} ${b.y2} M${b.x2} ${b.y1} L${b.x1} ${b.y2}`} vectorEffect="non-scaling-stroke" />}
                        </g>
                      );
                    })}
                    {showAi && aiPersons.map((b) => {
                      const off = removedPersons.has(b.i);
                      return (
                        <g key={`p${b.i}`} className={`le-aip${off ? ' off' : ''}`}>
                          <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} vectorEffect="non-scaling-stroke" />
                          {off && <path d={`M${b.x1} ${b.y1} L${b.x2} ${b.y2} M${b.x2} ${b.y1} L${b.x1} ${b.y2}`} vectorEffect="non-scaling-stroke" />}
                        </g>
                      );
                    })}
                    {added.map((b, i) => (
                      <rect key={`h${i}`} className={`le-human${(b.cls || 'brick') === 'person' ? ' person' : ''}${selected === i ? ' sel' : ''}`} x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} vectorEffect="non-scaling-stroke" />
                    ))}
                    {sel && mode === 'select' && [['nw', sel.x1, sel.y1], ['ne', sel.x2, sel.y1], ['sw', sel.x1, sel.y2], ['se', sel.x2, sel.y2]].map(([c, cx, cy]) => (
                      <rect key={c} className={`le-handle h-${c}`} x={cx - hs.w / 2} y={cy - hs.h / 2} width={hs.w} height={hs.h} vectorEffect="non-scaling-stroke" />
                    ))}
                    {mode === 'roi' && !roiNew && roi.length >= 3 && <>
                      {roi.map((p, i) => { const m = mid(p, roi[(i + 1) % roi.length]); return <g key={`m${i}`} className="le-roi-mid"><rect x={m[0] - hs.w / 2} y={m[1] - hs.h / 2} width={hs.w} height={hs.h} vectorEffect="non-scaling-stroke" /></g>; })}
                      {roi.map((p, i) => <rect key={`v${i}`} className="le-roi-pt" x={p[0] - hs.w * 0.7} y={p[1] - hs.h * 0.7} width={hs.w * 1.4} height={hs.h * 1.4} vectorEffect="non-scaling-stroke"
                        onDoubleClick={(e) => { e.stopPropagation(); removeRoiPoint(i); }} />)}
                    </>}
                    {roiNew && roiNew.length > 0 && <>
                      <polyline className="le-roi-new" points={roiNew.map((p) => p.join(',')).join(' ')} vectorEffect="non-scaling-stroke" />
                      {roiNew.map((p, i) => <rect key={`n${i}`} className={`le-roi-pt${i === 0 ? ' first' : ''}`} x={p[0] - hs.w * 0.7} y={p[1] - hs.h * 0.7} width={hs.w * 1.4} height={hs.h * 1.4} vectorEffect="non-scaling-stroke" />)}
                    </>}
                    {drag && drag.kind === 'draw' && drag.moved && <rect className={`le-drawing${tool === 'person' ? ' person' : ''}`} x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} vectorEffect="non-scaling-stroke" />}
                  </svg>
                </div>
              )}
            </div>
            <div className="le-legend cell-muted">
              <span><i className="lg-ai" />อิฐ AI (ใน ROI)</span><span><i className="lg-aiout" />อิฐ AI นอก ROI</span><span><i className="lg-aip" />คน AI (นับทั้งภาพ)</span><span><i className="lg-off" />ลบออก</span><span><i className="lg-human" />อิฐที่เพิ่ม</span><span><i className="lg-hperson" />คนที่เพิ่ม</span><span><i className="lg-roi" />ROI ที่แก้</span>
              <span>· <b>X</b> ตัดภาพออก · <b>N</b> สร้างกรอบ · <b>V</b> เลือก/ย้าย · <b>R</b> แก้ ROI · <b>B</b> อิฐ · <b>H</b> คน · <b>A / D</b> ภาพก่อน/ถัดไป · <b>F</b> ซ่อนกรอบ AI · <b>S</b> บันทึก · <b>Shift+S</b> บันทึกแล้วไปต่อ · <b>⌘/Ctrl+Z</b> Undo · กด <b>?</b> ดูคีย์ลัดทั้งหมด</span>
            </div>
          </div>

          <div className="card le-side">
            <div className="card-body">
              {frame && (frame.excluded ? (
                <div className="le-excl-card off">
                  <div className="le-count-title">⊘ ภาพนี้ถูกตัดออกจากการนับ</div>
                  <p>{reasonText(frame.excludedReason)}{frame.excludedBy ? ` · โดย ${frame.excludedBy}` : ''} — ไม่นับในกราฟ, Productivity, รายงาน และไทม์แลปส์</p>
                  <div className="le-bulk-btns">
                    <button className="btn btn-secondary btn-sm" disabled={excluding} onClick={() => setExcluded([frame.id], false)}>↺ กู้คืนภาพนี้ (X)</button>
                    <button className="btn btn-ghost btn-sm le-danger-text" onClick={() => removeFrame(frames[idx])}>🗑 ลบถาวร</button>
                  </div>
                </div>
              ) : (
                <div className="le-excl-card">
                  <div className="le-count-title">ภาพนี้ใช้นับไม่ได้?</div>
                  <select className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="เหตุผลที่ตัดออก">
                    {EXCLUDE_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <div className="le-bulk-btns">
                    <button className="btn btn-danger btn-sm" disabled={excluding} onClick={() => setExcluded([frame.id], true)} title="ตัดภาพนี้ออกจากการนับ (X) — กู้คืนได้">⊘ ตัดภาพนี้ออก</button>
                    {fromHereIds().length > 1 && <button className="btn btn-secondary btn-sm" disabled={excluding} onClick={() => setExcluded(fromHereIds(), true)}
                      title="เช่น ตอนย้ายกล้อง / ถอดกล้องช่วงท้ายงาน">⊘ ตัดตั้งแต่ภาพนี้ถึงล่าสุด ({fromHereIds().length} ภาพ)</button>}
                  </div>
                </div>
              ))}
              <div className="le-count-card brick">
                <div className="le-count-title">อิฐบล็อกในภาพนี้</div>
                <div className="le-eq">
                  <div><span>AI นับได้ (ใน ROI)</span><strong>{counts.aiInRoi}</strong></div>
                  <div className="le-minus"><span>ลบออก</span><strong>−{counts.removedInRoi}</strong></div>
                  <div className="le-plus"><span>เพิ่ม (ใน ROI)</span><strong>+{counts.addedInRoi}</strong></div>
                  <div className="le-total"><span>หลังตรวจแก้</span><strong>{counts.corrected} <small>บล็อก</small></strong></div>
                </div>
              </div>
              <div className="le-count-card person">
                <div className="le-count-title">คนในภาพนี้</div>
                <div className="le-eq">
                  <div><span>AI ตรวจพบ (ทั้งภาพ)</span><strong>{counts.aiP}</strong></div>
                  <div className="le-minus"><span>ลบออก</span><strong>−{counts.remP}</strong></div>
                  <div className="le-plus"><span>เพิ่ม (ทั้งภาพ)</span><strong>+{counts.addP}</strong></div>
                  <div className="le-total person"><span>หลังตรวจแก้</span><strong>{counts.correctedPeople} <small>คน</small></strong></div>
                </div>
              </div>
              {counts.outside > 0 && <div className="le-warn">มี {counts.outside} กรอบอิฐอยู่นอก ROI — ไม่นับ (จุดกึ่งกลางต้องอยู่ใน ROI) · คนนับทั้งภาพ ไม่สนใจ ROI</div>}
              {frame && !det && <div className="le-warn">ภาพนี้บันทึกก่อนระบบเก็บกรอบของ AI — ลบกรอบ AI ไม่ได้ แต่เพิ่มกรอบได้ โดยเริ่มนับจาก {frame.blocks} บล็อก / {frame.peopleDetected} คนที่ AI นับไว้</div>}
              <label className="le-note-field">หมายเหตุ
                <textarea className="input" rows={2} value={note} onChange={(e) => { setNote(e.target.value); setDirty(true); }} placeholder="เช่น อิฐถูกบังด้วยนั่งร้าน" />
              </label>
              <div className="le-actions">
                <button className="btn btn-primary" onClick={() => save(true)} disabled={saving || !frame}>{saving ? 'กำลังบันทึก...' : 'บันทึก แล้วไปภาพถัดไป'}</button>
                <button className="btn btn-secondary" onClick={() => save(false)} disabled={saving || !frame}>บันทึก</button>
                {frame?.correctedBlocks !== null && frame?.correctedBlocks !== undefined && <button className="btn btn-ghost btn-sm" onClick={clearReview}>ยกเลิกผลตรวจแก้ (กลับไปใช้ค่า AI)</button>}
              </div>
              {frame?.labels?.by && <div className="cell-muted" style={{ fontSize: 12, marginTop: 8 }}>ตรวจล่าสุดโดย {frame.labels.by} · {dayTime(frame.labels.at)}</div>}
              {dirty && <div className="le-dirty">ยังไม่ได้บันทึก</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
