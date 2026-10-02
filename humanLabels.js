/**
 * CIVIL — Human-in-the-loop label review (pure, no I/O — unit tested in test/humanLabels.test.js).
 *
 * A reviewer looks at one saved frame, removes AI boxes that are wrong (false positives) and draws
 * boxes around what the AI missed — for two classes: bricks and people. Bricks use the SAME rule as
 * the AI brick count (yolo_service.py): a box counts when its centre lies inside the ROI. People are
 * counted over the whole frame (ROI ignored) — workers stand outside the wall area they build.
 * The reviewer may also redraw the ROI of a frame (labels.roi); the AI bricks are then re-tested
 * against the new ROI with the same centre rule.
 */

// Ray casting, same as yolo_service.py point_in_polygon. poly: [[x,y], ...] normalised 0..1.
function pointInPolygon(x, y, poly) {
  if (!Array.isArray(poly) || poly.length < 3) return true; // no ROI = whole frame counts
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const clamp01 = (n) => Math.min(Math.max(Number(n), 0), 1);

const CLASSES = new Set(['brick', 'person']);
// A polygon of 3..50 normalised [x, y] points, or null (= keep the frame's AI ROI).
function parseRoi(v) {
  if (v === undefined || v === null) return { roi: null };
  if (!Array.isArray(v) || v.length < 3 || v.length > 50) return { error: 'ROI ต้องมี 3–50 จุด' };
  const pts = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => Number.isFinite(Number(n)))) return { error: 'พิกัด ROI ไม่ถูกต้อง' };
    pts.push([+clamp01(p[0]).toFixed(5), +clamp01(p[1]).toFixed(5)]);
  }
  return { roi: pts };
}
const cleanIdx = (list, n) => [...new Set((Array.isArray(list) ? list : []).map(Number))].filter((i) => Number.isInteger(i) && i >= 0 && i < n).sort((a, b) => a - b);

/**
 * Validate the reviewer's input. Returns { labels } or { error }.
 * added: [{x1,y1,x2,y2,cls:'brick'|'person'}] (no cls = brick); removed / removedPersons: indexes into
 * the frame's AI brick / person boxes. roi: optional corrected ROI polygon for this frame.
 */
function parseLabels(input, aiCount, aiPersonCount = 0) {
  const v = input || {};
  const added = Array.isArray(v.added) ? v.added : [];
  if (added.length > 2000) return { error: 'กรอบที่เพิ่มมากเกินไป' };
  const boxes = [];
  for (const b of added) {
    const x1 = clamp01(Math.min(b.x1, b.x2)), x2 = clamp01(Math.max(b.x1, b.x2));
    const y1 = clamp01(Math.min(b.y1, b.y2)), y2 = clamp01(Math.max(b.y1, b.y2));
    if (![x1, x2, y1, y2].every(Number.isFinite)) return { error: 'พิกัดกรอบไม่ถูกต้อง' };
    if (x2 - x1 < 0.002 || y2 - y1 < 0.002) continue; // a click, not a box
    const cls = b.cls === undefined ? 'brick' : b.cls;
    if (!CLASSES.has(cls)) return { error: 'ประเภทกรอบต้องเป็น brick หรือ person' };
    boxes.push({ x1: +x1.toFixed(5), y1: +y1.toFixed(5), x2: +x2.toFixed(5), y2: +y2.toFixed(5), cls });
  }
  const r = parseRoi(v.roi);
  if (r.error) return { error: r.error };
  return {
    labels: {
      added: boxes, removed: cleanIdx(v.removed, aiCount), removedPersons: cleanIdx(v.removedPersons, aiPersonCount),
      note: String(v.note || '').slice(0, 500),
      ...(r.roi ? { roi: r.roi } : {}),
    },
  };
}

const inRoi = (b, roi) => pointInPolygon((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, roi);
const isBrick = (b) => (b.cls || 'brick') === 'brick';

/**
 * Corrected brick and people counts for one frame.
 * @param detections  task_history.detections ({ image_width, image_height, roi, detections: [...] }) or null
 * @param labels      { added, removed, removedPersons, roi? } — roi replaces the frame's AI ROI
 * @param fallback    { blocks, people, roi } — AI counts and ROI when the frame was saved without boxes
 */
function correctedCount(detections, labels, fallback = {}) {
  const ownRoi = labels && Array.isArray(labels.roi) && labels.roi.length >= 3 ? labels.roi : null;
  const roi = ownRoi || ((detections && detections.roi && detections.roi.length >= 3) ? detections.roi : fallback.roi);
  const ai = (detections && detections.detections) || null;
  const removed = new Set((labels && labels.removed) || []);
  // AI boxes are in pixels; with a redrawn ROI, re-test their centres against it
  const iw = (detections && detections.image_width) || 0, ih = (detections && detections.image_height) || 0;
  const aiIn = ownRoi && iw && ih ? (d) => pointInPolygon((d.x1 + d.x2) / 2 / iw, (d.y1 + d.y2) / 2 / ih, ownRoi) : (d) => !!d.in_roi;
  let aiInRoi, removedInRoi = 0;
  if (ai) {
    aiInRoi = ai.filter(aiIn).length;
    ai.forEach((d, i) => { if (removed.has(i) && aiIn(d)) removedInRoi++; });
  } else {
    aiInRoi = Number(fallback.blocks) || 0; // no boxes saved for this frame: start from its AI count
  }
  const added = (labels && labels.added) || [];
  const addedInRoi = added.filter((b) => isBrick(b) && inRoi(b, roi)).length;

  // people: whole frame, ROI ignored
  const persons = (detections && detections.personDetections) || null;
  const removedP = new Set((labels && labels.removedPersons) || []);
  let aiPersonCount, removedPersonCount = 0;
  if (persons) {
    aiPersonCount = persons.length;
    removedPersonCount = persons.filter((d, i) => removedP.has(i)).length;
  } else {
    aiPersonCount = Number(fallback.people) || 0; // no boxes saved: the frame's stored AI count is all there is
  }
  const addedPersonCount = added.filter((b) => !isBrick(b)).length;
  return {
    aiInRoi, removedInRoi, addedInRoi, corrected: Math.max(aiInRoi - removedInRoi + addedInRoi, 0),
    aiPersonCount, removedPersonCount, addedPersonCount, correctedPeople: Math.max(aiPersonCount - removedPersonCount + addedPersonCount, 0),
  };
}

/**
 * Review summary over frames [{ blocks, correctedBlocks, labels }] (reviewed ones only).
 * precision ≈ share of AI boxes the reviewer kept, recall ≈ share of real bricks the AI found.
 */
function reviewStats(frames) {
  const r = frames.filter((f) => f.correctedBlocks !== null && f.correctedBlocks !== undefined);
  const sum = (k) => r.reduce((s, f) => s + (f[k] || 0), 0);
  const pr = (ai, removed, added) => {
    const kept = ai - removed;
    return { aiBoxes: ai, removed, added, precision: ai ? kept / ai : null, recall: kept + added ? kept / (kept + added) : null };
  };
  const bricks = pr(sum('aiInRoi'), sum('removedInRoi'), sum('addedInRoi'));
  return { reviewed: r.length, ...bricks, people: pr(sum('aiPersonCount'), sum('removedPersonCount'), sum('addedPersonCount')) };
}

module.exports = { pointInPolygon, parseRoi, parseLabels, correctedCount, reviewStats };
