/* ===================================================================
   PDF report — a purpose-built A4 document (not a print of the web page).
   Opens a new window with its own HTML/CSS, fills it with data from the API,
   then triggers the browser's print dialog (Save as PDF). Built this way instead
   of a JS PDF library because the browser's text engine renders Thai (stacked
   vowels / tone marks) correctly, which PDF libraries do not.

   Contents: cover + summary KPIs, project overview table, productivity
   (formulas, per-task table), then one section per task with details, the
   substituted calculations, a progress chart and a timed table of images and
   counts sampled from task_history.
=================================================================== */
import { statusLabel, workerName } from './utils.jsx';
import { fmt, fmtPct, pWorking, tWorking, fmtDuration } from './components/ProductivityReport.jsx';
import { productivitySteps, projectSteps, stdLabel, BAND_TEXT } from './productivitySteps.js';
import { loadReportData, sourceLabel, sampleHistory, progressOf as progressValue, dailySummary, SAMPLE_MINUTES, MAX_ROWS_PER_TASK } from './reportData.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dt = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { hour12: false, dateStyle: 'medium', timeStyle: 'short' }) : '—');
const progressOf = (e, expected) => { const p = progressValue(e, expected); return p === null ? '—' : `${fmt(p, 1)}%`; };
const diffClass = (v) => (v === null || v === undefined ? '' : v >= 0 ? 'pos' : 'neg');

// Area over time as an inline SVG (vector — stays sharp in the PDF).
function progressChart(hist, expected) {
  if (hist.length < 2) return '<div class="muted small">ข้อมูลไม่พอสำหรับกราฟ (ต้องมีอย่างน้อย 2 จุด)</div>';
  const W = 680, H = 170, L = 44, R = 12, T = 12, B = 26;
  const t0 = new Date(hist[0].at).getTime(), t1 = new Date(hist[hist.length - 1].at).getTime();
  const maxA = Math.max(expected || 0, ...hist.map((e) => Number(e.area) || 0), 1);
  const x = (e) => L + ((new Date(e.at).getTime() - t0) / Math.max(t1 - t0, 1)) * (W - L - R);
  const y = (a) => H - B - (a / maxA) * (H - T - B);
  const step = Math.max(1, Math.floor(hist.length / 400)); // cap points
  const pts = hist.filter((_, i) => i % step === 0 || i === hist.length - 1).map((e) => `${x(e).toFixed(1)},${y(Number(e.area) || 0).toFixed(1)}`);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const t = new Date(t0 + (t1 - t0) * f);
    return `<text x="${L + (W - L - R) * f}" y="${H - 8}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${esc(t.toLocaleString('th-TH', { hour12: false, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</text>`;
  }).join('');
  const grid = [0, 0.5, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(maxA * f)}" y2="${y(maxA * f)}" class="grid"/><text x="${L - 6}" y="${y(maxA * f) + 3}" text-anchor="end">${fmt(maxA * f, 0)}</text>`).join('');
  const target = expected ? `<line x1="${L}" x2="${W - R}" y1="${y(expected)}" y2="${y(expected)}" class="target"/><text x="${W - R}" y="${y(expected) - 4}" text-anchor="end" class="target-t">เป้าหมาย ${fmt(expected, 0)} ตร.ม.</text>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="chart">${grid}${target}<polyline points="${L},${H - B} ${pts.join(' ')} ${x(hist[hist.length - 1]).toFixed(1)},${H - B}" class="area"/><polyline points="${pts.join(' ')}" class="line"/>${ticks}<text x="${L}" y="${T - 2}" class="axis-t">พื้นที่ (ตร.ม.)</text></svg>`;
}

