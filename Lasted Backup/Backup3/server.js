/**
 * CIVIL — AI Brick Construction Monitoring
 * Full backend server
 *
 * ทำไมต้องมี backend:
 * เบราว์เซอร์เชื่อมต่อ RTSP โดยตรงไม่ได้ (ไม่ใช่โปรโตคอลของเว็บ) จึงให้ backend นี้
 * เป็นตัวกลางที่คุยกับกล้อง RTSP จริงแทน แล้วส่งผลลัพธ์/ภาพกลับมาที่หน้าเว็บผ่าน HTTP
 *
 * FEATURES:
 * 1) CRUD กล้อง (เพิ่ม/แก้ไข/ลบ/เลือก) — เก็บลงไฟล์ cameras.json (persist ข้ามการรีสตาร์ท)
 * 2) ทดสอบการเชื่อมต่อ RTSP จริงด้วย ffprobe (เหมือนเดิม)
 * 3) ดึงภาพนิ่ง (snapshot) จากกล้องจริงด้วย ffmpeg
 * 4) สตรีมภาพสด (MJPEG) จากกล้องจริงด้วย ffmpeg -f mpjpeg แล้วฝังใน <img> ได้ตรง ๆ
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'cameras.json');

app.use(express.json());
app.use(express.static(path.join(__dirname))); // serve index.html, app.js, style.css

/* =========================================================
   PERSISTENCE — cameras.json
========================================================= */
function loadCameras() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}
function saveCameras(camerasList) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(camerasList, null, 2), 'utf-8');
}
let cameras = loadCameras();

/* =========================================================
   HELPERS
========================================================= */
function isLikelyRtspUrl(url) {
  return typeof url === 'string' && /^rtsps?:\/\/\S+$/i.test(url.trim());
}
function findCamera(id) {
  return cameras.find((c) => c.id === id);
}

/* =========================================================
   CAMERA CRUD API
========================================================= */

app.get('/api/cameras', (req, res) => {
  res.json(cameras);
});

app.get('/api/cameras/:id', (req, res) => {
  const cam = findCamera(req.params.id);
  if (!cam) return res.status(404).json({ success: false, message: 'ไม่พบกล้องนี้' });
  res.json(cam);
});

app.post('/api/cameras', (req, res) => {
  const { name, url, zone } = req.body || {};
  if (!name || !url) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อและ URL ของกล้อง' });
  }
  if (!isLikelyRtspUrl(url)) {
    return res.status(400).json({ success: false, message: 'URL ต้องขึ้นต้นด้วย rtsp:// หรือ rtsps://' });
  }
  const cam = {
    id: crypto.randomUUID(),
    name: name.trim(),
    url: url.trim(),
    zone: (zone || '').trim(),
    status: 'unknown',
    createdAt: new Date().toISOString(),
  };
  cameras.push(cam);
  saveCameras(cameras);
  res.status(201).json(cam);
});

app.put('/api/cameras/:id', (req, res) => {
  const cam = findCamera(req.params.id);
  if (!cam) return res.status(404).json({ success: false, message: 'ไม่พบกล้องนี้' });
  const { name, url, zone } = req.body || {};
  if (url && !isLikelyRtspUrl(url)) {
    return res.status(400).json({ success: false, message: 'URL ต้องขึ้นต้นด้วย rtsp:// หรือ rtsps://' });
  }
  if (name) cam.name = name.trim();
  if (url) cam.url = url.trim();
  if (zone !== undefined) cam.zone = zone.trim();
  saveCameras(cameras);
  res.json(cam);
});

app.delete('/api/cameras/:id', (req, res) => {
  const idx = cameras.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'ไม่พบกล้องนี้' });
  cameras.splice(idx, 1);
  saveCameras(cameras);
  res.json({ success: true });
});

