import { useState } from 'react';
import Icon from '../icons/Icon.jsx';

/* Static mock log data — ported verbatim from app.js DB.logs.
   There is no /api/logs endpoint on the backend; the original UI never
   fetched logs from a server either, so this stays a client-side list. */
const MOCK_LOGS = [
  { time: '2026-08-24 09:12', type: 'camera', level: 'info', message: 'กล้อง Zone A1 เชื่อมต่อสำเร็จ' },
  { time: '2026-08-24 09:00', type: 'task', level: 'info', message: 'เริ่มการตรวจจับ Task "อาคาร A ชั้น 1"' },
  { time: '2026-08-24 08:44', type: 'snapshot', level: 'info', message: 'บันทึก Snapshot อัตโนมัติ Zone B1' },
  { time: '2026-08-24 08:20', type: 'error', level: 'error', message: 'สูญเสียการเชื่อมต่อกล้อง Zone C2' },
  { time: '2026-08-24 08:05', type: 'task', level: 'warn', message: 'พัก Task "อาคาร A ชั้น 2 — ผนังด้านทิศใต้"' },
  { time: '2026-08-23 17:02', type: 'task', level: 'info', message: 'Task "อาคาร B ชั้น 2" เสร็จสิ้น 100%' },
  { time: '2026-08-23 16:40', type: 'camera', level: 'warn', message: 'สัญญาณกล้อง Zone B2 ไม่เสถียร' },
  { time: '2026-08-23 12:00', type: 'task', level: 'info', message: 'พักเที่ยง — หยุดตรวจจับชั่วคราวทุก Zone' },
  { time: '2026-08-23 08:15', type: 'edit', level: 'info', message: 'แก้ไขพื้นที่ ROI ของ Zone A1' },
];

const TYPE_LABEL = { camera: 'กล้อง', task: 'Task', snapshot: 'Snapshot', error: 'Error', edit: 'แก้ไข' };

export default function Logs() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const rows = MOCK_LOGS.filter((l) => {
    const okType = filter === 'all' || l.type === filter;
    const okSearch = l.message.toLowerCase().includes(search.toLowerCase());
    return okType && okSearch;
  });

  return (
    <section id="view-logs" className="view active">
      <div className="section-head">
        <div><h2>System Logs</h2><p>ประวัติการทำงานของระบบ</p></div>
        <div className="toolbar">
          <input className="input" placeholder="ค้นหา Log" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">ทุกประเภท</option>
            <option value="camera">กล้อง</option>
            <option value="task">Task</option>
            <option value="snapshot">Snapshot</option>
            <option value="error">Error</option>
            <option value="edit">แก้ไข</option>
          </select>
        </div>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>เวลา</th><th>ประเภท</th><th>ข้อความ</th></tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={3}><div className="empty-state"><Icon name="empty" /><div className="e-title">ไม่พบ Log</div></div></td></tr>
              ) : rows.map((l, i) => (
                <tr key={i}>
                  <td className="cell-muted text-mono" style={{ fontSize: 12 }}>{l.time}</td>
                  <td><span className={`badge ${l.level === 'error' ? 'badge-live' : l.level === 'warn' ? 'badge-pause' : 'badge-finished'}`}>{TYPE_LABEL[l.type] || l.type}</span></td>
                  <td>{l.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
