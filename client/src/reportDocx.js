/* ===================================================================
   Word (.docx) export — same content as the PDF report (reportPdf.js):
   summary, productivity with formulas, and per task: details, the
   substituted calculations, a daily summary and the timed table with
   image thumbnails. Built with the `docx` library, so it is a real,
   editable Word document (Word shapes Thai text itself).
=================================================================== */
import {
  AlignmentType, Document, Footer, HeadingLevel, ImageRun, Packer, PageBreak, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType,
} from 'docx';
import { statusLabel, workerName } from './utils.jsx';
import { fmt, fmtPct, pWorking, tWorking, fmtDuration } from './components/ProductivityReport.jsx';
import { productivitySteps, projectSteps, stdLabel, BAND_TEXT } from './productivitySteps.js';
import { loadReportData, sourceLabel, sampleHistory, progressOf, dailySummary, SAMPLE_MINUTES, MAX_ROWS_PER_TASK } from './reportData.js';

const FONT = 'Tahoma'; // has Thai glyphs on both Windows and macOS
const BLUE = '0A3D8A';
const MARGIN = 800; // twips
const CONTENT_W = 11906 - 2 * MARGIN; // A4 width minus left/right margins, in twips
const dt = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { hour12: false, dateStyle: 'medium', timeStyle: 'short' }) : '—');

const run = (text, o = {}) => new TextRun({ text: String(text ?? ''), font: FONT, size: o.size || 19, bold: o.bold, color: o.color, italics: o.italics });
const para = (text, o = {}) => new Paragraph({ children: Array.isArray(text) ? text : [run(text, o)], spacing: { after: o.after ?? 80 }, alignment: o.align });
const heading = (text, level = HeadingLevel.HEADING_1) => new Paragraph({
  heading: level, spacing: { before: 240, after: 120 },
  children: [run(text, { size: level === HeadingLevel.HEADING_1 ? 30 : 24, bold: true, color: BLUE })],
});

function cell(content, o = {}, width) {
  const children = content instanceof ImageRun ? [new Paragraph({ children: [content] })]
    : [new Paragraph({ alignment: o.num ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [run(content, { size: o.size || 17, bold: o.bold || o.head, color: o.head ? BLUE : o.color })] })];
  return new TableCell({
    children,
    shading: o.head ? { type: ShadingType.CLEAR, fill: 'EEF3FB', color: 'auto' } : undefined,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    width: width ? { size: width, type: WidthType.DXA } : undefined,
  });
}
// headers: [label | {label, num, w}], rows: arrays of values / ImageRun / {v, num, bold, color}.
// `w` = relative column width (default 1). Explicit twip widths + fixed layout: without them some
// viewers (Pages, Quick Look, LibreOffice) squeeze every column to a single character.
function table(headers, rows) {
  const h = headers.map((x) => (typeof x === 'string' ? { label: x } : x));
  const total = h.reduce((s, x) => s + (x.w || 1), 0);
  const widths = h.map((x) => Math.floor(((x.w || 1) / total) * CONTENT_W));
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({ tableHeader: true, children: h.map((x, i) => cell(x.label, { head: true, num: x.num }, widths[i])) }),
      ...rows.map((r) => new TableRow({
        cantSplit: true,
        children: r.map((v, i) => (v instanceof ImageRun ? cell(v, {}, widths[i])
          : typeof v === 'object' && v !== null ? cell(v.v, { num: h[i]?.num, bold: v.bold, color: v.color }, widths[i])
            : cell(v, { num: h[i]?.num }, widths[i]))),
      })),
    ],
  });
}
// Numbered step-by-step working (productivitySteps.js) as Word paragraphs.
function stepsDocx(steps) {
  const out = [];
  for (const st of steps) {
    out.push(new Paragraph({ spacing: { before: 100, after: 20 }, keepNext: true, children: [run(`${st.no}. ${st.title}`, { bold: true, color: BLUE, size: 19 })] }));
    out.push(new Paragraph({ spacing: { after: 20 }, indent: { left: 300 }, keepNext: true, children: [run(st.formula, { italics: true, color: '6E6E73', size: 17 })] }));
    st.lines.forEach((l) => out.push(new Paragraph({ spacing: { after: 10 }, indent: { left: 300 }, keepNext: true, children: [run(l, { size: 17 })] })));
    out.push(new Paragraph({ spacing: { after: st.note ? 10 : 60 }, indent: { left: 300 }, children: [run(st.result, { bold: true, size: 18 })] }));
    if (st.note) out.push(new Paragraph({ spacing: { after: 60 }, indent: { left: 300 }, children: [run(st.note, { size: 15, color: '6E6E73' })] }));
  }
  return out;
}
const diffColor = (v) => (v === null || v === undefined ? undefined : v >= 0 ? '1A7F37' : 'C62828');

