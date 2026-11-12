import { useEffect, useMemo, useState } from 'react';
import TaskLockControl, { TaskLockNotice, taskReadOnly } from '../../components/TaskLockControl.jsx';
import Icon from '../../icons/Icon.jsx';
import BarChart from '../../components/charts/BarChart.jsx';
import TaskTimeline from '../../components/TaskTimeline.jsx';
import { FormulaBox, TaskProductivityCard, fmt, fmtDuration } from '../../components/ProductivityReport.jsx';
import { StatusBadge, statusLabel, downloadBlob, pct, workerName } from '../../utils.jsx';
import { dailySummary, progressOf } from '../../reportData.js';
import { stdLabel } from '../../productivitySteps.js';
import { useToast } from '../../components/Toast.jsx';
import * as api from '../../api.js';
import ExportButtons from './ExportButtons.jsx';
import ProductivityInputs from './ProductivityInputs.jsx';

/* One task's own report: Timeline / Productivity / daily summary / record table, with PDF, Word
   and CSV export of just this task. */

const TABS = [['timeline', 'Timeline'], ['productivity', 'Productivity'], ['daily', 'สรุปรายวัน'], ['records', 'ตารางบันทึก']];
const PAGE = 60; // record table rows per page
const dayLabel = (d) => new Date(d + 'T00:00').toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const hms = (iso) => new Date(iso).toLocaleTimeString('th-TH', { hour12: false });

