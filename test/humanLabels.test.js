const test = require('node:test');
const assert = require('node:assert');
const { pointInPolygon, parseLabels, correctedCount, reviewStats } = require('../humanLabels');

const ROI = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];

test('pointInPolygon matches the AI centroid rule', () => {
  assert.ok(pointInPolygon(0.5, 0.5, ROI));
  assert.ok(!pointInPolygon(0.05, 0.5, ROI));
  assert.ok(pointInPolygon(0.01, 0.01, [])); // no ROI = whole frame
});

test('parseLabels normalises boxes, drops clicks and bad indexes', () => {
  const { labels } = parseLabels({ added: [{ x1: 0.6, y1: 0.6, x2: 0.4, y2: 0.4 }, { x1: 0.2, y1: 0.2, x2: 0.2001, y2: 0.2 }], removed: [1, 1, 9, -1, 'x'] }, 3);
  assert.deepStrictEqual(labels.added, [{ x1: 0.4, y1: 0.4, x2: 0.6, y2: 0.6, cls: 'brick' }]);
  assert.deepStrictEqual(labels.removed, [1]);
  assert.match(parseLabels({ added: [{ x1: 'a', y1: 0, x2: 1, y2: 1 }] }, 0).error, /พิกัด/);
});

test('correctedCount = AI in ROI − removed in ROI + added in ROI', () => {
  const det = { roi: ROI, detections: [{ in_roi: true }, { in_roi: true }, { in_roi: false }] };
  const labels = { removed: [0, 2], added: [{ x1: 0.4, y1: 0.4, x2: 0.6, y2: 0.6 }, { x1: 0, y1: 0, x2: 0.08, y2: 0.08 }] };
  const c = correctedCount(det, labels);
  assert.deepStrictEqual([c.aiInRoi, c.removedInRoi, c.addedInRoi, c.corrected], [2, 1, 1, 2]);
  // frame saved without boxes: start from its stored AI count
  assert.strictEqual(correctedCount(null, { added: [{ x1: 0.4, y1: 0.4, x2: 0.6, y2: 0.6 }] }, { blocks: 19, roi: ROI }).corrected, 20);
});

test('reviewStats precision / recall', () => {
  const s = reviewStats([
    { correctedBlocks: 9, aiInRoi: 10, removedInRoi: 2, addedInRoi: 1 },
    { correctedBlocks: null, aiInRoi: 50, removedInRoi: 0, addedInRoi: 0 },
  ]);
  assert.strictEqual(s.reviewed, 1);
  assert.strictEqual(s.precision, 0.8);
  assert.strictEqual(s.recall, 8 / 9);
});

test('people are labelled separately from bricks and counted over the whole frame', () => {
  const det = { roi: ROI, detections: [{ in_roi: true }], personDetections: [{ in_roi: true }, { in_roi: true }, { in_roi: false }] };
  const { labels } = parseLabels({ removedPersons: [0, 2, 7], added: [{ x1: 0.3, y1: 0.3, x2: 0.4, y2: 0.5, cls: 'person' }, { x1: 0.5, y1: 0.5, x2: 0.6, y2: 0.6 }] }, 1, 3);
  assert.deepStrictEqual(labels.removedPersons, [0, 2]);
  const c = correctedCount(det, labels);
  // bricks still ROI-only (the person box does not count as a brick); people ignore the ROI
  assert.deepStrictEqual([c.corrected, c.aiPersonCount, c.removedPersonCount, c.addedPersonCount, c.correctedPeople], [2, 3, 2, 1, 2]);
  const outside = correctedCount(det, { added: [{ x1: 0, y1: 0, x2: 0.05, y2: 0.05, cls: 'person' }] });
  assert.strictEqual(outside.correctedPeople, 4); // person drawn outside the ROI still counts
  assert.match(parseLabels({ added: [{ x1: 0, y1: 0, x2: 1, y2: 1, cls: 'dog' }] }, 0).error, /brick หรือ person/);
});

test('a redrawn ROI re-tests the AI bricks by their centres', () => {
  // 100x100 image; boxes centred at (20,20), (50,50), (80,80) — the AI ROI counted only the middle one
  const det = { image_width: 100, image_height: 100, roi: [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]], detections: [
    { x1: 10, y1: 10, x2: 30, y2: 30, in_roi: false }, { x1: 40, y1: 40, x2: 60, y2: 60, in_roi: true }, { x1: 70, y1: 70, x2: 90, y2: 90, in_roi: false }] };
  assert.strictEqual(correctedCount(det, {}).corrected, 1);
  const { labels } = parseLabels({ roi: [[0, 0], [0.7, 0], [0.7, 0.7], [0, 0.7]], removed: [0], added: [{ x1: 0.65, y1: 0.1, x2: 0.69, y2: 0.2 }] }, 3);
  const c = correctedCount(det, labels);
  assert.deepStrictEqual([c.aiInRoi, c.removedInRoi, c.addedInRoi, c.corrected], [2, 1, 1, 2]);
  assert.match(parseLabels({ roi: [[0, 0], [1, 1]] }, 0).error, /3–50/);
  assert.strictEqual(parseLabels({ roi: null }, 0).labels.roi, undefined);
});
