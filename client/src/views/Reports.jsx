import { useEffect, useMemo, useState } from 'react';
import Icon from '../icons/Icon.jsx';
import StatCard from '../components/StatCard.jsx';
import BarChart from '../components/charts/BarChart.jsx';
import TimeSeriesChart from '../components/charts/TimeSeriesChart.jsx';
import { workerName, statusLabel, StatusBadge, downloadBlob } from '../utils.jsx';
import { useToast } from '../components/Toast.jsx';
import * as api from '../api.js';

const LABELS = { daily: 'รายวัน', weekly: 'รายสัปดาห์', monthly: 'รายเดือน', byTask: 'ตามงาน', byWorker: 'ตามแรงงาน' };
const TABS = [['daily', 'รายวัน'], ['weekly', 'รายสัปดาห์'], ['monthly', 'รายเดือน'], ['byTask', 'ตามงาน'], ['byWorker', 'ตามแรงงาน']];

function periodRangeForTab(tab) {
  const now = new Date();
  if (tab === 'daily') { const from = new Date(now); from.setHours(0, 0, 0, 0); return { from: from.toISOString(), numBuckets: 24, unit: 'hour' }; }
  if (tab === 'weekly') return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), numBuckets: 7, unit: 'day' };
  return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), numBuckets: 30, unit: 'day' };
}

