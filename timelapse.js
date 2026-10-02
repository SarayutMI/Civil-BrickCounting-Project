/**
 * CIVIL — time-lapse builder (MP4 + GIF) from a task's per-minute snapshots.
 *
 * Frames can have different sizes (the camera view was rotated / zoomed part-way through the task),
 * so every frame is scaled to fit one target size and padded (letterbox) — never stretched.
 * Output is written to a temp name and renamed only on success, so a half-written file is never served.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const FRAME_RE = /^\d{4}-\d{2}-\d{2}T[\d-]+Z\.jpg$/; // names written by appendTaskHistorySnapshot
const FPS = Number(process.env.TIMELAPSE_FPS) || 10;
const MAX_W = 1280;
const GIF_MAX_FRAMES = 300;
const GIF_W = 480;
const GIF_FPS = 8;

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, opts);
    let out = '', err = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('error', (e) => reject(new Error(`รัน ${cmd} ไม่ได้ (ติดตั้ง ffmpeg?): ${e.message}`)));
    proc.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().slice(-400) || `${cmd} exit ${code}`))));
  });
}

async function frameSize(file) {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [w, h] = out.trim().split(',').map(Number);
  return w && h ? { w, h } : null;
}

// most common size among ≤ 15 evenly spaced frames (a cheap stand-in for probing all of them)
async function targetSize(dir, files) {
  const step = Math.max(1, Math.floor(files.length / 15));
  const counts = new Map();
  for (let i = 0; i < files.length; i += step) {
    const s = await frameSize(path.join(dir, files[i])).catch(() => null);
    if (s) counts.set(`${s.w}x${s.h}`, (counts.get(`${s.w}x${s.h}`) || 0) + 1);
  }
  if (counts.size === 0) throw new Error('อ่านขนาดภาพ snapshot ไม่ได้ — ไฟล์ภาพอาจเสียหาย');
  const [w, h] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split('x').map(Number);
  const k = Math.min(1, MAX_W / w);
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  return { w: even(w * k), h: even(h * k) };
}

const fit = (w, h) => `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;

function writeConcat(dir, files, name, perFrameSec) {
  const lines = files.map((f) => `file '${f}'\nduration ${perFrameSec}`);
  lines.push(`file '${files[files.length - 1]}'`); // concat demuxer quirk: last file is repeated without a duration
  fs.writeFileSync(path.join(dir, name), lines.join('\n'), 'utf-8');
}

/**
 * @param skip  file names to leave out (frames the user took out of the count)
 * @returns Promise<{ frames:number, mp4:string, gif:string }> — rejects with a readable Error
 */
async function buildTimelapse(dir, skip = new Set()) {
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => FRAME_RE.test(f) && !skip.has(f)).sort();
  } catch (_) {
    throw new Error('ยังไม่มีภาพ snapshot ของ Task นี้');
  }
  if (files.length === 0) throw new Error('ยังไม่มีภาพ snapshot ของ Task นี้');
  const { w, h } = await targetSize(dir, files);

  // ---- MP4 (all frames) ----
  writeConcat(dir, files, 'concat-mp4.txt', 1 / FPS);
  const mp4Tmp = 'timelapse.tmp.mp4';
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'concat-mp4.txt', '-vf', `${fit(w, h)},format=yuv420p`,
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-movflags', '+faststart', mp4Tmp], { cwd: dir });
  fs.renameSync(path.join(dir, mp4Tmp), path.join(dir, 'timelapse.mp4'));

  // ---- GIF (≤ GIF_MAX_FRAMES evenly sampled, small + palette so it stays a sane size) ----
  const every = Math.max(1, Math.ceil(files.length / GIF_MAX_FRAMES));
  const gifFrames = files.filter((_, i) => i % every === 0);
  writeConcat(dir, gifFrames, 'concat-gif.txt', 1 / GIF_FPS);
  const gifTmp = 'timelapse.tmp.gif';
  const gh = Math.max(2, Math.round((h * GIF_W) / w / 2) * 2);
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'concat-gif.txt',
    '-vf', `${fit(GIF_W, gh)},fps=${GIF_FPS},split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
    '-loop', '0', gifTmp], { cwd: dir });
  fs.renameSync(path.join(dir, gifTmp), path.join(dir, 'timelapse.gif'));

  ['concat-mp4.txt', 'concat-gif.txt'].forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
  return { frames: files.length, mp4: path.join(dir, 'timelapse.mp4'), gif: path.join(dir, 'timelapse.gif') };
}

module.exports = { buildTimelapse, FRAME_RE };
