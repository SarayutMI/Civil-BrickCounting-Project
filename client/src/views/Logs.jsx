import { useEffect, useState } from 'react';
import Icon from '../icons/Icon.jsx';
import * as api from '../api.js';

const TYPE_LABEL = { camera: 'กล้อง', task: 'Task', snapshot: 'Snapshot', error: 'Error', edit: 'แก้ไข', auth: 'เข้าสู่ระบบ' };

function fmtTime(iso) {
  return new Date(iso).toLocaleString('th-TH', { hour12: false });
}

export default function Logs() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [logs, setLogs] = useState([]);

  // System log comes from the server (table audit_logs); refresh every 15 s while the page is open.
  useEffect(() => {
    let cancelled = false;
    const load = async () => { const list = await api.getLogs(); if (!cancelled) setLogs(list); };
    load();
    const id = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const rows = logs.filter((l) => {
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
            <option value="auth">เข้าสู่ระบบ</option>
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
                  <td className="cell-muted text-mono" style={{ fontSize: 12 }}>{fmtTime(l.time)}</td>
                  <td><span className={`badge ${l.level === 'error' ? 'badge-live' : l.level === 'warn' ? 'badge-pause' : 'badge-finished'}`}>{TYPE_LABEL[l.type] || l.type}</span></td>
                  <td>{l.message}{l.actor ? <span className="cell-muted"> — {l.actor}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