/* =========================================================
   RTSP CONNECTION TEST (ffprobe)
========================================================= */
function probeRtsp(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const args = [
      '-rtsp_transport', 'tcp',
      '-timeout', String(timeoutMs * 1000),
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,avg_frame_rate',
      '-of', 'json',
      url,
    ];
    const proc = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';
    let finished = false;

    const killTimer = setTimeout(() => {
      if (!finished) {
        finished = true;
        proc.kill('SIGKILL');
        resolve({ success: false, message: 'หมดเวลาการเชื่อมต่อ (timeout)', raw: stderr.trim() });
      }
    }, timeoutMs + 2000);

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(killTimer);
      resolve({ success: false, message: 'ไม่สามารถรัน ffprobe บนเซิร์ฟเวอร์ได้ (โปรดติดตั้ง ffmpeg)', raw: err.message });
    });
    proc.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(killTimer);
      if (code === 0) {
        let streamInfo = null;
        try {
          const parsed = JSON.parse(stdout);
          streamInfo = (parsed.streams && parsed.streams[0]) || null;
        } catch (_) {}
        resolve({ success: true, message: 'เชื่อมต่อกล้องสำเร็จ', stream: streamInfo });
      } else {
        resolve({
          success: false,
          message: 'เชื่อมต่อกล้องไม่สำเร็จ — ตรวจสอบ URL / username-password / network',
          raw: stderr.trim().slice(-800),
        });
      }
    });
  });
}

app.post('/api/test-rtsp', async (req, res) => {
  const { url, timeoutMs } = req.body || {};
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ success: false, message: 'กรุณากรอก Camera URL' });
  }
  if (!isLikelyRtspUrl(url)) {
    return res.status(400).json({ success: false, message: 'รูปแบบ URL ไม่ถูกต้อง ต้องขึ้นต้นด้วย rtsp:// หรือ rtsps://' });
  }
  const effectiveTimeout = Math.min(Math.max(Number(timeoutMs) || 8000, 2000), 20000);
  try {
    const result = await probeRtsp(url.trim(), effectiveTimeout);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดที่ไม่คาดคิด', raw: err.message });
  }
});

app.post('/api/cameras/:id/test', async (req, res) => {
  const cam = findCamera(req.params.id);
  if (!cam) return res.status(404).json({ success: false, message: 'ไม่พบกล้องนี้' });
  const result = await probeRtsp(cam.url, 8000);
  cam.status = result.success ? 'live' : 'disconnect';
  cam.lastTestedAt = new Date().toISOString();
  saveCameras(cameras);
  res.json({ ...result, camera: cam });
});

/* =========================================================
   SNAPSHOT — single JPEG frame from RTSP
========================================================= */
function captureSnapshot(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const args = [
      '-rtsp_transport', 'tcp',
      '-y',
      '-timeout', String(timeoutMs * 1000),
      '-i', url,
      '-frames:v', '1',
      '-update', '1',
      '-q:v', '4',
      '-f', 'image2',
      'pipe:1',
    ];
    const proc = spawn('ffmpeg', args);
    const chunks = [];
    let stderr = '';
    let finished = false;

    const killTimer = setTimeout(() => {
      if (!finished) {
        finished = true;
        proc.kill('SIGKILL');
        reject(new Error('หมดเวลาในการดึงภาพ (timeout)'));
      }
    }, timeoutMs + 3000);

    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(killTimer);
      reject(err);
    });
    proc.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(killTimer);
      const buf = Buffer.concat(chunks);
      if (code === 0 && buf.length > 0) {
        resolve(buf);
      } else {
        reject(new Error(stderr.trim().slice(-500) || 'ดึงภาพไม่สำเร็จ'));
      }
    });
  });
}

