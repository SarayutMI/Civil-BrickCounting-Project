/* ===================================================================
   Step-by-step working of the productivity numbers — one source for the
   web pages (ProductivitySteps component) and the PDF / Word exports, so
   every place shows the same derivation with the same numbers.
   Input `p` = a task row from GET /api/reports/productivity or
   /api/tasks/:id/productivity (see server.js productivityRow).
=================================================================== */
const num = (v, d = 2) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d }));
const hm = (iso) => new Date(iso).toLocaleTimeString('th-TH', { hour12: false, hour: '2-digit', minute: '2-digit' });
const dayOf = (iso) => new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const span = (a, b) => (b >= a ? b - a : 24 * 60 - a + b);
export const MAX_SEGMENTS_SHOWN = 12;

// P standard as written in the reference table: "20–25" when it is a range, else the single value
export function stdLabel(p) {
  if (!p || p.pStd === null || p.pStd === undefined) return '—';
  return p.pStdMin && p.pStdMax && p.pStdMin !== p.pStdMax ? `${num(p.pStdMin, 0)}–${num(p.pStdMax, 0)}` : num(p.pStd);
}
// where the actual P sits against the standard range
export const BAND_TEXT = { below: 'ต่ำกว่าช่วงมาตรฐาน', within: 'อยู่ในช่วงมาตรฐาน', above: 'สูงกว่าช่วงมาตรฐาน' };

// How many working minutes one scheduled day has — the same rule as productivity.js on the server.
function dayMinutesWorking(schedule, dayMinutes) {
  const s = toMin(schedule?.start), e = toMin(schedule?.end);
  if (s === null || e === null || s === e) return [`ไม่ได้ตั้งตารางเวลางาน → ใช้ 8 ชม. = ${dayMinutes} นาที/วัน`];
  const bs = toMin(schedule.breakStart), be = toMin(schedule.breakEnd);
  const work = span(s, e);
  if (bs === null || be === null || bs === be) return [`(${schedule.end} − ${schedule.start}) = ${work} นาที (ไม่มีเวลาพัก) = ${dayMinutes} นาที/วัน`];
  return [`(${schedule.end} − ${schedule.start}) − (${schedule.breakEnd} − ${schedule.breakStart}) = ${work} − ${span(bs, be)} = ${dayMinutes} นาที/วัน`];
}

/**
 * @param p            productivity row
 * @param workerNames  display names of the assigned workers (optional)
 * @returns [{ no, title, formula, lines: [string], result, note }]
 */
