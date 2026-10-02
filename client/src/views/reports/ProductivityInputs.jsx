import { useEffect, useState } from 'react';
import Icon from '../../icons/Icon.jsx';
import { useToast } from '../../components/Toast.jsx';
import { fmt, fmtDuration } from '../../components/ProductivityReport.jsx';
import { workerName } from '../../utils.jsx';
import * as api from '../../api.js';
import { stdLabel, BAND_TEXT } from '../../productivitySteps.js';

/* "ข้อมูลที่ใช้คำนวณ" on a task's Report › Productivity tab: the inputs behind N, T, Q and P standard,
   editable after the fact (a forgotten worker, the wrong brick type, time lost when the camera dropped
   images...). Saving updates the task itself and every figure is recomputed from it. */

const EMPTY_SCHEDULE = { start: '', breakStart: '', breakEnd: '', end: '' };

function draftOf(task) {
  return {
    workers: [...(task.workers || [])],
    brickType: task.brickType || '',
    expectedArea: task.expectedArea ?? '',
    schedule: { ...EMPTY_SCHEDULE, ...(task.schedule || {}) },
    pStdOverride: task.pStdOverride ?? '',
    timeAdjustMinutes: task.timeAdjustMinutes ?? 0,
  };
}

export default function ProductivityInputs({ task, prod, brickTypes, workersMaster, onSaved }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftOf(task));
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!editing) setDraft(draftOf(task)); }, [task, editing]);

  const bt = brickTypes.find((b) => b.id === (editing ? draft.brickType : task.brickType));
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const available = workersMaster.filter((w) => !draft.workers.includes(w.id));
  const imageMin = prod?.imageMinutes ?? prod?.runMinutes ?? 0;
  const adj = Number(draft.timeAdjustMinutes) || 0;

  async function save() {
    const expectedArea = Number(draft.expectedArea);
    if (!(expectedArea > 0)) { toast('เป้าหมายพื้นที่ต้องมากกว่า 0'); return; }
    const pStd = String(draft.pStdOverride).trim() === '' ? null : Number(draft.pStdOverride);
    if (pStd !== null && !(pStd > 0)) { toast('P มาตรฐานต้องมากกว่า 0 หรือเว้นว่าง'); return; }
    if (!Number.isFinite(adj)) { toast('การปรับเวลาทำงานต้องเป็นตัวเลข'); return; }
    setSaving(true);
    const { ok, data } = await api.patchTask(task.id, {
      workers: draft.workers, brickType: draft.brickType, expectedArea, schedule: draft.schedule,
      pStdOverride: pStd, timeAdjustMinutes: adj, reason: 'report',
    });
    setSaving(false);
    if (!ok) { toast(data.message || 'บันทึกไม่สำเร็จ'); return; }
    toast('บันทึกแล้ว — คำนวณ Productivity ใหม่', 'success');
    setEditing(false);
    onSaved(data);
  }

  const sched = task.schedule && task.schedule.start
    ? `${task.schedule.start}–${task.schedule.end}${task.schedule.breakStart ? ` (พัก ${task.schedule.breakStart}–${task.schedule.breakEnd})` : ''}`
    : 'ไม่ได้ตั้ง (ใช้ 8 ชม./วัน)';

  return (
    <div className="card pi-card">
      <div className="card-head">
        <h3>ข้อมูลที่ใช้คำนวณ</h3>
        {!editing ? (
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}><Icon name="edit" /> แก้ไขย้อนหลัง</button>
        ) : (
          <div className="action-row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)} disabled={saving}>ยกเลิก</button>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'กำลังบันทึก…' : 'บันทึกและคำนวณใหม่'}</button>
          </div>
        )}
      </div>
      <div className="card-body">
        {!editing ? (
          <div className="pi-grid">
            <div><span>แรงงาน (N)</span><strong>{task.workers.length} คน</strong><small>{task.workers.map((w) => workerName(workersMaster, w)).join(', ') || 'ยังไม่ได้มอบหมาย'}</small></div>
            <div><span>ประเภทอิฐ</span><strong>{bt ? bt.name : '—'}</strong><small>{bt ? `${bt.blocksPerSqm} ตร.ม./บล็อก` : ''}</small></div>
            <div><span>เป้าหมายพื้นที่</span><strong>{fmt(task.expectedArea, 0)} ตร.ม.</strong></div>
            <div><span>ตารางเวลางาน</span><strong>{sched}</strong><small>{prod ? `${prod.dayMinutes} นาที/วัน` : ''}</small></div>
            <div><span>P มาตรฐาน</span><strong>{prod?.pStd ? `${stdLabel(prod)} ตร.ม./คน-วัน` : '—'}</strong><small>{prod?.pStdSource === 'task' ? 'ตั้งเฉพาะงานนี้' : prod?.pStdSource === 'brickType' ? `ของประเภทอิฐ${prod.pStdMin && prod.pStdMax !== prod.pStdMin ? ` · ค่ากลาง ${fmt(prod.pStd)}` : ''}${prod.stdBand ? ` · ${BAND_TEXT[prod.stdBand]}` : ''}` : 'ยังไม่ได้ตั้ง'}</small></div>
            <div><span>เวลาทำงาน</span><strong>{prod ? fmtDuration(prod.runMinutes) : '…'}</strong><small>{prod?.timeAdjustMinutes ? `จากภาพ ${fmtDuration(imageMin)} ${prod.timeAdjustMinutes > 0 ? '+' : '−'} ปรับ ${fmtDuration(Math.abs(prod.timeAdjustMinutes))}` : 'จาก timestamp ของภาพ'}</small></div>
          </div>
        ) : (
          <div className="pi-form">
            <div className="form-group full">
              <label>แรงงานที่มอบหมาย (N) — เพิ่มคนที่ลืมใส่ได้</label>
              <div className="pi-pills">
                {draft.workers.length === 0 ? <span className="cell-muted" style={{ fontSize: 13 }}>ยังไม่มีแรงงาน</span> : draft.workers.map((wid) => (
                  <span className="pill" key={wid}>{workerName(workersMaster, wid)} <button aria-label="ลบ" onClick={() => set({ workers: draft.workers.filter((x) => x !== wid) })}><Icon name="x" /></button></span>
                ))}
              </div>
              <select className="select" value="" onChange={(e) => e.target.value && set({ workers: [...draft.workers, e.target.value] })}>
                <option value="">+ เพิ่มแรงงาน...</option>
                {available.map((w) => <option key={w.id} value={w.id}>{w.name}{w.role ? ` — ${w.role}` : ''}</option>)}
              </select>
              <small className="cell-muted">ไม่มีชื่อในรายการ? เพิ่มแรงงานใหม่ได้ที่ Settings › แรงงาน</small>
            </div>
            <div className="form-grid">
              <div className="form-group"><label>ประเภทอิฐ (พื้นที่ต่อบล็อก)</label>
                <select className="select" value={draft.brickType} onChange={(e) => set({ brickType: e.target.value })}>
                  {brickTypes.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.blocksPerSqm} ตร.ม./บล็อก</option>)}
                </select>
              </div>
              <div className="form-group"><label>เป้าหมายพื้นที่ (ตร.ม.)</label>
                <input type="number" min="1" step="any" className="input" value={draft.expectedArea} onChange={(e) => set({ expectedArea: e.target.value })} />
              </div>
              <div className="form-group"><label>เริ่มงาน</label><input type="time" className="input" value={draft.schedule.start} onChange={(e) => set({ schedule: { ...draft.schedule, start: e.target.value } })} /></div>
              <div className="form-group"><label>เลิกงาน</label><input type="time" className="input" value={draft.schedule.end} onChange={(e) => set({ schedule: { ...draft.schedule, end: e.target.value } })} /></div>
              <div className="form-group"><label>เริ่มพัก</label><input type="time" className="input" value={draft.schedule.breakStart} onChange={(e) => set({ schedule: { ...draft.schedule, breakStart: e.target.value } })} /></div>
              <div className="form-group"><label>จบพัก</label><input type="time" className="input" value={draft.schedule.breakEnd} onChange={(e) => set({ schedule: { ...draft.schedule, breakEnd: e.target.value } })} /></div>
              <div className="form-group"><label>P มาตรฐานของงานนี้ (ตร.ม./คน-วัน)</label>
                <input type="number" min="0" step="any" className="input" value={draft.pStdOverride} placeholder={bt?.standardProductivity ? `เว้นว่าง = ใช้ของประเภทอิฐ (${bt.standardProductivityMin && bt.standardProductivityMax !== bt.standardProductivityMin ? `${bt.standardProductivityMin}–${bt.standardProductivityMax}` : bt.standardProductivity})` : 'เว้นว่าง = ใช้ของประเภทอิฐ'}
                  onChange={(e) => set({ pStdOverride: e.target.value })} />
              </div>
              <div className="form-group"><label>ปรับเวลาทำงาน (นาที, ใส่ − เพื่อลด)</label>
                <input type="number" step="1" className="input" value={draft.timeAdjustMinutes} onChange={(e) => set({ timeAdjustMinutes: e.target.value })} />
                <small className="cell-muted">จากภาพ {fmtDuration(imageMin)} {adj ? `${adj > 0 ? '+' : '−'} ${fmtDuration(Math.abs(adj))} = ${fmtDuration(Math.max(imageMin + adj, 0))}` : ''} · ใช้เมื่อกล้องขาดภาพช่วงที่ทำงานจริง</small>
              </div>
            </div>
            <p className="cell-muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
              บันทึกแล้วจะแก้ข้อมูลของงานนี้โดยตรง (หน้า Task ก็เปลี่ยนตาม) และคำนวณ Q, N, T, P, % ต่าง, Duration ใหม่ทั้งหมด รวมถึงใน PDF / Word — มีบันทึกใน Logs ว่าใครแก้อะไร
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