export default function ReportTaskDetail({ task, tasks, workersMaster, brickTypes, mergeTask, currentUser, onBack }) {
  const toast = useToast();
  const readOnly = taskReadOnly(task, currentUser);
  const [tab, setTab] = useState('timeline');
  const [prod, setProd] = useState(null);
  const [hist, setHist] = useState(null); // full history of this task (oldest first), null while loading
  const [recDay, setRecDay] = useState(null);
  const [page, setPage] = useState(0);
  const [prodKey, setProdKey] = useState(0);
  const [histKey, setHistKey] = useState(0); // bump to refetch history (corrected area depends on the brick type)

  useEffect(() => {
    let cancelled = false;
    api.getTaskProductivity(task.id).then((p) => { if (!cancelled) setProd(p); });
    return () => { cancelled = true; };
  }, [task.id, prodKey]);
  useEffect(() => {
    let cancelled = false;
    setHist(null);
    api.getTaskHistory(task.id).then((h) => { if (!cancelled) setHist((h || []).filter((e) => e && e.at)); });
    return () => { cancelled = true; };
  }, [task.id, histKey]);
  useEffect(() => { setProd(null); setRecDay(null); }, [task.id]);

  const days = useMemo(() => (hist ? dailySummary(hist, { N: prod?.N || 0, dayMinutes: prod?.dayMinutes || 480 }) : []), [hist, prod]);
  useEffect(() => { if (!recDay && days.length) setRecDay(days[days.length - 1].date); }, [days, recDay]);
  useEffect(() => { setPage(0); }, [recDay]);

  const dayRows = useMemo(() => {
    if (!hist || !recDay) return [];
    return hist.filter((e) => { const d = new Date(e.at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === recDay; }).reverse();
  }, [hist, recDay]);
  const pages = Math.max(1, Math.ceil(dayRows.length / PAGE));
  const shownRows = dayRows.slice(page * PAGE, (page + 1) * PAGE);

  function exportCsv() {
    if (!hist) return;
    const head = ['วันที่-เวลา', 'เวลาภาพ', 'บล็อก', 'พื้นที่ (ตร.ม.)', 'ความคืบหน้า (%)', 'คนที่ตรวจพบ', 'แรงงานมอบหมาย', 'สถานะ', 'ภาพ', 'ตรวจแก้โดยคน', 'บล็อก (AI)', 'คน (AI)'];
    const rows = hist.map((e) => {
      const p = progressOf(e, task.expectedArea);
      return [new Date(e.at).toLocaleString('th-TH', { hour12: false }), e.imageAt ? new Date(e.imageAt).toLocaleString('th-TH', { hour12: false }) : '',
        e.blocks, Number(e.area).toFixed(3), p === null ? '' : p.toFixed(1), e.peopleDetected || 0, e.workersAssigned ?? '', e.status ? statusLabel(e.status) : '',
        e.snapshot ? new URL(e.snapshot, window.location.origin).href : '',
        e.corrected ? 'ใช่' : '', e.corrected ? e.aiBlocks : e.blocks, e.corrected ? (e.aiPeople ?? 0) : (e.peopleDetected || 0)];
    });
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadBlob('﻿' + csv, `civil-${task.name}-records.csv`, 'text/csv;charset=utf-8;');
    toast('ดาวน์โหลดไฟล์ CSV แล้ว', 'success');
  }

  const done = pct(task.area, task.expectedArea);

  return (
    <>
      <div className="section-head">
        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 6, paddingLeft: 0 }}>‹ กลับไปรายการงาน</button>
          <h2>{task.name}</h2>
          <p>{task.zone || '—'} · <StatusBadge status={task.status} /></p>
        </div>
        <div className="toolbar">
          <TaskLockControl task={task} currentUser={currentUser} onChanged={mergeTask} />
          <div className="tabs">
            {TABS.map(([k, label]) => <button key={k} className={`tab-btn${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{label}</button>)}
          </div>
          <ExportButtons tasks={[task]} workersMaster={workersMaster} currentUser={currentUser} title={`รายงานงาน: ${task.name}`} fileBase={`civil-${task.name}`} onCsv={exportCsv} />
        </div>
      </div>

      <TaskLockNotice task={task} currentUser={currentUser} />

      <div className="prod-kpis">
        <div className="prod-kpi"><span>ความคืบหน้า {prod?.resultSource === 'human' ? '(ผลตรวจแก้)' : ''}</span><strong>{prod ? pct(prod.Q, task.expectedArea) : done}%</strong><small>{fmt(prod ? prod.Q : task.area, 1)} / {fmt(task.expectedArea, 0)} ตร.ม. · {Number(prod ? prod.blocks : task.blocks || 0).toLocaleString()} บล็อก</small></div>
        <div className="prod-kpi"><span>เวลาทำงานรวม</span><strong>{prod ? fmtDuration(prod.runMinutes) : '…'}</strong><small>{prod ? `${prod.images.toLocaleString()} ภาพ · ${prod.activeDays} วัน` : ''}</small></div>
        <div className="prod-kpi"><span>PD จริง</span><strong>{prod ? fmt(prod.pActual) : '…'}</strong><small>ตร.ม./คน-วัน (มาตรฐาน {prod ? stdLabel(prod) : '…'})</small></div>
        <div className="prod-kpi"><span>แรงงาน / ประเภทอิฐ</span><strong>{task.workers.length} คน</strong><small>{prod?.brickType || '—'}</small></div>
      </div>

      {tab === 'timeline' && <TaskTimeline tasks={tasks} fixedTaskId={task.id} />}

      {tab === 'productivity' && (
        <>
          <ProductivityInputs readOnly={readOnly} task={task} prod={prod} brickTypes={brickTypes || []} workersMaster={workersMaster}
            onSaved={(fresh) => { if (mergeTask) mergeTask(fresh); setProdKey((k) => k + 1); setHistKey((k) => k + 1); }} />
          <TaskProductivityCard readOnly={readOnly} prod={prod} workerNames={task.workers.map((w) => workerName(workersMaster, w))} showSteps onSourceChanged={() => { setProdKey((k) => k + 1); setHistKey((k) => k + 1); }} />
          <div className="card"><div className="card-head"><h3>สูตรการคำนวณ</h3></div><div className="card-body"><FormulaBox /></div></div>
        </>
      )}

      {tab === 'daily' && (
        <>
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head"><h3>พื้นที่ที่เพิ่มขึ้นต่อวัน</h3><span className="cell-muted" style={{ fontSize: 12 }}>ตร.ม. ที่ AI นับได้เพิ่มจากวันก่อนหน้า</span></div>
            <div className="card-body"><div className="chart">
              {hist === null ? <div className="cell-muted" style={{ padding: 40, textAlign: 'center' }}>กำลังโหลดข้อมูล...</div>
                : days.length === 0 ? <div className="cell-muted" style={{ padding: 40, textAlign: 'center' }}>ยังไม่มีข้อมูล</div>
                  : <BarChart labels={days.map((d) => new Date(d.date + 'T00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }))} values={days.map((d) => Math.max(d.areaGained, 0))} color="var(--green)" />}
            </div></div>
          </div>
          <div className="card">
            <div className="card-head"><h3>สรุปรายวัน</h3><span className="cell-muted" style={{ fontSize: 12 }}>PD วันนั้น = พื้นที่ที่เพิ่มขึ้นในวันนั้น ÷ (N × T ของวันนั้น)</span></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>วันที่</th><th>ช่วงเวลา</th><th>เวลาทำงาน</th><th>ภาพ</th><th>บล็อก (เพิ่ม)</th><th>พื้นที่ ตร.ม. (เพิ่ม)</th><th>คน AI เฉลี่ย/สูงสุด</th><th>PD วันนั้น</th><th /></tr></thead>
                <tbody>
                  {days.length === 0 ? (
                    <tr><td colSpan={9}><div className="empty-state"><Icon name="empty" /><div className="e-title">{hist === null ? 'กำลังโหลด...' : 'ยังไม่มีข้อมูล'}</div></div></td></tr>
                  ) : [...days].reverse().map((d) => (
                    <tr key={d.date} className="clickable" onClick={() => { setRecDay(d.date); setTab('records'); }}>
                      <td className="cell-strong">{dayLabel(d.date)}</td>
                      <td className="cell-muted">{hms(d.first).slice(0, 5)}–{hms(d.last).slice(0, 5)}</td>
                      <td>{fmtDuration(d.workMinutes)}</td>
                      <td className="text-mono">{d.images.toLocaleString()}</td>
                      <td className="text-mono">{d.blocksEnd.toLocaleString()} <span className="cell-muted">({d.blocksGained >= 0 ? '+' : ''}{d.blocksGained.toLocaleString()})</span></td>
                      <td className="text-mono">{fmt(d.areaEnd)} <span className="cell-muted">({d.areaGained >= 0 ? '+' : ''}{fmt(d.areaGained)})</span></td>
                      <td className="text-mono">{fmt(d.peopleAvg, 1)} / {d.peopleMax}</td>
                      <td className="cell-strong text-mono">{fmt(d.pDay)}</td>
                      <td className="cell-muted" style={{ fontSize: 12 }}>ดูบันทึก ›</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'records' && (
        <div className="card">
          <div className="card-head">
            <h3>ตารางบันทึกรายนาที</h3>
            <div className="toolbar">
              <select className="select" value={recDay || ''} onChange={(e) => setRecDay(e.target.value)}>
                {[...days].reverse().map((d) => <option key={d.date} value={d.date}>{dayLabel(d.date)} ({d.images} ภาพ)</option>)}
              </select>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>เวลา</th><th>ภาพ</th><th>บล็อก</th><th>พื้นที่ (ตร.ม.)</th><th>ความคืบหน้า</th><th>คน</th><th>แรงงาน</th><th>สถานะ</th></tr></thead>
              <tbody>
                {shownRows.length === 0 ? (
                  <tr><td colSpan={8}><div className="empty-state"><Icon name="empty" /><div className="e-title">{hist === null ? 'กำลังโหลด...' : 'ไม่มีบันทึกในวันนี้'}</div></div></td></tr>
                ) : shownRows.map((e) => {
                  const p = progressOf(e, task.expectedArea);
                  return (
                    <tr key={e.at}>
                      <td className="text-mono">{hms(e.at)}{e.imageAt ? <div className="cell-muted" style={{ fontSize: 11 }}>ภาพ {hms(e.imageAt)}</div> : null}</td>
                      <td>{e.snapshot ? <a href={e.snapshot} target="_blank" rel="noreferrer"><img className="rec-thumb" src={e.snapshot} alt="" loading="lazy" /></a> : <span className="cell-muted">—</span>}</td>
                      <td className="text-mono">{Number(e.blocks || 0).toLocaleString()}{e.corrected && <span className="corr-mark" title={`ตรวจแก้โดยคน — AI นับได้ ${e.aiBlocks} บล็อก / ${e.aiPeople ?? 0} คน`}>✎</span>}</td>
                      <td className="text-mono">{fmt(e.area)}</td>
                      <td className="text-mono">{p === null ? '—' : `${fmt(p, 1)}%`}</td>
                      <td className="text-mono">{e.peopleDetected || 0}</td>
                      <td className="text-mono">{e.workersAssigned ?? '—'}</td>
                      <td>{e.status ? <StatusBadge status={e.status} /> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="card-body rec-pager">
              <button type="button" className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage((x) => x - 1)}>‹ ก่อนหน้า</button>
              <span className="cell-muted">หน้า {page + 1} / {pages} · {dayRows.length.toLocaleString()} รายการ</span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pages - 1} onClick={() => setPage((x) => x + 1)}>ถัดไป ›</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