export function productivitySteps(p, workerNames = []) {
  if (!p) return [];
  const steps = [];
  const add = (title, formula, lines, result, note) => steps.push({ no: steps.length + 1, title, formula, lines, result, note });

  // 1. Q
  const qLines = [];
  const qFromBlocks = p.blocksPerSqm ? (p.blocks || 0) * p.blocksPerSqm : null;
  if (qFromBlocks !== null) qLines.push(`${Number(p.blocks || 0).toLocaleString()} บล็อก × ${p.blocksPerSqm} ตร.ม./บล็อก = ${num(qFromBlocks, 3)} ตร.ม.`);
  if (p.humanCorrected) {
    qLines.push(`ใช้ผลตรวจแก้โดยคน (Human-in-the-loop) ของภาพสุดท้าย: ${p.humanCorrected.blocks.toLocaleString()} บล็อก (AI นับได้ ${num(p.aiQ, 3)} ตร.ม.)`);
  } else qLines.push(`ค่าที่ใช้ = พื้นที่ล่าสุดที่ AI คำนวณและบันทึกไว้ = ${num(p.Q, 3)} ตร.ม.`);
  if (!p.humanCorrected && qFromBlocks !== null && Math.abs(qFromBlocks - p.Q) > Math.max(0.01, p.Q * 0.01)) {
    qLines.push('⚠ สองค่านี้ไม่ตรงกัน — น่าจะมีการแก้ค่า ตร.ม./บล็อก หลังการตรวจจับครั้งล่าสุด พื้นที่จะอัปเดตเองเมื่องานกลับมาตรวจจับ');
  }
  add('ปริมาณงาน (Q)', p.humanCorrected ? 'Q = จำนวนบล็อกหลังตรวจแก้ × พื้นที่ต่อ 1 บล็อก' : 'Q = จำนวนบล็อกที่ AI นับได้ × พื้นที่ต่อ 1 บล็อก', qLines, `Q = ${num(p.Q, 3)} ตร.ม.`,
    p.Qtotal ? `เป้าหมายทั้งหมด ${num(p.Qtotal, 0)} ตร.ม. → ทำไปแล้ว ${num((p.Q / p.Qtotal) * 100, 1)}%` : null);

  // 2. N
  add('จำนวนแรงงาน (N)', 'N = จำนวนแรงงานที่มอบหมายเข้างาน',
    [workerNames.length ? `${workerNames.join(', ')}` : (p.N ? `${p.N} คน (มอบหมายไว้ในงาน)` : 'ยังไม่ได้มอบหมายแรงงาน')],
    `N = ${p.N} คน`, p.N ? null : 'N = 0 → คำนวณ P และ Duration ไม่ได้ จนกว่าจะมอบหมายแรงงาน');

  // 3. work minutes from image timestamps
  const segs = p.segments || [];
  const segLines = segs.slice(0, MAX_SEGMENTS_SHOWN).map((s, i) =>
    `ช่วงที่ ${i + 1}: ${dayOf(s.start)} ${hm(s.start)}–${hm(s.end)} = ${num(s.minutes, 1)} นาที (${s.images.toLocaleString()} ภาพ)`);
  if (segs.length > MAX_SEGMENTS_SHOWN) {
    const rest = segs.slice(MAX_SEGMENTS_SHOWN);
    segLines.push(`… และอีก ${rest.length} ช่วง รวม ${num(rest.reduce((a, s) => a + s.minutes, 0), 1)} นาที`);
  }
  if (!segs.length) segLines.push('ยังไม่มีภาพจากกล้องที่บันทึกขณะงานกำลังดำเนินการ');
  else segLines.push(`รวม ${segs.length} ช่วง = ${num(p.imageMinutes ?? p.runMinutes, 1)} นาที`);
  if (p.timeAdjustMinutes) {
    segLines.push(`ปรับเวลาทำงานด้วยมือ ${p.timeAdjustMinutes > 0 ? '+' : '−'}${num(Math.abs(p.timeAdjustMinutes), 1)} นาที (แก้ย้อนหลังจากหน้า Report)`);
    segLines.push(`${num(p.imageMinutes, 1)} ${p.timeAdjustMinutes > 0 ? '+' : '−'} ${num(Math.abs(p.timeAdjustMinutes), 1)} = ${num(p.runMinutes, 1)} นาที`);
  }
  if (segs.length || p.timeAdjustMinutes) segLines.push(`= ${Math.floor(p.runMinutes / 60)} ชม. ${Math.round(p.runMinutes % 60)} นาที`);
  add('เวลาทำงานจริง', 'เวลาทำงาน = ผลรวมช่วงเวลาที่มีภาพต่อเนื่อง (จาก timestamp ของภาพที่กล้องส่งมา)', segLines,
    `เวลาทำงานจริง = ${num(p.runMinutes, 1)} นาที`,
    `ภาพที่ห่างกันเกิน ${Math.round((p.gapSeconds || 150) / 60 * 10) / 10} นาที ถือว่าพัก / นอกเวลา / ขาดภาพ — ไม่นับช่วงนั้น`);

  // 4. minutes per working day
  add('นาทีทำงานต่อ 1 วัน', 'นาที/วัน = (เลิกงาน − เริ่มงาน) − (จบพัก − เริ่มพัก)', dayMinutesWorking(p.schedule, p.dayMinutes),
    `1 วันทำงาน = ${p.dayMinutes} นาที`, null);

  // 5. T
  add('เวลาที่ใช้ (T)', 'T = เวลาทำงานจริง ÷ นาทีทำงานต่อวัน', [`${num(p.runMinutes, 1)} ÷ ${p.dayMinutes} = ${num(p.T, 3)} วัน`], `T = ${num(p.T, 3)} วัน`, null);

  // 6. man-days
  add('คน-วันที่ใช้', 'คน-วัน = N × T', [`${p.N} × ${num(p.T, 3)} = ${num(p.manDays, 3)} คน-วัน`], `${num(p.manDays, 3)} คน-วัน`, null);

  // 7. P
  const canP = p.pActual !== null && p.pActual !== undefined;
  add('Productivity จริง (P)', 'P = Q / (N × T)',
    canP ? [`${num(p.Q, 3)} ÷ (${p.N} × ${num(p.T, 3)})`, `= ${num(p.Q, 3)} ÷ ${num(p.manDays, 3)}`, `= ${num(p.pActual, 3)} ตร.ม./คน-วัน`]
      : [p.N ? 'T = 0 (ยังไม่มีเวลาทำงาน) → หารด้วย 0 ไม่ได้' : 'N = 0 → หารด้วย 0 ไม่ได้'],
    canP ? `P = ${num(p.pActual)} ตร.ม./คน-วัน` : 'P = — (คำนวณไม่ได้)',
    canP ? 'หมายถึง แรงงาน 1 คน ทำงานเต็ม 1 วัน ได้พื้นที่เฉลี่ยเท่านี้' : null);

  // 8. % diff
  const hasStd = p.pStd !== null && p.pStd !== undefined;
  add('% ความแตกต่างจากมาตรฐาน', '% ต่าง = [(P จริง − P มาตรฐาน) / P มาตรฐาน] × 100',
    !hasStd ? ['ยังไม่ได้ตั้ง P มาตรฐาน (ตั้งของงานนี้ได้ที่ "ข้อมูลที่ใช้คำนวณ" หรือของประเภทอิฐที่ Settings › Brick Types)']
      : !canP ? ['ยังไม่มี P จริง']
        : [...(p.pStdMin && p.pStdMax && p.pStdMin !== p.pStdMax
            ? [`P มาตรฐานของประเภทอิฐ = ${stdLabel(p)} ตร.ม./คน-วัน → ใช้ค่ากลาง (${num(p.pStdMin, 0)} + ${num(p.pStdMax, 0)}) ÷ 2 = ${num(p.pStd, 2)}`,
              `P จริง ${num(p.pActual, 2)} ${BAND_TEXT[p.stdBand] || ''} (${stdLabel(p)})`]
            : [`P มาตรฐาน = ${num(p.pStd, 3)} ตร.ม./คน-วัน (${p.pStdSource === 'task' ? 'ตั้งเฉพาะงานนี้' : 'ของประเภทอิฐ'})`]), `[(${num(p.pActual, 3)} − ${num(p.pStd, 3)}) ÷ ${num(p.pStd, 3)}] × 100`, `= [${num(p.pActual - p.pStd, 3)} ÷ ${num(p.pStd, 3)}] × 100`, `= ${p.diffPct > 0 ? '+' : ''}${num(p.diffPct, 1)}%`],
    p.diffPct === null || p.diffPct === undefined ? '% ต่าง = —' : `${p.diffPct > 0 ? '+' : ''}${num(p.diffPct, 1)}% (${p.diffPct >= 0 ? 'สูงกว่ามาตรฐาน' : 'ต่ำกว่ามาตรฐาน'})`,
    '(+) productivity สูงกว่ามาตรฐาน · (−) productivity ต่ำกว่ามาตรฐาน — เทียบกับค่ากลางของช่วงมาตรฐาน');

  // 9. durations
  const durLines = [];
  if (p.Qtotal && hasStd && p.N) durLines.push(`ตามมาตรฐาน: ${num(p.Qtotal, 0)} ÷ (${num(p.pStd, 3)} × ${p.N}) = ${num(p.durationStd, 2)} วัน`);
  else durLines.push('ตามมาตรฐาน: — (ต้องมีพื้นที่เป้าหมาย, P มาตรฐาน และ N)');
  if (p.Qtotal && canP && p.N) {
    durLines.push(`คาดการณ์ตาม P จริง: ${num(p.Qtotal, 0)} ÷ (${num(p.pActual, 3)} × ${p.N}) = ${num(p.durationForecast, 2)} วัน`);
    durLines.push(`งานที่เหลือ: (${num(p.Qtotal, 0)} − ${num(p.Q, 3)}) ÷ (${num(p.pActual, 3)} × ${p.N}) = ${num(p.remainingDays, 2)} วัน`);
  } else durLines.push('คาดการณ์ตาม P จริง: — (ต้องมี P จริงและ N)');
  add('ระยะเวลางาน (Duration)', 'Duration = Q ทั้งหมด / (P × N)', durLines,
    p.durationForecast !== null && p.durationForecast !== undefined ? `คาดว่าใช้ทั้งหมด ${num(p.durationForecast, 1)} วัน · เหลืออีก ${num(p.remainingDays, 1)} วัน` : 'Duration = —',
    'หน่วยเป็น "วันทำงาน" ตามตารางเวลางานของงานนี้');
  return steps;
}

