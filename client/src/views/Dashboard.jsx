import { useEffect, useState } from 'react';
import Icon from '../icons/Icon.jsx';
import StatCard from '../components/StatCard.jsx';
import LineChart from '../components/charts/LineChart.jsx';
import { StatusBadge, pct } from '../utils.jsx';
import * as api from '../api.js';

const STEPS = ['เริ่มงาน', 'ตรวจจับ 25%', 'ตรวจจับ 50%', 'ตรวจจับ 75%', 'เสร็จสิ้น'];

/* Ported from app.js renderDashboard()/paintDashboard(). The task select
   resets to currentTaskId (or the first task) each time this view is
   opened, same as the original — since App unmounts Dashboard when the
   user navigates away, a lazy useState initializer reproduces that. */
export default function Dashboard({ tasks, currentTaskId }) {
  const [selectedTaskId, setSelectedTaskId] = useState(() => (
    currentTaskId && tasks.some((t) => t.id === currentTaskId) ? currentTaskId : (tasks[0]?.id || '')
  ));

  const t = tasks.find((x) => x.id === selectedTaskId);

  // Real data for the chart + gallery: today's per-minute rows of this task (table task_history), refreshed every 30 s.
  const [todayRows, setTodayRows] = useState([]);
  useEffect(() => {
    if (!selectedTaskId) return undefined;
    let cancelled = false;
    async function load() {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const rows = await api.getTaskHistory(selectedTaskId, { from: start.toISOString() });
      if (!cancelled) setTodayRows(rows);
    }
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [selectedTaskId]);
  // ≤ 60 evenly spaced points keep the chart light on a busy day; progress is % of the expected area
  const step = Math.max(1, Math.ceil(todayRows.length / 60));
  const chartSeries = todayRows.filter((_, i) => i % step === 0 || i === todayRows.length - 1).map((r) => r.progressPct ?? 0);
  const galleryRows = todayRows.filter((r) => r.snapshot).slice(-8).reverse();

  return (
    <section id="view-dashboard" className="view active">
      <div className="section-head">
        <div><h2>Dashboard</h2><p>วิเคราะห์ความคืบหน้าของงาน</p></div>
        <select className="select" value={selectedTaskId} onChange={(e) => setSelectedTaskId(e.target.value)}>
          {tasks.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>

      {!t ? (
        <div className="card"><div className="card-body"><div className="empty-state"><Icon name="empty" /><div className="e-title">ยังไม่มี Task</div></div></div></div>
      ) : (
        <>
          <div id="dashStats" className="grid-stats">
            <StatCard icon={<Icon name="percent" />} label="ความสำเร็จของงาน" value={pct(t.area, t.expectedArea) + '%'} />
            <StatCard icon={<Icon name="area" />} label="พื้นที่เป้าหมาย" value={t.expectedArea + ' m²'} />
            <StatCard icon={<Icon name="check" />} label="พื้นที่ที่ก่อเสร็จแล้ว" value={t.area + ' m²'} />
            <StatCard icon={<Icon name="users" />} label="แรงงานที่มอบหมาย" value={t.workers.length + ' คน'} />
            <StatCard icon={<Icon name="users" />} label="คนที่ตรวจพบ (AI)" value={(t.peopleDetected || 0) + ' คน'} />
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head"><h3>Progress Timeline</h3></div>
            <div className="card-body">
              <div id="dashTimeline" className="timeline">
                {STEPS.map((s, i) => {
                  const activeStep = Math.min(4, Math.floor(pct(t.area, t.expectedArea) / 25));
                  const active = i <= activeStep;
                  return (
                    <div key={s} style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', margin: '0 auto 8px', background: active ? 'var(--accent)' : 'var(--divider-strong)' }} />
                      <div style={{ fontSize: 11.5, color: active ? 'var(--text)' : 'var(--muted-2)', fontWeight: active ? 600 : 500 }}>{s}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="two-col">
            <div className="card"><div className="card-head"><h3>Progress Chart</h3></div><div className="card-body"><div id="dashChart" className="chart">{chartSeries.length ? <LineChart series={chartSeries} color="var(--accent)" /> : <div className="cell-muted" style={{ padding: 40, textAlign: 'center' }}>ยังไม่มีข้อมูลของวันนี้</div>}</div></div></div>
            <div className="card"><div className="card-head"><h3>Snapshots</h3></div><div className="card-body">
              <div id="dashGallery" className="gallery">
                {galleryRows.length === 0
                  ? <div className="cell-muted" style={{ gridColumn: '1 / -1', padding: 24, textAlign: 'center' }}>ยังไม่มีภาพ snapshot ของวันนี้</div>
                  : galleryRows.map((r) => (
                    <div className="gallery-item" key={r.at}>
                      <img className="g-mock" style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block', background: '#161719' }} src={r.snapshot} loading="lazy" alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                      <div className="g-time">{new Date(r.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false })} · {r.blocks} บล็อก</div>
                    </div>
                  ))}
              </div>
            </div></div>
          </div>

          <div className="card" style={{ marginTop: 18 }}>
            <div className="card-head"><h3>Task History</h3></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>งาน</th><th>Zone</th><th>สถานะ</th><th>ความคืบหน้า</th><th>พื้นที่</th></tr></thead>
                <tbody id="dashHistoryBody">
                  {tasks.map((x) => (
                    <tr key={x.id}>
                      <td className="cell-strong">{x.name}</td>
                      <td className="cell-muted">{x.zone}</td>
                      <td><StatusBadge status={x.status} /></td>
                      <td className="cell-muted">{pct(x.area, x.expectedArea)}%</td>
                      <td className="cell-muted">{x.area} m²</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