// Snapshot -> small JPEG thumbnail for the table (keeps the .docx small), or null if it can't be loaded.
async function thumb(url) {
  try {
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob);
    const W = 320, H = Math.round((bmp.height / bmp.width) * W) || 180;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d').drawImage(bmp, 0, 0, W, H);
    const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.72));
    return { data: new Uint8Array(await out.arrayBuffer()), ratio: H / W };
  } catch (_) {
    return null;
  }
}

async function taskSection(t, prod, hist, workersMaster, n) {
  const out = [new Paragraph({ children: [new PageBreak()] }), heading(`${n}. ${t.name}`)];
  const sched = t.schedule && t.schedule.start ? `${t.schedule.start}–${t.schedule.end}${t.schedule.breakStart ? ` (พัก ${t.schedule.breakStart}–${t.schedule.breakEnd})` : ''}` : 'ไม่ได้ตั้ง (ใช้ 8 ชม./วัน)';
  const pctDone = t.expectedArea ? Math.round((t.area / t.expectedArea) * 1000) / 10 : 0;
  out.push(table([{ label: 'รายการ', w: 1 }, { label: 'ข้อมูล', w: 2.6 }], [
    ['Zone', t.zone || '—'], ['สถานะ', statusLabel(t.status)], ['ประเภทอิฐ', prod?.brickType || '—'],
    ['ผลลัพธ์ที่ใช้', `${sourceLabel(t)}${t.resultSource === 'human' && prod ? ` (AI นับได้ ${prod.aiBlocks} บล็อก / ${fmt(prod.aiQ, 3)} ตร.ม.)` : ''}`],
    ['ตารางงาน', sched], ['แรงงานที่มอบหมาย', (t.workers || []).map((w) => workerName(workersMaster, w)).join(', ') || '—'],
    ['บันทึกครั้งแรก / ล่าสุด', `${dt(prod?.firstAt)} / ${dt(prod?.lastAt)}`],
    ['เวลาทำงานรวม', `${fmtDuration(prod?.runMinutes || 0)} (${fmt(prod?.runMinutes || 0, 0)} นาที · ${(prod?.images || 0).toLocaleString()} ภาพ · ${prod?.activeDays || 0} วัน)`],
    ['บล็อก / พื้นที่', `${Number(t.blocks || 0).toLocaleString()} ก้อน · ${fmt(t.area, 1)} / ${fmt(t.expectedArea, 0)} ตร.ม. (${pctDone}%)`],
    ['PD จริง / มาตรฐาน', { v: `${fmt(prod?.pActual)} / ${stdLabel(prod)} ตร.ม./คน-วัน (${fmtPct(prod?.diffPct)}${prod?.stdBand ? ` · ${BAND_TEXT[prod.stdBand]}` : ''})`, bold: true, color: diffColor(prod?.diffPct) }],
  ]));

  if (prod) {
    out.push(heading('การคำนวณ Productivity โดยละเอียด', HeadingLevel.HEADING_2));
    out.push(...stepsDocx(productivitySteps(prod, (t.workers || []).map((w) => workerName(workersMaster, w)))));
  }

  const days = dailySummary(hist, { N: prod?.N || 0, dayMinutes: prod?.dayMinutes || 480 });
  if (days.length) {
    out.push(heading('สรุปรายวัน', HeadingLevel.HEADING_2));
    out.push(table([{ label: 'วันที่', w: 1.3 }, { label: 'เวลาทำงาน', num: true }, { label: 'ภาพ', num: true }, { label: 'บล็อก (เพิ่ม)', num: true }, { label: 'พื้นที่ ตร.ม. (เพิ่ม)', num: true }, { label: 'คน AI เฉลี่ย/สูงสุด', num: true }, { label: 'PD วันนั้น', num: true }],
      days.map((d) => [
        new Date(d.date + 'T00:00').toLocaleDateString('th-TH', { dateStyle: 'medium' }), fmtDuration(d.workMinutes), d.images.toLocaleString(),
        `${d.blocksEnd.toLocaleString()} (${d.blocksGained >= 0 ? '+' : ''}${d.blocksGained.toLocaleString()})`,
        `${fmt(d.areaEnd)} (${d.areaGained >= 0 ? '+' : ''}${fmt(d.areaGained)})`, `${fmt(d.peopleAvg, 1)} / ${d.peopleMax}`, { v: fmt(d.pDay), bold: true },
      ])));
  }

  out.push(heading('ตารางบันทึกรายช่วงเวลา', HeadingLevel.HEADING_2));
  const sample = sampleHistory(hist);
  if (!sample.length) {
    out.push(para('ยังไม่มีข้อมูลที่บันทึกไว้สำหรับงานนี้', { italics: true }));
    return out;
  }
  const thumbs = await Promise.all(sample.map((e) => (e.snapshot ? thumb(e.snapshot) : null)));
  out.push(table([{ label: 'วันที่-เวลา', w: 1.5 }, { label: 'ภาพ', w: 2.1 }, { label: 'บล็อก', num: true }, { label: 'พื้นที่ (ตร.ม.)', num: true }, { label: 'ความคืบหน้า', num: true }, { label: 'คน AI', num: true }, 'สถานะ'],
    sample.map((e, i) => {
      const tb = thumbs[i];
      const p = progressOf(e, t.expectedArea);
      return [
        dt(e.at),
        tb ? new ImageRun({ type: 'jpg', data: tb.data, transformation: { width: 120, height: Math.round(120 * tb.ratio) } }) : (e.snapshot ? 'โหลดภาพไม่ได้' : 'ไม่มีภาพ'),
        `${Number(e.blocks || 0).toLocaleString()}${e.corrected ? ' ✎' : ''}`, fmt(e.area), p === null ? '—' : `${fmt(p, 1)}%`, String(e.peopleDetected || 0),
        e.status ? statusLabel(e.status) : '—',
      ];
    })));
  if (sample.some((e) => e.corrected)) out.push(para('✎ = นาทีที่คนตรวจแก้ Label แล้ว (ผลลัพธ์ตัวเลือกที่ 2) — บล็อก พื้นที่ และจำนวนคนเป็นค่าหลังตรวจแก้', { size: 16, italics: true }));
  out.push(para(`แสดง 1 แถวต่อ ${SAMPLE_MINUTES} นาทีที่มีการบันทึก (รวมรายการล่าสุด) สูงสุด ${MAX_ROWS_PER_TASK} แถว จากทั้งหมด ${hist.length.toLocaleString()} นาที`, { size: 16, italics: true }));
  return out;
}

