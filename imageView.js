/**
 * CIVIL — per-camera image orientation (rotate / flip / zoom), set once per camera.
 *
 * view = { rotate: 0|90|180|270, flipH: bool, flipV: bool, zoom: 1..5, cx: 0..1, cy: 0..1 }
 *   order of operations (same in the browser CSS preview): flips (raw frame) -> rotate clockwise
 *   -> zoom = crop a 1/zoom window centred on (cx, cy) of the rotated frame, scaled back to the
 *   rotated frame's size (so image dimensions stay constant for YOLO and for time-lapse).
 * ROI points are normalised to THIS transformed frame, so the same transform must be used for
 * display, detection and stored snapshots.
 */
const { spawn } = require('child_process');

const ROTATIONS = new Set([0, 90, 180, 270]);
const IDENTITY = { rotate: 0, flipH: false, flipV: false, zoom: 1, cx: 0.5, cy: 0.5 };
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

/** Validate + normalise user input. Returns { view } or { error }. */
function parseView(input) {
  const v = input || {};
  const rotate = v.rotate === undefined ? 0 : Number(v.rotate);
  if (!ROTATIONS.has(rotate)) return { error: 'rotate ต้องเป็น 0, 90, 180 หรือ 270' };
  const zoom = v.zoom === undefined ? 1 : Number(v.zoom);
  if (!Number.isFinite(zoom) || zoom < 1 || zoom > 5) return { error: 'zoom ต้องอยู่ระหว่าง 1 ถึง 5' };
  const cx = v.cx === undefined ? 0.5 : Number(v.cx);
  const cy = v.cy === undefined ? 0.5 : Number(v.cy);
  if (![cx, cy].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return { error: 'ตำแหน่งกึ่งกลางการซูมต้องอยู่ระหว่าง 0 ถึง 1' };
  return { view: { rotate, flipH: !!v.flipH, flipV: !!v.flipV, zoom: Math.round(zoom * 100) / 100, cx, cy } };
}

const isIdentity = (v) => !v || (!v.rotate && !v.flipH && !v.flipV && (!v.zoom || v.zoom <= 1));

/** ffmpeg -vf chain for a view ('' when nothing to do). */
function filterChain(v) {
  if (isIdentity(v)) return '';
  const f = [];
  if (v.flipH) f.push('hflip');
  if (v.flipV) f.push('vflip');
  if (v.rotate === 90) f.push('transpose=1');
  else if (v.rotate === 180) f.push('hflip', 'vflip');
  else if (v.rotate === 270) f.push('transpose=2');
  const z = v.zoom || 1;
  if (z > 1) {
    const cx = clamp(v.cx ?? 0.5, 0, 1);
    const cy = clamp(v.cy ?? 0.5, 0, 1);
    // window left/top edge = centre - half window, kept inside the frame (same clamp as the CSS preview)
    f.push(`crop=iw/${z}:ih/${z}:min(max(${cx}*iw-iw/${2 * z}\\,0)\\,iw-iw/${z}):min(max(${cy}*ih-ih/${2 * z}\\,0)\\,ih-ih/${z})`);
    f.push(`scale=iw*${z}:ih*${z}:flags=bicubic`);
  }
  return f.join(',');
}

/** Apply a view to a JPEG buffer. Identity views return the same buffer untouched. */
function applyView(jpeg, view, timeoutMs = 8000) {
  const vf = filterChain(view);
  if (!vf) return Promise.resolve(jpeg);
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-i', 'pipe:0', '-vf', vf, '-frames:v', '1', '-q:v', '2', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1']);
    const out = [];
    let err = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('ffmpeg หมดเวลาตอนปรับมุมภาพ')); }, timeoutMs);
    proc.stdout.on('data', (d) => out.push(d));
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('error', (e) => { clearTimeout(timer); reject(new Error(`รัน ffmpeg ไม่ได้: ${e.message}`)); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(out);
      if (code === 0 && buf.length > 0) resolve(buf);
      else reject(new Error(err.trim().slice(-300) || `ffmpeg exit ${code}`));
    });
    proc.stdin.on('error', () => {}); // ffmpeg may close stdin early on bad input; close handler reports it
    proc.stdin.end(jpeg);
  });
}

module.exports = { IDENTITY, parseView, isIdentity, filterChain, applyView };
