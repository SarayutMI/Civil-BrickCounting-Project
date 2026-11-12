import { Fragment, useEffect, useState } from 'react';
import TaskLockControl from './TaskLockControl.jsx';
import { StatusBadge } from '../utils.jsx';
import * as api from '../api.js';
import { productivitySteps, projectSteps, stdLabel, BAND_TEXT } from '../productivitySteps.js';

/* Productivity tab of the Reports page. Numbers come from GET /api/reports/productivity
   (formulas in productivity.js); this component only formats them and shows the working. */

export const fmt = (v, d = 2) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fmtPct = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${fmt(v, 1)}%`);
export const diffTone = (v) => (v === null || v === undefined ? '' : v >= 0 ? 'pos' : 'neg');

// "P = 24.00 / (2 × 2.00) = 6.00" — the substituted formula for one task, or why it can't be computed
export function pWorking(r) {
  if (!r.N) return 'ยังไม่มอบหมายแรงงาน (N = 0) — คำนวณ P ไม่ได้';
  if (!r.T) return 'ยังไม่มีเวลาทำงานบันทึกไว้ (T = 0) — คำนวณ P ไม่ได้';
  return `P = ${fmt(r.Q, 3)} / (${r.N} × ${fmt(r.T, 3)}) = ${fmt(r.pActual)} ตร.ม./คน-วัน`;
}
export const tWorking = (r) => `T = ${fmt(r.runMinutes, 1)} นาที ÷ ${r.dayMinutes} นาที/วัน = ${fmt(r.T, 3)} วัน`;
// 205.5 -> "3 ชม. 25 นาที" — total work time measured from image timestamps
export function fmtDuration(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const m = Math.round(minutes);
  if (m < 60) return `${m} นาที`;
  return `${Math.floor(m / 60)} ชม. ${m % 60} นาที`;
}
const hm = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { hour12: false, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const timeSpan = (r) => (r.firstAt ? `${hm(r.firstAt)} – ${hm(r.lastAt)}` : 'ยังไม่มีภาพ');

/* Numbered step-by-step working (productivitySteps.js) — the same steps the PDF / Word exports print. */
export function ProductivitySteps({ steps }) {
  return (
    <ol className="prod-steps">
      {steps.map((st) => (
        <li key={st.no}>
          <div className="ps-head"><span className="ps-no">{st.no}</span><strong>{st.title}</strong></div>
          <div className="ps-formula">{st.formula}</div>
          {st.lines.map((l, i) => <div key={i} className="ps-line">{l}</div>)}
          <div className="ps-result">{st.result}</div>
          {st.note && <div className="ps-note">{st.note}</div>}
        </li>
      ))}
    </ol>
  );
}

/* The task's two result sets: option 1 = AI as detected, option 2 = after the human-in-the-loop
   review. The AI numbers are never overwritten, so switching back is always possible.
   `available` = at least one frame has been reviewed. onChanged(source) lets the page refresh. */
export function ResultSourceToggle({ taskId, value, available, humanLatest, aiBlocks, onChanged, compact, readOnly = false }) {
  const [cur, setCur] = useState(value || 'ai');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setCur(value || 'ai'); }, [value]);
  async function pick(src) {
    if (src === cur || busy || readOnly) return;
    setBusy(true);
    const { ok } = await api.patchTask(taskId, { resultSource: src });
    setBusy(false);
    if (ok) { setCur(src); onChanged && onChanged(src); }
  }
  return (
    <div className={`rs-toggle${compact ? ' compact' : ''}`}>
      {!compact && <span className="rs-label">ผลลัพธ์ที่ใช้:</span>}
      <div className="tabs" role="radiogroup" aria-label="ผลลัพธ์ที่ใช้ของงานนี้">
        <button role="radio" aria-checked={cur === 'ai'} className={`tab-btn${cur === 'ai' ? ' active' : ''}`} disabled={busy || readOnly} onClick={() => pick('ai')}
          title="ใช้จำนวนที่ AI นับได้ (ต้นฉบับ)">① ผล AI{aiBlocks !== undefined && aiBlocks !== null ? ` · ${aiBlocks} บล็อก` : ''}</button>
        <button role="radio" aria-checked={cur === 'human'} className={`tab-btn rs-human${cur === 'human' ? ' active' : ''}`} disabled={busy || readOnly || !available} onClick={() => pick('human')}
          title={available ? 'ใช้จำนวนหลังคนตรวจแก้ (Human-in-the-loop)' : 'ยังไม่มีภาพที่ตรวจแก้ — เข้า "ตรวจแก้ Label" ในหน้า Task ก่อน'}>
          ② ผลตรวจแก้ (HITL){humanLatest ? ` · ${humanLatest.blocks} บล็อก` : ''}
        </button>
      </div>
    </div>
  );
}

/* Work time + PD for one task (Task Detail page): the same numbers and working as the Reports tab.
   workerNames: display names for step 2; showSteps: open the detailed working by default. */
export function TaskProductivityCard({ prod, workerNames = [], showSteps = false, onSourceChanged, readOnly = false }) {
  if (!prod) return null;
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-head">
        <h3>เวลาทำงาน และ Productivity (PD)</h3>
        <ResultSourceToggle readOnly={readOnly} taskId={prod.taskId} value={prod.selectedSource} available={!!prod.humanLatest} humanLatest={prod.humanLatest} aiBlocks={prod.aiBlocks} onChanged={onSourceChanged} />
      </div>
      <div className="card-body">
        <div className="prod-kpis" style={{ marginBottom: 12 }}>
          <div className="prod-kpi"><span>เวลาทำงานรวม</span><strong>{fmtDuration(prod.runMinutes)}</strong><small>{fmt(prod.runMinutes, 0)} นาที · {prod.images.toLocaleString()} ภาพ · {prod.activeDays} วัน</small></div>
          <div className="prod-kpi"><span>PD จริง (P = Q / (N × T))</span><strong>{fmt(prod.pActual)}</strong><small>ตร.ม./คน-วัน</small></div>
          <div className={`prod-kpi ${prod.stdBand ? { below: 'neg', within: 'pos', above: 'pos' }[prod.stdBand] : diffTone(prod.diffPct)}`}>
            <span>เทียบ P มาตรฐาน {stdLabel(prod)}</span><strong>{fmtPct(prod.diffPct)}</strong>
            <small>{prod.diffPct === null ? (prod.pStd === null ? 'ยังไม่ได้ตั้ง P มาตรฐานของประเภทอิฐ' : 'ยังเทียบไม่ได้')
              : prod.stdBand ? `${BAND_TEXT[prod.stdBand]} · % เทียบค่ากลาง ${fmt(prod.pStd)}` : prod.diffPct >= 0 ? 'สูงกว่ามาตรฐาน' : 'ต่ำกว่ามาตรฐาน'}</small>
          </div>
          <div className="prod-kpi"><span>Duration คาดการณ์ / มาตรฐาน</span><strong>{fmt(prod.durationForecast, 1)} / {fmt(prod.durationStd, 1)}</strong><small>วัน · คงเหลือ {fmt(prod.remainingDays, 1)} วัน</small></div>
        </div>
        <div className="prod-working">ช่วงเวลาที่มีภาพ: {timeSpan(prod)} · เวลาคิดจาก timestamp ของภาพที่กล้องส่งมา (ห่างเกิน 2.5 นาที = พัก/ขาดภาพ ไม่นับ)</div>
        {prod.resultSource === 'human' && <div className="prod-working rs-note">คำนวณจากตัวเลือกที่ 2: ผลตรวจแก้โดยคน (ภาพเวลา {new Date(prod.humanCorrected.at).toLocaleString('th-TH', { hour12: false, dateStyle: 'medium', timeStyle: 'short' })}) — AI นับได้ {prod.aiBlocks} บล็อก / {fmt(prod.aiQ, 3)} ตร.ม.</div>}
        <div className="prod-working">Q = {fmt(prod.Q, 3)} ตร.ม. · N = {prod.N} คน · {tWorking(prod)}</div>
        <div className="prod-working">{pWorking(prod)}</div>
        <details className="prod-details" open={showSteps}>
          <summary>ดูการคำนวณโดยละเอียด (ทีละขั้น)</summary>
          <ProductivitySteps steps={productivitySteps(prod, workerNames)} />
        </details>
      </div>
    </div>
  );
}

export function FormulaBox() {
  return (
    <div className="prod-formulas">
      <div>
        <strong>Productivity (จริง) = Q / (N × T)</strong>
        <span>Q = ปริมาณงาน (ตร.ม.) · N = จำนวนแรงงาน (คน) · T = เวลาที่ใช้ (วัน)</span>
      </div>
      <div>
        <strong>% ความแตกต่าง = [(P จริง − P มาตรฐาน) / P มาตรฐาน] × 100</strong>
        <span>(+) productivity สูงกว่ามาตรฐาน · (−) productivity ต่ำกว่ามาตรฐาน</span>
      </div>
      <div>
        <strong>Duration = Q / (P × N)</strong>
        <span>Q = ปริมาณงานทั้งหมด · P = ผลิตภาพแรงงาน (ตร.ม./คน-วัน) · N = จำนวนแรงงาน (คน)</span>
      </div>
      <p className="cell-muted">
        ที่มาของค่า: Q = พื้นที่ที่ AI นับได้ล่าสุด · N = แรงงานที่มอบหมายเข้า Task · T = เวลาทำงานจริงจาก timestamp ของภาพที่กล้องส่งมา ÷ นาทีทำงานต่อวันตามตารางงานของ Task (หักพัก; ไม่ได้ตั้งตาราง = 8 ชม.)
        · P มาตรฐาน ตั้งต่อประเภทอิฐใน Settings › Brick Types · Duration ใช้ Q = พื้นที่เป้าหมายทั้งหมดของ Task
      </p>
    </div>
  );
}

export default function ProductivityReport({ report, showProjectSummary = true, lockTasks = [], currentUser, onTaskChanged, workerNamesOf = () => [] }) {
  const [openRow, setOpenRow] = useState(null);
  if (!report) return <div className="card"><div className="card-body cell-muted" style={{ padding: 40, textAlign: 'center' }}>กำลังคำนวณ Productivity...</div></div>;
  const { project, tasks } = report;
  const missingStd = tasks.some((t) => t.pStd === null);

  return (
    <>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head"><h3>สูตรการคำนวณ</h3></div>
        <div className="card-body"><FormulaBox /></div>
      </div>

      {showProjectSummary && <>
      <div className="prod-kpis">
        <div className="prod-kpi"><span>Productivity จริง (ทั้งโครงการ)</span><strong>{fmt(project.pActual)}</strong><small>ตร.ม./คน-วัน</small></div>
        <div className="prod-kpi"><span>P มาตรฐาน (ถ่วงน้ำหนักตามคน-วัน)</span><strong>{fmt(project.pStd)}</strong><small>ตร.ม./คน-วัน</small></div>
        <div className={`prod-kpi ${diffTone(project.diffPct)}`}><span>% ความแตกต่าง</span><strong>{fmtPct(project.diffPct)}</strong><small>{project.diffPct === null ? 'ยังเทียบไม่ได้' : project.diffPct >= 0 ? 'สูงกว่ามาตรฐาน' : 'ต่ำกว่ามาตรฐาน'}</small></div>
        <div className="prod-kpi"><span>ปริมาณงาน / คน-วัน (งานที่มีเวลาบันทึก)</span><strong>{fmt(project.Q, 1)} / {fmt(project.manDays)}</strong><small>ตร.ม. / คน-วัน</small></div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head"><h3>การคำนวณทั้งโครงการ (ทีละขั้น)</h3></div>
        <div className="card-body"><ProductivitySteps steps={projectSteps(project, tasks)} /></div>
      </div>

      </>}

      <div className="card">
        <div className="card-head">
          <h3>Productivity รายงาน</h3>
          {missingStd && <span className="cell-muted" style={{ fontSize: 12 }}>บางประเภทอิฐยังไม่ได้ตั้ง P มาตรฐาน — ตั้งได้ที่ Settings › Brick Types</span>}
        </div>
        <div className="table-wrap">
          <table className="prod-table">
            <thead>
              <tr>
                <th>งาน</th><th>เวลาทำงานรวม</th><th>Q (ตร.ม.)</th><th>N (คน)</th><th>T (วัน)</th><th>P จริง</th><th>P มาตรฐาน</th>
                <th>% ความแตกต่าง</th><th>Duration มาตรฐาน</th><th>Duration คาดการณ์</th><th>คงเหลือ (วัน)</th><th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 ? (
                <tr><td colSpan={12}><div className="empty-state"><div className="e-title">ยังไม่มี Task</div></div></td></tr>
              ) : tasks.map((r) => (
                <Fragment key={r.taskId}>
                <tr className="clickable" onClick={() => setOpenRow(openRow === r.taskId ? null : r.taskId)} title="กดเพื่อดูการคำนวณโดยละเอียด">
                  <td>
                    <div className="cell-strong">{r.name}</div>
                    <TaskLockControl task={lockTasks.find((t) => t.id === r.taskId)} currentUser={currentUser} onChanged={onTaskChanged} />
                    <div className="prod-working">{r.brickType || 'ไม่ระบุประเภทอิฐ'} · {tWorking(r)}</div>
                    <div className="prod-working">{pWorking(r)}</div>
                  </td>
                  <td><div className="cell-strong">{fmtDuration(r.runMinutes)}</div><div className="prod-working">{r.images.toLocaleString()} ภาพ · {timeSpan(r)}</div></td>
                  <td>{fmt(r.Q)}{r.Qtotal ? <span className="cell-muted"> / {fmt(r.Qtotal, 0)}</span> : null}</td>
                  <td>{r.N}</td>
                  <td title={tWorking(r)}>{fmt(r.T, 3)}</td>
                  <td className="cell-strong">{fmt(r.pActual)}</td>
                  <td title={r.pStdMin ? `ค่ากลาง ${fmt(r.pStd)}` : undefined}>{stdLabel(r)}{r.stdBand && <div className="prod-working">{BAND_TEXT[r.stdBand]}</div>}</td>
                  <td><span className={`prod-diff ${diffTone(r.diffPct)}`}>{fmtPct(r.diffPct)}</span></td>
                  <td>{fmt(r.durationStd, 1)}</td>
                  <td>{fmt(r.durationForecast, 1)}</td>
                  <td>{fmt(r.remainingDays, 1)}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
                {openRow === r.taskId && (
                  <tr className="prod-steps-row"><td colSpan={12}><ProductivitySteps steps={productivitySteps(r, workerNamesOf(r))} /></td></tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body cell-muted" style={{ fontSize: 12 }}>
          กดที่แถวเพื่อดูการคำนวณโดยละเอียดของงานนั้น · P หน่วย ตร.ม./คน-วัน · Duration หน่วยวันทำงาน (เต็มงาน ตามพื้นที่เป้าหมาย) · คงเหลือ = พื้นที่ที่ยังเหลือ ÷ (P จริง × N)
        </div>
      </div>
    </>
  );
}