app.get('/api/cameras/:id/snapshot', async (req, res) => {
  const cam = findCamera(req.params.id);
  if (!cam) return res.status(404).json({ success: false, message: 'ไม่พบกล้องนี้' });
  try {
    const jpeg = await captureSnapshot(cam.url, 8000);
    cam.status = 'live';
    saveCameras(cameras);
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-store');
    res.send(jpeg);
  } catch (err) {
    cam.status = 'disconnect';
    saveCameras(cameras);
    res.status(502).json({ success: false, message: 'ดึงภาพจากกล้องไม่สำเร็จ', raw: err.message });
  }
});

// Ad-hoc snapshot from a raw URL (not saved) — ใช้ตอนดูภาพก่อนกดบันทึกกล้องใหม่
app.get('/api/snapshot', async (req, res) => {
  const url = req.query.url;
  if (!url || !isLikelyRtspUrl(url)) {
    return res.status(400).json({ success: false, message: 'ต้องระบุ url ที่ถูกต้อง (rtsp://...)' });
  }
  try {
    const jpeg = await captureSnapshot(url, 8000);
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-store');
    res.send(jpeg);
  } catch (err) {
    res.status(502).json({ success: false, message: 'ดึงภาพจากกล้องไม่สำเร็จ', raw: err.message });
  }
});

/* =========================================================
   LIVE STREAM — MJPEG (multipart/x-mixed-replace)
   ใช้ตรงกับ <img src="/api/cameras/:id/stream"> ได้เลย เห็นภาพสดจริง
========================================================= */
const activeStreamCleanups = new Set();

function startMjpegStream(url, res, { fps = 6, width = 960 } = {}) {
  const args = [
    '-rtsp_transport', 'tcp',
    '-i', url,
    '-an',
    '-f', 'mpjpeg',
    '-q:v', '6',
    '-r', String(fps),
    '-vf', `scale=${width}:-2`,
    'pipe:1',
  ];
  const proc = spawn('ffmpeg', args);

  res.set('Content-Type', 'multipart/x-mixed-replace;boundary=ffmpeg');
  res.set('Cache-Control', 'no-store');

  proc.stdout.pipe(res);

  let stderr = '';
  proc.stderr.on('data', (d) => {
    stderr += d.toString();
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });

  const cleanup = () => {
    activeStreamCleanups.delete(cleanup);
    if (!proc.killed) proc.kill('SIGKILL');
  };
  activeStreamCleanups.add(cleanup);

  proc.on('close', () => {
    if (!res.headersSent) {
      res.status(502).json({ success: false, message: 'ไม่สามารถเปิดสตรีมได้', raw: stderr.trim().slice(-500) });
    } else {
      res.end();
    }
  });
  proc.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({ success: false, message: 'ไม่สามารถรัน ffmpeg ได้', raw: err.message });
    } else {
      res.end();
    }
  });

  // ปิด ffmpeg ทันทีเมื่อฝั่ง client ตัดการเชื่อมต่อ (ปิดแท็บ/เปลี่ยนหน้า)
  res.on('close', cleanup);
  return cleanup;
}

app.get('/api/cameras/:id/stream', (req, res) => {
  const cam = findCamera(req.params.id);
  if (!cam) return res.status(404).json({ success: false, message: 'ไม่พบกล้องนี้' });
  const fps = Math.min(Math.max(Number(req.query.fps) || 6, 1), 15);
  const width = Math.min(Math.max(Number(req.query.width) || 960, 320), 1920);
  startMjpegStream(cam.url, res, { fps, width });
});

/* =========================================================
   Health check
========================================================= */
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Fallback to index.html for SPA-style routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CIVIL server running on port ${PORT}`);
  console.log(`Cameras API:   GET/POST/PUT/DELETE  /api/cameras`);
  console.log(`Test RTSP:     POST /api/test-rtsp  { "url": "rtsp://..." }`);
  console.log(`Snapshot:      GET  /api/cameras/:id/snapshot`);
  console.log(`Live stream:   GET  /api/cameras/:id/stream`);
});

process.on('SIGINT', () => {
  activeStreamCleanups.forEach((fn) => fn());
  process.exit(0);
});