// Project-level working: total area over total man-days, and the man-day-weighted standard.
export function projectSteps(project, rows) {
  const timed = rows.filter((r) => r.manDays > 0 && !r.copyOf); // งานสำเนา (Duplicate) ไม่นับรวม — ตรงกับ server
  const lines = timed.map((r) => `${r.name}: Q ${num(r.Q, 3)} ตร.ม. · N×T = ${r.N} × ${num(r.T, 3)} = ${num(r.manDays, 3)} คน-วัน${r.pStd ? ` · P มาตรฐาน ${stdLabel(r)}${r.pStdMin && r.pStdMax !== r.pStdMin ? ` (ค่ากลาง ${num(r.pStd)})` : ''}` : ''}`);
  const withStd = timed.filter((r) => r.pStd);
  return [
    { no: 1, title: 'รวมปริมาณงานและคน-วัน (เฉพาะงานที่มีเวลาทำงานบันทึก)', formula: 'ΣQ และ Σ(N × T)', lines: lines.length ? lines : ['ยังไม่มีงานที่มีเวลาทำงานบันทึก'],
      result: `ΣQ = ${num(project.Q, 3)} ตร.ม. · Σ คน-วัน = ${num(project.manDays, 3)}`, note: 'งานที่ยังไม่มีเวลาทำงาน (T = 0) หรือไม่มีแรงงาน และงานสำเนา (Duplicate) ไม่นำมารวม' },
    { no: 2, title: 'Productivity จริงทั้งโครงการ', formula: 'P โครงการ = ΣQ / Σ(N × T)',
      lines: project.pActual !== null && project.pActual !== undefined ? [`${num(project.Q, 3)} ÷ ${num(project.manDays, 3)} = ${num(project.pActual, 3)} ตร.ม./คน-วัน`] : ['คำนวณไม่ได้'],
      result: `P โครงการ = ${num(project.pActual)} ตร.ม./คน-วัน`, note: 'ไม่ใช่ค่าเฉลี่ยของ P แต่ละงาน — งานที่ใช้คน-วันมากมีน้ำหนักมากกว่า' },
    { no: 3, title: 'P มาตรฐานถ่วงน้ำหนัก', formula: 'P มาตรฐาน = Σ(P มาตรฐาน × คน-วัน) / Σ คน-วัน',
      lines: withStd.length ? [`(${withStd.map((r) => `${num(r.pStd)} × ${num(r.manDays, 3)}`).join(' + ')}) ÷ ${num(withStd.reduce((a, r) => a + r.manDays, 0), 3)} = ${num(project.pStd, 3)}`] : ['ยังไม่มีงานที่ตั้ง P มาตรฐาน'],
      result: `P มาตรฐาน = ${num(project.pStd)} ตร.ม./คน-วัน`, note: null },
    { no: 4, title: '% ความแตกต่างทั้งโครงการ', formula: '[(P โครงการ − P มาตรฐาน) / P มาตรฐาน] × 100',
      lines: project.diffPct !== null && project.diffPct !== undefined ? [`[(${num(project.pActual, 3)} − ${num(project.pStd, 3)}) ÷ ${num(project.pStd, 3)}] × 100 = ${project.diffPct > 0 ? '+' : ''}${num(project.diffPct, 1)}%`] : ['ยังเทียบไม่ได้'],
      result: project.diffPct !== null && project.diffPct !== undefined ? `${project.diffPct > 0 ? '+' : ''}${num(project.diffPct, 1)}% (${project.diffPct >= 0 ? 'สูงกว่ามาตรฐาน' : 'ต่ำกว่ามาตรฐาน'})` : '—', note: null },
  ];
}