const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');
@page { size: A4; margin: 14mm 12mm 16mm; @bottom-right { content: "หน้า " counter(page) " / " counter(pages); font: 9px Sarabun, sans-serif; color: #888; } @bottom-left { content: "CIVIL — AI Brick Construction Monitoring"; font: 9px Sarabun, sans-serif; color: #888; } }
* { box-sizing: border-box; }
body { margin: 0; font-family: Sarabun, 'Noto Sans Thai', Thonburi, sans-serif; color: #1d1d1f; font-size: 11.5px; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { page-break-after: always; }
.page:last-child { page-break-after: auto; }
.cover { background: linear-gradient(120deg, #0a4fb3, #0071e3 55%, #5aa3ff); color: #fff; border-radius: 10px; padding: 22px 24px; margin-bottom: 16px; }
.cover .brand { font-weight: 700; letter-spacing: .08em; font-size: 12px; opacity: .85; }
.cover h1 { margin: 6px 0 4px; font-size: 22px; line-height: 1.25; }
.cover .meta { font-size: 11px; opacity: .9; }
h2 { font-size: 15px; margin: 18px 0 8px; padding-bottom: 5px; border-bottom: 2px solid #0071e3; color: #0a3d8a; }
h3 { font-size: 13px; margin: 14px 0 6px; color: #1d1d1f; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 8px 0 4px; }
.kpi { border: 1px solid #dfe3ea; border-radius: 8px; padding: 8px 10px; background: #f7f9fc; }
.kpi span { display: block; font-size: 10px; color: #6e6e73; }
.kpi strong { display: block; font-size: 17px; margin-top: 2px; }
.kpi small { font-size: 9.5px; color: #6e6e73; }
.kpi.pos strong, .pos { color: #1a7f37; } .kpi.neg strong, .neg { color: #c62828; }
table { width: 100%; border-collapse: collapse; margin: 6px 0 4px; font-size: 10.5px; }
th { background: #eef3fb; color: #0a3d8a; text-align: left; font-weight: 600; padding: 6px 7px; border-bottom: 1px solid #c9d6ea; }
td { padding: 5px 7px; border-bottom: 1px solid #e8ebf0; vertical-align: top; }
tr { page-break-inside: avoid; }
td.num, th.num { text-align: right; white-space: nowrap; }
.formulas { border: 1px solid #c9d6ea; background: #f5f8fd; border-radius: 8px; padding: 10px 12px; }
.formulas div { margin-bottom: 6px; } .formulas b { display: block; font-size: 12px; } .formulas span { color: #555; font-size: 10.5px; }
.note { font-size: 10px; color: #6e6e73; margin-top: 4px; }
.muted { color: #6e6e73; } .small { font-size: 10px; }
.info { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 18px; margin: 4px 0 8px; }
.info div { display: flex; gap: 8px; padding: 3px 0; border-bottom: 1px dotted #e0e3e8; } .info dt { color: #6e6e73; min-width: 110px; } .info dd { margin: 0; font-weight: 600; }
.calc { border-left: 3px solid #0071e3; background: #f7f9fc; padding: 7px 10px; margin: 6px 0; font-size: 11px; }
.calc div { margin: 1px 0; }
.steps { list-style: none; padding: 0; margin: 6px 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; }
.steps li { border: 1px solid #dfe3ea; border-radius: 7px; padding: 6px 9px; page-break-inside: avoid; background: #fbfcfe; }
.st-head { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.st-no { display: inline-grid; place-items: center; width: 17px; height: 17px; border-radius: 50%; background: #0071e3; color: #fff; font-size: 9.5px; font-weight: 700; }
.st-formula { color: #6e6e73; font-size: 9.5px; margin: 2px 0 2px 23px; } .st-line { font-size: 10px; margin-left: 23px; }
.st-result { font-weight: 700; color: #0a3d8a; font-size: 10.5px; margin: 3px 0 0 23px; } .st-note { color: #6e6e73; font-size: 9px; margin: 2px 0 0 23px; }
.chart { width: 100%; height: auto; font: 9px Sarabun, sans-serif; fill: #6e6e73; }
.chart .grid { stroke: #e5e8ee; } .chart .line { fill: none; stroke: #0071e3; stroke-width: 2; } .chart .area { fill: rgba(0,113,227,.1); stroke: none; }
.chart .target { stroke: #1a7f37; stroke-dasharray: 5 4; } .chart .target-t { fill: #1a7f37; } .chart .axis-t { fill: #0a3d8a; }
.thumb { width: 120px; height: 68px; object-fit: cover; border-radius: 4px; background: #111; display: block; }
.noimg { width: 120px; height: 68px; border-radius: 4px; background: #f0f1f4; color: #999; display: grid; place-items: center; font-size: 9.5px; }
.badge { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 9.5px; background: #eef0f3; }
.loading { font-family: sans-serif; padding: 40px; color: #555; }
@media screen { body { background: #e9ecf1; } .sheet { max-width: 210mm; margin: 12px auto; background: #fff; padding: 14mm 12mm; box-shadow: 0 2px 14px rgba(0,0,0,.12); } }
`;

// Numbered step-by-step working (productivitySteps.js), same content as the web page.
function stepsHtml(steps) {
  return `<ol class="steps">${steps.map((st) => `<li><div class="st-head"><span class="st-no">${st.no}</span><b>${esc(st.title)}</b></div>
    <div class="st-formula">${esc(st.formula)}</div>${st.lines.map((l) => `<div class="st-line">${esc(l)}</div>`).join('')}
    <div class="st-result">${esc(st.result)}</div>${st.note ? `<div class="st-note">${esc(st.note)}</div>` : ''}</li>`).join('')}</ol>`;
}

function dailyTable(hist, prod) {
  const days = dailySummary(hist, { N: prod?.N || 0, dayMinutes: prod?.dayMinutes || 480 });
  if (!days.length) return '';
  const rows = days.map((d) => `<tr><td>${esc(new Date(d.date + 'T00:00').toLocaleDateString('th-TH', { dateStyle: 'medium' }))}</td>
    <td class="num">${esc(fmtDuration(d.workMinutes))}</td><td class="num">${d.images.toLocaleString()}</td>
    <td class="num">${d.blocksEnd.toLocaleString()} (${d.blocksGained >= 0 ? '+' : ''}${d.blocksGained.toLocaleString()})</td>
    <td class="num">${fmt(d.areaEnd)} (${d.areaGained >= 0 ? '+' : ''}${fmt(d.areaGained)})</td>
    <td class="num">${fmt(d.peopleAvg, 1)} / ${d.peopleMax}</td><td class="num"><b>${fmt(d.pDay)}</b></td></tr>`).join('');
  return `<h3>สรุปรายวัน</h3>
    <table><thead><tr><th>วันที่</th><th class="num">เวลาทำงาน</th><th class="num">ภาพ</th><th class="num">บล็อก (เพิ่มขึ้น)</th><th class="num">พื้นที่ ตร.ม. (เพิ่มขึ้น)</th><th class="num">คน AI เฉลี่ย / สูงสุด</th><th class="num">PD วันนั้น</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="note">PD วันนั้น = พื้นที่ที่เพิ่มขึ้นในวันนั้น ÷ (N × T ของวันนั้น) — ค่าติดลบ/แกว่งได้ถ้า AI นับจำนวนบล็อกต่างกันระหว่างวัน</div>`;
}

function taskSection(t, prod, hist, workersMaster, n) {
  const sample = sampleHistory(hist);
  const workers = (t.workers || []).map((w) => esc(workerName(workersMaster, w))).join(', ') || '—';
  const sched = t.schedule && t.schedule.start ? `${esc(t.schedule.start)}–${esc(t.schedule.end)}${t.schedule.breakStart ? ` (พัก ${esc(t.schedule.breakStart)}–${esc(t.schedule.breakEnd)})` : ''}` : 'ไม่ได้ตั้ง (ใช้ 8 ชม./วัน)';
  const pct = t.expectedArea ? Math.round((t.area / t.expectedArea) * 1000) / 10 : 0;
  const rows = sample.map((e) => `
    <tr>
      <td>${esc(dt(e.at))}</td>
      <td>${e.snapshot ? `<img class="thumb" src="${esc(e.snapshot)}" alt="">` : '<div class="noimg">ไม่มีภาพ</div>'}</td>
      <td class="num">${Number(e.blocks || 0).toLocaleString()}${e.corrected ? ' <span style="color:#7c3aed" title="ตรวจแก้โดยคน">✎</span>' : ''}</td>
      <td class="num">${fmt(e.area)}</td>
      <td class="num">${progressOf(e, t.expectedArea)}</td>
      <td class="num">${e.peopleDetected || 0}</td>
      <td class="num">${e.workersAssigned ?? '—'}</td>
      <td>${esc(e.status ? statusLabel(e.status) : '—')}</td>
    </tr>`).join('');
  return `
  <section class="page">
    <h2>${n}. ${esc(t.name)}</h2>
    <dl class="info">
      <div><dt>Zone</dt><dd>${esc(t.zone || '—')}</dd></div>
      <div><dt>สถานะ</dt><dd>${esc(statusLabel(t.status))}</dd></div>
      <div><dt>ผลลัพธ์ที่ใช้</dt><dd>${esc(sourceLabel(t))}${t.resultSource === 'human' && prod ? ` (AI นับได้ ${prod.aiBlocks} บล็อก / ${fmt(prod.aiQ, 3)} ตร.ม.)` : ''}</dd></div>
      <div><dt>ประเภทอิฐ</dt><dd>${esc(prod?.brickType || '—')}</dd></div>
      <div><dt>ตารางงาน</dt><dd>${sched}</dd></div>
      <div><dt>แรงงานที่มอบหมาย</dt><dd>${workers}</dd></div>
      <div><dt>บันทึกครั้งแรก / ล่าสุด</dt><dd>${esc(dt(prod?.firstAt))} / ${esc(dt(prod?.lastAt))}</dd></div>
      <div><dt>วันที่มีการทำงาน</dt><dd>${prod?.activeDays ?? 0} วัน</dd></div>
      <div><dt>เวลาทำงานรวม</dt><dd>${esc(fmtDuration(prod?.runMinutes || 0))} (${fmt(prod?.runMinutes || 0, 0)} นาที · ${(prod?.images || 0).toLocaleString()} ภาพ)</dd></div>
    </dl>
    <div class="kpis">
      <div class="kpi"><span>บล็อกที่นับได้</span><strong>${Number(t.blocks || 0).toLocaleString()}</strong><small>ก้อน</small></div>
      <div class="kpi"><span>พื้นที่ / เป้าหมาย</span><strong>${fmt(t.area, 1)} / ${fmt(t.expectedArea, 0)}</strong><small>ตร.ม. (${pct}%)</small></div>
      <div class="kpi"><span>Productivity จริง</span><strong>${fmt(prod?.pActual)}</strong><small>ตร.ม./คน-วัน (มาตรฐาน ${stdLabel(prod)}${prod?.stdBand ? ` · ${BAND_TEXT[prod.stdBand]}` : ''})</small></div>
      <div class="kpi ${diffClass(prod?.diffPct)}"><span>% ความแตกต่าง</span><strong>${fmtPct(prod?.diffPct)}</strong><small>${prod?.diffPct == null ? 'ยังเทียบไม่ได้' : prod.diffPct >= 0 ? 'สูงกว่ามาตรฐาน' : 'ต่ำกว่ามาตรฐาน'}</small></div>
    </div>
    ${prod ? `<h3>การคำนวณ Productivity โดยละเอียด</h3>${stepsHtml(productivitySteps(prod, (t.workers || []).map((w) => workerName(workersMaster, w))))}` : ''}
    <h3>ความคืบหน้าตามเวลา</h3>
    ${progressChart(hist, t.expectedArea)}
    ${dailyTable(hist, prod)}
    <h3>ตารางบันทึกรายช่วงเวลา</h3>
    ${sample.length ? `<table>
      <thead><tr><th>วันที่-เวลา</th><th>ภาพ</th><th class="num">บล็อก</th><th class="num">พื้นที่ (ตร.ม.)</th><th class="num">ความคืบหน้า</th><th class="num">คนที่ AI ตรวจพบ</th><th class="num">แรงงานมอบหมาย</th><th>สถานะ</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${sample.some((e) => e.corrected) ? '<div class="note"><span style="color:#7c3aed">✎</span> = นาทีที่คนตรวจแก้ Label แล้ว (ผลลัพธ์ตัวเลือกที่ 2) — บล็อก พื้นที่ และจำนวนคนเป็นค่าหลังตรวจแก้</div>' : ''}
    <div class="note">แสดง 1 แถวต่อ ${SAMPLE_MINUTES} นาทีที่มีการบันทึก (รวมรายการล่าสุด) สูงสุด ${MAX_ROWS_PER_TASK} แถว จากทั้งหมด ${hist.length.toLocaleString()} นาที</div>`
    : '<div class="muted">ยังไม่มีข้อมูลที่บันทึกไว้สำหรับงานนี้</div>'}
  </section>`;
}

function buildHtml({ tasks, workersMaster, prod, histories, user, title }) {
  const byId = new Map((prod?.tasks || []).map((p) => [p.taskId, p]));
  const project = prod?.project || {};
  const totalBlocks = tasks.reduce((s, t) => s + (t.blocks || 0), 0);
  const totalArea = tasks.reduce((s, t) => s + (t.area || 0), 0);
  const totalExpected = tasks.reduce((s, t) => s + (t.expectedArea || 0), 0);
  const workers = new Set(tasks.flatMap((t) => t.workers || [])).size;
  const overview = tasks.map((t, i) => {
    const pct = t.expectedArea ? Math.round((t.area / t.expectedArea) * 1000) / 10 : 0;
    return `<tr><td>${i + 1}</td><td><b>${esc(t.name)}</b><div class="muted small">${esc(t.zone || '')}${t.resultSource === 'human' ? ' · ② ผลตรวจแก้ (HITL)' : ''}</div></td><td>${esc(byId.get(t.id)?.brickType || '—')}</td>
      <td class="num">${Number(t.blocks || 0).toLocaleString()}</td><td class="num">${fmt(t.area, 1)} / ${fmt(t.expectedArea, 0)}</td><td class="num">${pct}%</td>
      <td class="num">${(t.workers || []).length}</td><td><span class="badge">${esc(statusLabel(t.status))}</span></td></tr>`;
  }).join('');
  const prodRows = (prod?.tasks || []).map((p) => `<tr><td><b>${esc(p.name)}</b></td><td class="num">${esc(fmtDuration(p.runMinutes))}</td><td class="num">${fmt(p.Q)}</td><td class="num">${p.N}</td><td class="num">${fmt(p.T, 3)}</td>
    <td class="num"><b>${fmt(p.pActual)}</b></td><td class="num">${stdLabel(p)}</td><td class="num ${diffClass(p.diffPct)}"><b>${fmtPct(p.diffPct)}</b></td>
    <td class="num">${fmt(p.durationStd, 1)}</td><td class="num">${fmt(p.durationForecast, 1)}</td><td class="num">${fmt(p.remainingDays, 1)}</td></tr>`).join('');

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>CIVIL รายงาน ${esc(new Date().toLocaleDateString('th-TH'))}</title><style>${STYLE}</style></head><body><div class="sheet">
  <section class="page">
    <div class="cover">
      <div class="brand">CIVIL · AI BRICK CONSTRUCTION MONITORING</div>
      <h1>${title ? esc(title) : 'รายงานความคืบหน้างานก่ออิฐ<br>และผลิตภาพแรงงาน (Productivity)'}</h1>
      <div class="meta">จัดทำเมื่อ ${esc(new Date().toLocaleString('th-TH', { hour12: false, dateStyle: 'long', timeStyle: 'short' }))}${user ? ` · โดย ${esc(user)}` : ''} · ${tasks.length} งาน</div>
    </div>

    <h2>1. สรุปภาพรวม</h2>
    <div class="kpis">
      <div class="kpi"><span>จำนวนงาน</span><strong>${tasks.length}</strong><small>Task</small></div>
      <div class="kpi"><span>บล็อกที่นับได้รวม</span><strong>${totalBlocks.toLocaleString()}</strong><small>ก้อน</small></div>
      <div class="kpi"><span>พื้นที่รวม / เป้าหมาย</span><strong>${fmt(totalArea, 1)}</strong><small>จาก ${fmt(totalExpected, 0)} ตร.ม. (${totalExpected ? Math.round((totalArea / totalExpected) * 100) : 0}%)</small></div>
      <div class="kpi"><span>แรงงานที่มอบหมาย</span><strong>${workers}</strong><small>คน</small></div>
      <div class="kpi"><span>Productivity จริง (ทั้งโครงการ)</span><strong>${fmt(project.pActual)}</strong><small>ตร.ม./คน-วัน</small></div>
      <div class="kpi"><span>P มาตรฐาน (ถ่วงน้ำหนัก)</span><strong>${fmt(project.pStd)}</strong><small>ตร.ม./คน-วัน</small></div>
      <div class="kpi ${diffClass(project.diffPct)}"><span>% ความแตกต่าง</span><strong>${fmtPct(project.diffPct)}</strong><small>${project.diffPct == null ? 'ยังเทียบไม่ได้' : project.diffPct >= 0 ? 'สูงกว่ามาตรฐาน' : 'ต่ำกว่ามาตรฐาน'}</small></div>
      <div class="kpi"><span>คน-วันที่ใช้รวม</span><strong>${fmt(project.manDays)}</strong><small>คน-วัน</small></div>
    </div>

    <h3>รายการงานทั้งหมด</h3>
    <table><thead><tr><th>#</th><th>งาน</th><th>ประเภทอิฐ</th><th class="num">บล็อก</th><th class="num">พื้นที่ / เป้าหมาย (ตร.ม.)</th><th class="num">ความคืบหน้า</th><th class="num">แรงงาน</th><th>สถานะ</th></tr></thead><tbody>${overview}</tbody></table>
  </section>

  <section class="page">
    <h2>2. ผลิตภาพแรงงาน (Productivity)</h2>
    <div class="formulas">
      <div><b>Productivity (จริง) = Q / (N × T)</b><span>Q = ปริมาณงาน (ตร.ม.) · N = จำนวนแรงงาน (คน) · T = เวลาที่ใช้ (วัน)</span></div>
      <div><b>% ความแตกต่าง = [(P จริง − P มาตรฐาน) / P มาตรฐาน] × 100</b><span>(+) productivity สูงกว่ามาตรฐาน · (−) productivity ต่ำกว่ามาตรฐาน</span></div>
      <div><b>Duration = Q / (P × N)</b><span>Q = ปริมาณงานทั้งหมด · P = ผลิตภาพแรงงาน (ตร.ม./คน-วัน) · N = จำนวนแรงงาน (คน)</span></div>
    </div>
    <div class="note">ที่มาของค่า: Q = พื้นที่ที่ AI นับได้ล่าสุด · N = แรงงานที่มอบหมายเข้างาน · T = เวลาทำงานจริงจาก timestamp ของภาพ (ภาพห่างเกิน 2.5 นาทีไม่นับ) ÷ นาทีทำงานต่อวันตามตารางงาน (หักพัก; ไม่ได้ตั้งตาราง = 8 ชม.) · P มาตรฐานตั้งต่อประเภทอิฐ · Duration ใช้พื้นที่เป้าหมายทั้งหมดของงาน · คงเหลือ = พื้นที่ที่เหลือ ÷ (P จริง × N)</div>
    <table><thead><tr><th>งาน</th><th class="num">เวลาทำงานรวม</th><th class="num">Q (ตร.ม.)</th><th class="num">N (คน)</th><th class="num">T (วัน)</th><th class="num">P จริง</th><th class="num">P มาตรฐาน</th><th class="num">% ต่าง</th><th class="num">Duration มาตรฐาน (วัน)</th><th class="num">Duration คาดการณ์ (วัน)</th><th class="num">คงเหลือ (วัน)</th></tr></thead><tbody>${prodRows || '<tr><td colspan="11" class="muted">ไม่มีข้อมูล</td></tr>'}</tbody></table>
    <div class="note">P หน่วย ตร.ม./คน-วัน · ช่องที่เป็น "—" คือคำนวณไม่ได้ (ยังไม่มอบหมายแรงงาน, ยังไม่มีเวลาทำงาน หรือยังไม่ได้ตั้ง P มาตรฐานของประเภทอิฐ) · การคำนวณโดยละเอียดของแต่ละงานอยู่ในหัวข้อ 3</div>
    <h3>การคำนวณทั้งโครงการ (ทีละขั้น)</h3>
    ${stepsHtml(projectSteps(project, prod?.tasks || []))}
  </section>

  ${tasks.map((t, i) => taskSection(t, byId.get(t.id), histories.get(t.id) || [], workersMaster, `3.${i + 1}`)).join('')}
  </div></body></html>`;
}

// title: optional cover title (e.g. the task name for a single-task report)
export async function openReportPdf({ tasks, workersMaster, user, title }) {
  // open synchronously inside the click handler, or popup blockers eat it
  const win = window.open('', '_blank');
  if (!win) throw new Error('เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาต pop-up สำหรับเว็บนี้แล้วลองอีกครั้ง');
  win.document.write('<p class="loading" style="font-family:sans-serif;padding:40px;color:#555">กำลังเตรียมรายงาน PDF...</p>');

  const data = await loadReportData(tasks);
  const html = buildHtml({ tasks: data.tasks, workersMaster, prod: data.prod, histories: data.histories, user, title });

  win.document.open();
  win.document.write(html);
  win.document.close();
  // print once fonts and every thumbnail have loaded (or failed), so nothing is missing from the PDF
  const imgs = Array.from(win.document.images);
  await Promise.race([
    Promise.all([win.document.fonts?.ready, ...imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = r; im.onerror = r; })))]),
    new Promise((r) => setTimeout(r, 15000)),
  ]);
  win.focus();
  win.print();
}
