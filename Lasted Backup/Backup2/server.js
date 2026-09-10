/**
 * CIVIL — AI Brick Construction Monitoring
 * Minimal backend server
 *
 * เหตุผลที่ต้องมี backend:
 * เบราว์เซอร์ (JavaScript ฝั่ง frontend) ไม่สามารถเปิดการเชื่อมต่อ RTSP ได้โดยตรง
 * เพราะ RTSP ไม่ใช่โปรโตคอลที่เบราว์เซอร์รองรับ (ต่างจาก HTTP/WebSocket)
 * จึงต้องมีเซิร์ฟเวอร์ฝั่ง backend ทำหน้าที่เชื่อมต่อไปยังกล้อง RTSP จริง
 * โดยใช้ ffprobe (มาพร้อม ffmpeg) เพื่อตรวจสอบว่าเชื่อมต่อสำเร็จหรือไม่
 * แล้วส่งผลลัพธ์กลับมาให้หน้าเว็บผ่าน REST API
 */

const express = require('express');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname))); // serve index.html, app.js, style.css

// ---------- Helper: validate RTSP-ish URL ----------
function isLikelyRtspUrl(url) {
  return typeof url === 'string' && /^rtsps?:\/\/\S+$/i.test(url.trim());
}

// ---------- Core RTSP test using ffprobe ----------
function probeRtsp(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const args = [
      '-rtsp_transport', 'tcp',
      '-timeout', String(timeoutMs * 1000), // microseconds, applies to some builds
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,avg_frame_rate',
      '-of', 'json',
      url
    ];

    const proc = spawn('ffprobe', args);

    let stdout = '';
    let stderr = '';
    let finished = false;

    const killTimer = setTimeout(() => {
      if (!finished) {
        finished = true;
        proc.kill('SIGKILL');
        resolve({
          success: false,
          message: 'หมดเวลาการเชื่อมต่อ (timeout) — ตรวจสอบ URL, เครือข่าย หรือ firewall',
          raw: stderr.trim()
        });
      }
    }, timeoutMs + 2000);

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(killTimer);
      resolve({
        success: false,
        message: 'ไม่สามารถรัน ffprobe บนเซิร์ฟเวอร์ได้ (โปรดติดตั้ง ffmpeg)',
        raw: err.message
      });
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
        } catch (_) {
          /* ignore parse issues, still treat as success since exit code 0 */
        }
        resolve({
          success: true,
          message: 'เชื่อมต่อกล้องสำเร็จ',
          stream: streamInfo
        });
      } else {
        resolve({
          success: false,
          message: 'เชื่อมต่อกล้องไม่สำเร็จ — ตรวจสอบ URL / username-password / network',
          raw: stderr.trim().slice(-800) // last part of ffmpeg error log
        });
      }
    });
  });
}

// ---------- API: test RTSP connection ----------
app.post('/api/test-rtsp', async (req, res) => {
  const { url, timeoutMs } = req.body || {};

  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ success: false, message: 'กรุณากรอก Camera URL' });
  }
  if (!isLikelyRtspUrl(url)) {
    return res.status(400).json({
      success: false,
      message: 'รูปแบบ URL ไม่ถูกต้อง ต้องขึ้นต้นด้วย rtsp:// หรือ rtsps://'
    });
  }

  const effectiveTimeout = Math.min(Math.max(Number(timeoutMs) || 8000, 2000), 20000);

  try {
    const result = await probeRtsp(url.trim(), effectiveTimeout);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดที่ไม่คาดคิดขณะทดสอบการเชื่อมต่อ',
      raw: err.message
    });
  }
});

// ---------- Health check ----------
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Fallback to index.html for any other route (SPA-style)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`CIVIL server running: http://192.168.10.54:${PORT}`);
  console.log(`RTSP test endpoint:   POST http://192.168.10.54:${PORT}/api/test-rtsp  { "url": "rtsp://..." }`);
});
