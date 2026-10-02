/**
 * CIVIL — per-camera image orientation, set once per camera.
 *
 * view = { rotate: 0|90|180|270, flipH: bool, flipV: bool,
 *          vertical: -100..100, horizontal: -100..100, straighten: -45..45 (degrees),
 *          zoom: 1..5, cx: 0..1, cy: 0..1 }
 *   order of operations (same in the browser CSS preview, CameraStage.jsx):
 *     1. flips (raw frame) -> rotate clockwise in 90° steps
 *     2. perspective (keystone): vertical > 0 pulls the TOP corners of the source in (fixes walls
 *        that lean together towards the top), < 0 the bottom corners; horizontal > 0 pulls the LEFT
 *        corners in, < 0 the right ones. The inset quad is stretched back to the full frame, so there
 *        are no empty corners.
 *     3. straighten (roll): fine rotation clockwise, scaled up just enough to hide the black corners.
 *     4. zoom = crop a 1/zoom window centred on (cx, cy), scaled back to the frame size.
 *   Every step keeps the frame size, so YOLO and time-lapse see a constant image size.
 * ROI points are normalised to THIS transformed frame, so the same transform must be used for
 * display, detection and stored snapshots.
 */
const { spawn } = require('child_process');

const ROTATIONS = new Set([0, 90, 180, 270]);
const IDENTITY = { rotate: 0, flipH: false, flipV: false, vertical: 0, horizontal: 0, straighten: 0, zoom: 1, cx: 0.5, cy: 0.5 };
const KEYSTONE_MAX = 0.3; // vertical/horizontal = ±100 insets the pulled-in edge's corners by 30% of the frame
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
  const vertical = v.vertical === undefined ? 0 : Number(v.vertical);
  const horizontal = v.horizontal === undefined ? 0 : Number(v.horizontal);
  if (![vertical, horizontal].every((n) => Number.isFinite(n) && n >= -100 && n <= 100)) return { error: 'perspective (vertical/horizontal) ต้องอยู่ระหว่าง -100 ถึง 100' };
  const straighten = v.straighten === undefined ? 0 : Number(v.straighten);
  if (!Number.isFinite(straighten) || straighten < -45 || straighten > 45) return { error: 'straighten ต้องอยู่ระหว่าง -45 ถึง 45 องศา' };
  return {
    view: {
      rotate, flipH: !!v.flipH, flipV: !!v.flipV,
      vertical: Math.round(vertical), horizontal: Math.round(horizontal), straighten: Math.round(straighten * 10) / 10,
      zoom: Math.round(zoom * 100) / 100, cx, cy,
    },
  };
}

const isIdentity = (v) => !v || (!v.rotate && !v.flipH && !v.flipV && !v.vertical && !v.horizontal && !v.straighten && (!v.zoom || v.zoom <= 1));

/**
 * Source-frame corners (as fractions of width/height) that perspective stretches onto the output
 * corners, in ffmpeg's order: top-left, top-right, bottom-left, bottom-right. Shared formula with
 * keystoneQuad() in CameraStage.jsx.
 */
function keystoneQuad(vertical, horizontal) {
  const kv = (clamp(vertical || 0, -100, 100) / 100) * KEYSTONE_MAX;
  const kh = (clamp(horizontal || 0, -100, 100) / 100) * KEYSTONE_MAX;
  const top = Math.max(kv, 0), bottom = Math.max(-kv, 0), left = Math.max(kh, 0), right = Math.max(-kh, 0);
  return [
    [top, left],                 // top-left
    [1 - top, right],            // top-right
    [bottom, 1 - left],          // bottom-left
    [1 - bottom, 1 - right],     // bottom-right
  ];
}

/** { w, h } from a JPEG's SOF header, or null when it can't be read. */
function jpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * ffmpeg -vf chain for a view ('' when nothing to do). `size` (the raw frame's { w, h }) lets the
 * chain end on the exact frame size — straighten's cover-scale otherwise rounds it by a pixel or two.
 */
function filterChain(v, size) {
  if (isIdentity(v)) return '';
  const f = [];
  if (v.flipH) f.push('hflip');
  if (v.flipV) f.push('vflip');
  if (v.rotate === 90) f.push('transpose=1');
  else if (v.rotate === 180) f.push('hflip', 'vflip');
  else if (v.rotate === 270) f.push('transpose=2');
  if (v.vertical || v.horizontal) {
    const q = keystoneQuad(v.vertical, v.horizontal);
    const pts = q.map(([x, y], i) => `x${i}=${x}*W:y${i}=${y}*H`).join(':');
    f.push(`perspective=${pts}:interpolation=cubic`);
  }
  if (v.straighten) {
    const a = (Math.abs(v.straighten) * Math.PI) / 180;
    // smallest scale at which the rotated frame still covers the whole output (no black corners)
    const cover = `(${Math.cos(a).toFixed(6)}+max(iw/ih\\,ih/iw)*${Math.sin(a).toFixed(6)})`;
    f.push(`scale=w=trunc(iw*${cover}/2)*2:h=trunc(ih*${cover}/2)*2:flags=bicubic`);
    f.push(`rotate=a=${((v.straighten * Math.PI) / 180).toFixed(6)}:ow=trunc(iw/${cover}/2)*2:oh=trunc(ih/${cover}/2)*2:bilinear=1`);
  }
  const z = v.zoom || 1;
  if (z > 1) {
    const cx = clamp(v.cx ?? 0.5, 0, 1);
    const cy = clamp(v.cy ?? 0.5, 0, 1);
    // window left/top edge = centre - half window, kept inside the frame (same clamp as the CSS preview)
    f.push(`crop=iw/${z}:ih/${z}:min(max(${cx}*iw-iw/${2 * z}\\,0)\\,iw-iw/${z}):min(max(${cy}*ih-ih/${2 * z}\\,0)\\,ih-ih/${z})`);
    f.push(`scale=iw*${z}:ih*${z}:flags=bicubic`);
  }
  if (v.straighten && size) {
    const swap = v.rotate === 90 || v.rotate === 270;
    f.push(`scale=${swap ? size.h : size.w}:${swap ? size.w : size.h}:flags=bicubic`);
  }
  return f.join(',');
}

/** Apply a view to a JPEG buffer. Identity views return the same buffer untouched. */
function applyView(jpeg, view, timeoutMs = 8000) {
  const vf = filterChain(view, jpegSize(jpeg));
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

module.exports = { IDENTITY, KEYSTONE_MAX, parseView, isIdentity, keystoneQuad, jpegSize, filterChain, applyView };
