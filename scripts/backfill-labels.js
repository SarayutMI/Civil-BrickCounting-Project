/**
 * One-off backfill: run the AI again on saved history frames that have an image but no AI boxes
 * ("ไม่มีข้อมูล label ของนาทีนี้" — saved before boxes were stored, or detection had not finished),
 * and store the boxes in task_history.detections.
 *
 * Only the `detections` column is written, and only where it is still NULL — so it is safe to re-run.
 * The frame's saved counts (blocks / area / people) are NOT changed: they stay what was recorded at
 * the time, so reports and productivity do not move.
 *
 * Uses each task's CURRENT ROI, confidence and brick type (the history row does not keep the ROI it
 * was taken with). Snapshots on disk are already rotated/cropped by the camera view, so they go to
 * YOLO as-is — the same image the live pipeline saw.
 *
 *   node scripts/backfill-labels.js            # dry run: count what would be filled
 *   node scripts/backfill-labels.js --apply    # run YOLO and write the boxes
 *   node scripts/backfill-labels.js --apply --task <id>
 */
const fs = require('fs');
const path = require('path');

// Same DB / YOLO settings as the running server when launched next to its pm2 ecosystem file.
try {
  const app = require('../ecosystem.config.js').apps.find((a) => a.name === 'civil-server');
  for (const [k, v] of Object.entries((app && app.env) || {})) if (process.env[k] === undefined) process.env[k] = String(v);
} catch (_) { /* local dev: use the shell's env */ }

const { pool } = require('../db');

const APPLY = process.argv.includes('--apply');
const ONLY_TASK = process.argv.includes('--task') ? process.argv[process.argv.indexOf('--task') + 1] : null;
const YOLO = process.env.YOLO_SERVICE_URL || 'http://127.0.0.1:8000';
const PERSON_CONF = Number(process.env.PERSON_DETECT_CONFIDENCE) || 0.5;
const ROOT = path.join(__dirname, '..');

// same shape as compactLabel() in server.js
const round1 = (n) => Math.round(n * 10) / 10;
const box = (d) => ({ x1: round1(d.x1), y1: round1(d.y1), x2: round1(d.x2), y2: round1(d.y2), conf: Math.round(d.conf * 1000) / 1000, in_roi: !!d.in_roi });

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${url} HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.json();
}

async function main() {
  const { rows: tasks } = await pool.query(
    `SELECT t.id, t.name, t.roi, t.confidence, b.blocks_per_sqm, b.class_id
     FROM tasks t LEFT JOIN brick_types b ON b.id = t.brick_type ORDER BY t.name`
  );
  let total = 0, done = 0, failed = 0, missingFile = 0;
  for (const t of tasks) {
    if (ONLY_TASK && t.id !== ONLY_TASK) continue;
    const { rows } = await pool.query(
      'SELECT id, snapshot FROM task_history WHERE task_id = $1 AND snapshot IS NOT NULL AND detections IS NULL ORDER BY at',
      [t.id]
    );
    if (!rows.length) continue;
    const roi = Array.isArray(t.roi) ? t.roi : [];
    const skip = roi.length < 3 ? 'ไม่มี ROI' : t.blocks_per_sqm == null ? 'ไม่พบประเภทอิฐ' : null;
    console.log(`${t.name}: ${rows.length} ภาพไม่มี label${skip ? ` — ข้าม (${skip})` : ''}`);
    if (skip) continue;
    total += rows.length;
    if (!APPLY) continue;
    let n = 0;
    for (const r of rows) {
      const file = path.join(ROOT, r.snapshot.replace(/^\/+/, ''));
      if (!file.startsWith(path.join(ROOT, 'snapshots') + path.sep) || !fs.existsSync(file)) { missingFile++; continue; }
      try {
        const image_base64 = fs.readFileSync(file).toString('base64');
        const result = await post(`${YOLO}/detect`, {
          image_base64, roi, blocks_per_sqm: t.blocks_per_sqm, confidence: (Number(t.confidence) || 75) / 100, class_id: t.class_id ?? null,
        });
        let person = null;
        try { person = await post(`${YOLO}/detect-person`, { image_base64, roi, confidence: PERSON_CONF }); } catch (_) { /* bricks still useful */ }
        const label = {
          image_width: result.image_width, image_height: result.image_height, roi,
          detections: (result.detections || []).map(box),
          personDetections: person ? (person.detections || []).map(box) : [],
          backfilled: true, // added later by this script, not by the live pipeline
        };
        await pool.query('UPDATE task_history SET detections = $1 WHERE id = $2 AND detections IS NULL', [JSON.stringify(label), r.id]);
        done++; n++;
        if (n % 25 === 0) console.log(`  ${n}/${rows.length}`);
      } catch (err) {
        failed++;
        console.error(`  row ${r.id}: ${err.message}`);
      }
    }
    console.log(`  เสร็จ ${n}/${rows.length}`);
  }
  console.log(APPLY
    ? `รวม: เติม label ${done} ภาพ · ล้มเหลว ${failed} · ไม่พบไฟล์ภาพ ${missingFile}`
    : `DRY RUN — จะเติม label ${total} ภาพ (สั่ง --apply เพื่อรันจริง)`);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