export async function downloadReportDocx({ tasks: inputTasks, workersMaster, user, title, filename }) {
  const { prod, histories, tasks } = await loadReportData(inputTasks);
  const byId = new Map((prod?.tasks || []).map((p) => [p.taskId, p]));
  const project = prod?.project || {};
  const totalBlocks = tasks.reduce((s, t) => s + (t.blocks || 0), 0);
  const totalArea = tasks.reduce((s, t) => s + (t.area || 0), 0);
  const totalExpected = tasks.reduce((s, t) => s + (t.expectedArea || 0), 0);

  const body = [
    para('CIVIL · AI BRICK CONSTRUCTION MONITORING', { size: 18, bold: true, color: '5A6B85' }),
    new Paragraph({ spacing: { after: 60 }, children: [run(title || 'รายงานความคืบหน้างานก่ออิฐ และผลิตภาพแรงงาน (Productivity)', { size: 36, bold: true, color: BLUE })] }),
    para(`จัดทำเมื่อ ${new Date().toLocaleString('th-TH', { hour12: false, dateStyle: 'long', timeStyle: 'short' })}${user ? ` · โดย ${user}` : ''} · ${tasks.length} งาน`, { size: 18, color: '6E6E73', after: 200 }),

    heading('1. สรุปภาพรวม'),
    table([{ label: 'ตัวชี้วัด', w: 1 }, { label: 'ค่า', w: 1.6 }], [
      ['จำนวนงาน', `${tasks.length} งาน`],
      ['บล็อกที่นับได้รวม', `${totalBlocks.toLocaleString()} ก้อน`],
      ['พื้นที่รวม / เป้าหมาย', `${fmt(totalArea, 1)} / ${fmt(totalExpected, 0)} ตร.ม. (${totalExpected ? Math.round((totalArea / totalExpected) * 100) : 0}%)`],
      ['แรงงานที่มอบหมาย', `${new Set(tasks.flatMap((t) => t.workers || [])).size} คน`],
      ['Productivity จริง (ทั้งโครงการ)', { v: `${fmt(project.pActual)} ตร.ม./คน-วัน`, bold: true }],
      ['P มาตรฐาน (ถ่วงน้ำหนัก)', `${fmt(project.pStd)} ตร.ม./คน-วัน`],
      ['% ความแตกต่าง', { v: fmtPct(project.diffPct), bold: true, color: diffColor(project.diffPct) }],
      ['คน-วันที่ใช้รวม', `${fmt(project.manDays)} คน-วัน`],
    ]),
    heading('รายการงาน', HeadingLevel.HEADING_2),
    table([{ label: '#', w: 0.4 }, { label: 'งาน', w: 2.4 }, 'ประเภทอิฐ', { label: 'บล็อก', num: true }, { label: 'พื้นที่/เป้าหมาย', num: true }, { label: 'คืบหน้า', num: true }, { label: 'เวลาทำงาน', num: true }, 'สถานะ'],
      tasks.map((t, i) => [String(i + 1), { v: `${t.name}${t.resultSource === 'human' ? ' (② HITL)' : ''}`, bold: true }, byId.get(t.id)?.brickType || '—', Number(t.blocks || 0).toLocaleString(),
        `${fmt(t.area, 1)} / ${fmt(t.expectedArea, 0)}`, `${t.expectedArea ? Math.round((t.area / t.expectedArea) * 1000) / 10 : 0}%`,
        fmtDuration(byId.get(t.id)?.runMinutes || 0), statusLabel(t.status)])),

    heading('2. ผลิตภาพแรงงาน (Productivity)'),
    para([run('Productivity (จริง) = Q / (N × T)', { bold: true })], { after: 20 }),
    para('Q = ปริมาณงาน (ตร.ม.) · N = จำนวนแรงงาน (คน) · T = เวลาที่ใช้ (วัน)', { size: 17, color: '555555' }),
    para([run('% ความแตกต่าง = [(P จริง − P มาตรฐาน) / P มาตรฐาน] × 100', { bold: true })], { after: 20 }),
    para('(+) productivity สูงกว่ามาตรฐาน · (−) productivity ต่ำกว่ามาตรฐาน', { size: 17, color: '555555' }),
    para([run('Duration = Q / (P × N)', { bold: true })], { after: 20 }),
    para('Q = ปริมาณงานทั้งหมด · P = ผลิตภาพแรงงาน (ตร.ม./คน-วัน) · N = จำนวนแรงงาน (คน)', { size: 17, color: '555555' }),
    para('ที่มาของค่า: Q = พื้นที่ที่ AI นับได้ล่าสุด · N = แรงงานที่มอบหมาย · T = เวลาทำงานจริงจาก timestamp ของภาพ (ห่างเกิน 2.5 นาทีไม่นับ) ÷ นาทีทำงานต่อวันตามตารางงาน · P มาตรฐานตั้งต่อประเภทอิฐ · Duration ใช้พื้นที่เป้าหมายทั้งหมด', { size: 16, italics: true, color: '6E6E73', after: 120 }),
    table([{ label: 'งาน', w: 2 }, { label: 'เวลาทำงาน', num: true }, { label: 'Q', num: true }, { label: 'N', num: true }, { label: 'T (วัน)', num: true }, { label: 'P จริง', num: true }, { label: 'P มาตรฐาน', num: true }, { label: '% ต่าง', num: true }, { label: 'Duration มาตรฐาน', num: true }, { label: 'Duration คาดการณ์', num: true }],
      (prod?.tasks || []).map((p) => [{ v: p.name, bold: true }, fmtDuration(p.runMinutes), fmt(p.Q), String(p.N), fmt(p.T, 3), { v: fmt(p.pActual), bold: true }, stdLabel(p),
        { v: fmtPct(p.diffPct), bold: true, color: diffColor(p.diffPct) }, fmt(p.durationStd, 1), fmt(p.durationForecast, 1)])),
    heading('การคำนวณทั้งโครงการ (ทีละขั้น)', HeadingLevel.HEADING_2),
    ...stepsDocx(projectSteps(project, prod?.tasks || [])),
  ];

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    body.push(...(await taskSection(t, byId.get(t.id), histories.get(t.id) || [], workersMaster, `3.${i + 1}`)));
  }

  const doc = new Document({
    creator: 'CIVIL', title: title || 'CIVIL Report',
    styles: { default: { document: { run: { font: FONT, size: 19 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 900, bottom: 900, left: MARGIN, right: MARGIN } } },
      footers: {
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run('CIVIL — AI Brick Construction Monitoring · หน้า ', { size: 16, color: '888888' }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '888888' })] })] }),
      },
      children: body,
    }],
  });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `civil-report-${new Date().toISOString().slice(0, 10)}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
