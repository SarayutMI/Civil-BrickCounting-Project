import TaskLockControl from '../../components/TaskLockControl.jsx';
import Icon from '../../icons/Icon.jsx';
import { StatusBadge, pct } from '../../utils.jsx';
import { fmt, fmtPct, diffTone, fmtDuration } from '../../components/ProductivityReport.jsx';

/* Reports landing: one row per task (แผง) with its progress, work time and PD. Click a row to open
   that task's own report. `prod` = GET /api/reports/productivity (null while loading). */
export default function ReportTaskList({ tasks, prod, onOpen, currentUser, mergeTask }) {
  const byId = new Map((prod?.tasks || []).map((p) => [p.taskId, p]));
  const lastSeen = (p) => (p?.lastAt ? new Date(p.lastAt).toLocaleString('th-TH', { hour12: false, dateStyle: 'medium', timeStyle: 'short' }) : '—');

  return (
    <div className="card">
      <div className="card-head">
        <h3>รายงานแยกตามงาน</h3>
        <span className="cell-muted" style={{ fontSize: 12 }}>กดที่งานเพื่อดูรายงานของงานนั้น — Timeline, Productivity, สรุปรายวัน และตารางบันทึก</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>งาน</th><th>สถานะ</th><th>ความคืบหน้า</th><th>บล็อก</th><th>เวลาทำงานรวม</th><th>PD จริง</th><th>เทียบมาตรฐาน</th><th>ภาพล่าสุด</th><th>Lock</th><th /></tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr><td colSpan={10}><div className="empty-state"><Icon name="empty" /><div className="e-title">ยังไม่มีงาน</div></div></td></tr>
            ) : tasks.map((t) => {
              const p = byId.get(t.id);
              const q = p ? p.Q : t.area; // follows the task's chosen result (AI or human-corrected)
              const done = pct(q, t.expectedArea);
              return (
                <tr key={t.id} className="clickable" onClick={() => onOpen(t.id)}>
                  <td>
                    <div className="cell-strong">{t.name}{t.copyOf && <span className="copy-badge" title="งานสำเนา — ไม่นับรวมใน Productivity ทั้งโครงการ">สำเนา</span>}</div>
                    <div className="cell-muted" style={{ fontSize: 12 }}>{t.zone || '—'}{p?.brickType ? ` · ${p.brickType}` : ''}</div>
                    {p?.resultSource === 'human' && <span className="rs-badge" title="ใช้ผลตรวจแก้โดยคนเป็นผลลัพธ์ของงานนี้">② ผลตรวจแก้ (HITL)</span>}
                  </td>
                  <td><StatusBadge status={t.status} /></td>
                  <td style={{ minWidth: 150 }}>
                    <div className="progress-bar"><div className="fill" style={{ width: Math.min(done, 100) + '%' }} /></div>
                    <div className="cell-muted" style={{ fontSize: 12, marginTop: 4 }}>{done}% · {fmt(q, 1)} / {fmt(t.expectedArea, 0)} ตร.ม.</div>
                  </td>
                  <td className="text-mono">{Number(p ? p.blocks : t.blocks || 0).toLocaleString()}</td>
                  <td>
                    <div className="cell-strong">{p ? fmtDuration(p.runMinutes) : '…'}</div>
                    <div className="cell-muted" style={{ fontSize: 12 }}>{p ? `${p.images.toLocaleString()} ภาพ · ${p.activeDays} วัน` : ''}</div>
                  </td>
                  <td className="cell-strong text-mono">{p ? fmt(p.pActual) : '…'}</td>
                  <td><span className={`prod-diff ${diffTone(p?.diffPct)}`}>{p ? fmtPct(p.diffPct) : '…'}</span></td>
                  <td className="cell-muted" style={{ fontSize: 12 }}>{lastSeen(p)}</td>
                  <td><TaskLockControl task={t} currentUser={currentUser} onChanged={mergeTask} /></td>
                  <td><Icon name="chevron" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
