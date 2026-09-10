# CIVIL — AI Brick Construction Monitoring (RTSP Test พร้อมใช้งานจริง)

## สิ่งที่แก้ไข
เดิม ปุ่ม "ทดสอบการเชื่อมต่อ" ใน Settings > Camera เป็นแค่ `setTimeout()` mock ที่ toast
"เชื่อมต่อกล้องสำเร็จ" เสมอ ไม่ได้เชื่อมต่อกล้องจริง

**เหตุผลสำคัญ:** เบราว์เซอร์ (frontend JavaScript) เชื่อมต่อ RTSP โดยตรงไม่ได้ เพราะ RTSP
ไม่ใช่โปรโตคอลที่เบราว์เซอร์รองรับ (ต่างจาก HTTP/WebSocket) จึงต้องมี **backend server**
ทำหน้าที่เชื่อมต่อไปยังกล้องจริงแทน แล้วส่งผลลัพธ์กลับมาที่หน้าเว็บ

## สิ่งที่เพิ่มเข้ามา
1. `server.js` — Node.js + Express backend มี endpoint `POST /api/test-rtsp`
   ที่ใช้ `ffprobe` (มากับ ffmpeg) เชื่อมต่อไปยัง URL ที่กรอกจริง ๆ แล้วตรวจสอบว่า
   ได้ video stream กลับมาหรือไม่ (codec, ความละเอียด, fps)
2. `index.html` — เพิ่ม `id` ให้ช่อง Camera URL (`cameraUrlInput`) และพื้นที่แสดงผลลัพธ์/รายละเอียด error
3. `app.js` — แก้ `testCameraConnection()` ให้เรียก `fetch('/api/test-rtsp', ...)` จริง,
   ตรวจรูปแบบ URL, แสดงผล success/fail และรายละเอียด error จริงจาก ffprobe (เช่น
   Connection refused, timeout, authentication failed ฯลฯ)

## วิธีรัน
ต้องมี Node.js (>=18) และ **ffmpeg** ติดตั้งในเครื่อง (มี `ffprobe` มาด้วย)

```bash
cd civil-rtsp-monitor
npm install
npm start
```

จากนั้นเปิดเบราว์เซอร์ไปที่ `http://localhost:3000`

ตรวจสอบว่า ffmpeg ติดตั้งแล้วด้วย:
```bash
ffprobe -version
```
ถ้ายังไม่มี ติดตั้งด้วย (Ubuntu/Debian): `sudo apt install ffmpeg`

## วิธีทดสอบ
1. ไปที่เมนู **Settings > Camera**
2. กรอก Camera URL เช่น `rtsp://username:password@192.168.1.100:554/stream1`
3. กด **ทดสอบการเชื่อมต่อ**
   - ถ้าเชื่อมต่อสำเร็จ: ขึ้น "เชื่อมต่อกล้องสำเร็จ" พร้อมรายละเอียด codec/ความละเอียด/fps
   - ถ้าไม่สำเร็จ: ขึ้น error message จริงจาก ffmpeg (เช่น connection refused,
     401 unauthorized, timeout)

## หมายเหตุ
- Endpoint จำกัดเวลาเชื่อมต่อไว้ที่ 8 วินาที (ปรับได้ใน `app.js`/`server.js`)
- รองรับทั้ง `rtsp://` และ `rtsps://`
- ผมได้ทดสอบ end-to-end แล้วทั้งกรณี URL ผิดรูปแบบ, ปฏิเสธการเชื่อมต่อ (connection refused),
  และ timeout — ทำงานถูกต้องครบทุกกรณี