/* ===================================================================
   Reports — ported from app.js renderReports()/renderReportByTaskTable()/
   renderReportByWorker()/renderReportTimeSeriesChart()/export*().
   Export functions build CSV/Excel content from the same row data that
   drives the visible table (rather than scraping the DOM like the
   original did) — the exported content is identical to what's on screen.
=================================================================== */
export default function Reports({ tasks, workersMaster }) {
  const toast = useToast();
  const [tab, setTab] = useState('daily');
  const [timeSeries, setTimeSeries] = useState(null); // {labels, values} | null while loading

  const totalBlocks = tasks.reduce((s, t) => s + (t.blocks || 0), 0);
  const totalArea = tasks.reduce((s, t) => s + (t.area || 0), 0);
  const totalExpected = tasks.reduce((s, t) => s + (t.expectedArea || 0), 0);
  const overallPct = totalExpected ? Math.round((totalArea / totalExpected) * 100) : 0;
  const totalPeople = tasks.reduce((s, t) => s + (t.peopleDetected || 0), 0);
  const totalWorkersAssigned = new Set(tasks.flatMap((t) => t.workers)).size;

  const byTaskHeaders = ['งาน', 'Zone', 'แรงงานที่มอบหมาย', 'คนที่ตรวจพบ (AI)', 'พื้นที่', 'ความคืบหน้า', 'สถานะ'];
  const byTaskRows = tasks.map((t) => ({
    status: t.status,
    cells: [
      t.name, t.zone,
      t.workers.map((w) => workerName(workersMaster, w)).join(', ') || '—',
      (t.peopleDetected || 0) + ' คน',
      `${t.area} / ${t.expectedArea} m²`,
      (t.expectedArea ? Math.round((t.area / t.expectedArea) * 100) : 0) + '%',
      statusLabel(t.status),
    ],
  }));

  const workerHeaders = ['แรงงาน', 'ตำแหน่ง', 'จำนวนงาน', 'งานที่มอบหมาย', 'พื้นที่รวม', 'บล็อกรวม'];
  const workerRows = useMemo(() => workersMaster.map((w) => {
    const myTasks = tasks.filter((t) => t.workers.includes(w.id));
    return {
      worker: w, tasks: myTasks,
      totalArea: myTasks.reduce((s, t) => s + (t.area || 0), 0),
      totalBlocks: myTasks.reduce((s, t) => s + (t.blocks || 0), 0),
    };
  }), [tasks, workersMaster]);

  useEffect(() => {
    if (tab !== 'daily' && tab !== 'weekly' && tab !== 'monthly') { setTimeSeries(null); return undefined; }
    let cancelled = false;
    setTimeSeries(null);
    (async () => {
      const { from, numBuckets, unit } = periodRangeForTab(tab);
      const now = new Date();
      const buckets = [];
      for (let i = numBuckets - 1; i >= 0; i--) {
        const d = new Date(now);
        if (unit === 'hour') { d.setMinutes(0, 0, 0); d.setHours(d.getHours() - i); }
        else { d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); }
        const key = unit === 'hour' ? d.toISOString().slice(0, 13) : d.toISOString().slice(0, 10);
        const label = unit === 'hour' ? `${d.getHours()}:00` : `${d.getDate()}/${d.getMonth() + 1}`;
        buckets.push({ key, label });
      }
      const bucketIndex = new Map(buckets.map((b, i) => [b.key, i]));
      const perTaskSeries = await Promise.all(tasks.map(async (t) => {
        let hist = [];
        try { hist = await api.getTaskHistory(t.id, { from }); } catch (_) { /* skip */ }
        const perBucket = new Array(buckets.length).fill(null);
        hist.forEach((entry) => {
          const d = new Date(entry.at);
          const key = unit === 'hour' ? d.toISOString().slice(0, 13) : d.toISOString().slice(0, 10);
          const idx = bucketIndex.get(key);
          if (idx !== undefined) perBucket[idx] = entry.blocks;
        });
        let carry = 0;
        return perBucket.map((v) => { if (v !== null) carry = v; return carry; });
      }));
      if (cancelled) return;
      const totals = buckets.map((_, i) => perTaskSeries.reduce((s, arr) => s + (arr[i] || 0), 0));
      setTimeSeries({ labels: buckets.map((b) => b.label), values: totals });
    })();
    return () => { cancelled = true; };
  }, [tab, tasks]);

  const activeTable = tab === 'byWorker'
    ? { title: 'รายละเอียดตามแรงงาน', headers: workerHeaders, rows: workerRows.map((r) => [r.worker.name, r.worker.role, String(r.tasks.length), r.tasks.map((t) => t.name).join(', ') || '—', r.totalArea.toFixed(1) + ' m²', r.totalBlocks.toLocaleString()]) }
    : { title: 'รายละเอียดตามงาน', headers: byTaskHeaders, rows: byTaskRows.map((r) => r.cells) };

  function currentReportRows() {
    return { headers: activeTable.headers, rows: activeTable.rows };
  }
  function exportCSV() {
    const { headers, rows } = currentReportRows();
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadBlob('﻿' + csv, `civil-report-${tab}.csv`, 'text/csv;charset=utf-8;');
    toast('ดาวน์โหลดไฟล์ CSV แล้ว', 'success');
  }
  function exportExcel() {
    const { headers, rows } = currentReportRows();
    const html = `<table><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
    downloadBlob(html, `civil-report-${tab}.xls`, 'application/vnd.ms-excel');
    toast('ดาวน์โหลดไฟล์ Excel แล้ว', 'success');
  }
  function exportPDF() {
    toast('กำลังเปิดหน้าต่างพิมพ์ / บันทึกเป็น PDF...');
    setTimeout(() => window.print(), 400);
  }

  let chartTitle, chartHint, chart;
  if (tab === 'byWorker') {
    chartTitle = 'บล็อกรวมต่อแรงงาน';
    chartHint = 'รวมจากทุกงานที่แรงงานคนนั้นถูกมอบหมาย (นับซ้ำได้ถ้าอยู่หลายงานพร้อมกัน)';
    chart = <BarChart labels={workerRows.map((r) => r.worker.name)} values={workerRows.map((r) => r.totalBlocks)} color="var(--purple)" />;
  } else if (tab === 'byTask') {
    chartTitle = 'ความคืบหน้าเทียบเป้าหมาย';
    chartHint = '% พื้นที่ที่ทำได้ เทียบเป้าหมายของแต่ละงาน';
    chart = <BarChart labels={tasks.map((t) => t.name)} values={tasks.map((t) => (t.expectedArea ? Math.round((t.area / t.expectedArea) * 100) : 0))} color="var(--green)" />;
  } else {
    chartTitle = 'Progress Overview';
    chartHint = 'รวมจำนวนบล็อกที่นับได้ ทุก Task ตามช่วงเวลาจริง (จาก Task History)';
    chart = timeSeries
      ? <TimeSeriesChart labels={timeSeries.labels} series={timeSeries.values} color="var(--accent)" />
      : <div className="cell-muted" style={{ padding: 40, textAlign: 'center' }}>กำลังโหลดข้อมูล...</div>;
  }

  return (
    <section id="view-reports" className="view active">
      <div id="reportPrintHeader" className="print-only">
        <div className="report-print-brand">CIVIL — รายงานสรุปผลการก่อสร้าง</div>
        <div id="reportPrintMeta" className="report-print-meta">ช่วงเวลา: {LABELS[tab]} · สร้างรายงานเมื่อ {new Date().toLocaleString('th-TH')}</div>
      </div>

      <div className="section-head">
        <div><h2>Reports</h2><p id="reportPeriodLabel">{LABELS[tab]}</p></div>
        <div className="toolbar">
          <div id="reportTabs" className="tabs">
            {TABS.map(([key, label]) => (
              <button key={key} className={`tab-btn${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>{label}</button>
            ))}
          </div>
          <button className="btn btn-secondary" onClick={exportCSV}>CSV</button>
          <button className="btn btn-secondary" onClick={exportExcel}>Excel</button>
          <button className="btn btn-primary" onClick={exportPDF}>PDF</button>
        </div>
      </div>

      <div id="reportStats" className="grid-stats">
        <StatCard icon={<Icon name="task" />} label="จำนวน Task" value={tasks.length} />
        <StatCard icon={<Icon name="block" />} label="บล็อกที่นับได้รวม" value={totalBlocks.toLocaleString()} />
        <StatCard icon={<Icon name="area" />} label="พื้นที่รวม" value={totalArea.toFixed(1) + ' m²'} />
        <StatCard icon={<Icon name="percent" />} label="ความสำเร็จรวม" value={overallPct + '%'} />
        <StatCard icon={<Icon name="users" />} label="คนที่ตรวจพบ (AI) รวม" value={totalPeople + ' คน'} />
        <StatCard icon={<Icon name="users" />} label="แรงงานที่มอบหมาย" value={totalWorkersAssigned + ' คน'} />
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head"><h3 id="reportChartTitle">{chartTitle}</h3><span id="reportChartHint" className="cell-muted" style={{ fontSize: 12 }}>{chartHint}</span></div>
        <div className="card-body"><div id="reportChart" className="chart">{chart}</div></div>
      </div>

      <div className="card">
        <div className="card-head"><h3 id="reportTableTitle">{activeTable.title}</h3></div>
        <div className="table-wrap">
          <table>
            <thead><tr id="reportTableHead">{activeTable.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody id="reportTableBody">
              {tab === 'byWorker' ? (
                workerRows.length === 0 ? (
                  <tr><td colSpan={workerHeaders.length}><div className="empty-state"><Icon name="empty" /><div className="e-title">ยังไม่มีแรงงาน</div></div></td></tr>
                ) : workerRows.map((r) => (
                  <tr key={r.worker.id}>
                    <td className="cell-strong">{r.worker.name}</td>
                    <td className="cell-muted">{r.worker.role}</td>
                    <td className="cell-muted">{r.tasks.length}</td>
                    <td className="cell-muted">{r.tasks.map((t) => t.name).join(', ') || '—'}</td>
                    <td className="cell-muted">{r.totalArea.toFixed(1)} m²</td>
                    <td className="cell-muted">{r.totalBlocks.toLocaleString()}</td>
                  </tr>
                ))
              ) : (
                byTaskRows.length === 0 ? (
                  <tr><td colSpan={byTaskHeaders.length}><div className="empty-state"><Icon name="empty" /><div className="e-title">ยังไม่มี Task</div></div></td></tr>
                ) : byTaskRows.map((r, i) => (
                  <tr key={i}>
                    <td className="cell-strong">{r.cells[0]}</td>
                    <td className="cell-muted">{r.cells[1]}</td>
                    <td className="cell-muted">{r.cells[2]}</td>
                    <td className="cell-muted">{r.cells[3]}</td>
                    <td className="cell-muted">{r.cells[4]}</td>
                    <td className="cell-muted">{r.cells[5]}</td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
