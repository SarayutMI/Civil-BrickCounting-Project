# CIVIL — AI Brick Construction Monitoring (Full Camera System)

ระบบเต็มรูปแบบ: เพิ่ม/ลบ/เลือกกล้อง RTSP, ทดสอบการเชื่อมต่อ, ดึงภาพนิ่ง, และดูภาพสด (live)
ได้จริงทั้งหมด ผ่าน backend เดียว — **ทดสอบแล้วกับ RTSP stream จริง (ไม่ใช่ mock)**

## สถาปัตยกรรมโดยย่อ
เบราว์เซอร์เชื่อมต่อ RTSP โดยตรงไม่ได้ (ไม่ใช่โปรโตคอลของเว็บ) ระบบนี้จึงมี
**Node.js backend** (`server.js`) เป็นตัวกลาง ใช้ `ffmpeg`/`ffprobe` คุยกับกล้องจริง แล้ว
ส่งผลลัพธ์/ภาพกลับมาที่หน้าเว็บผ่าน HTTP:

| ฟีเจอร์ | กลไกเบื้องหลัง |
|---|---|
| ทดสอบการเชื่อมต่อ | `ffprobe` เช็ค codec/ความละเอียด/fps |
| ดึงภาพนิ่ง (snapshot) | `ffmpeg` แคปเฟรมเดียวเป็น JPEG |
| ดูภาพสด (live view) | `ffmpeg -f mpjpeg` สตรีม MJPEG (`multipart/x-mixed-replace`) ฝังใน `<img>` ได้ตรง ๆ ไม่ต้องใช้ WebRTC/HLS |
| จัดการรายการกล้อง | REST API + เก็บลงไฟล์ `cameras.json` (persist ข้ามการรีสตาร์ท) |

## ฟีเจอร์ที่ใช้งานได้จริงทั้งหมด
1. **Settings > Camera**
   - เพิ่มกล้องใหม่ (ชื่อ, Zone, RTSP URL)
   - ทดสอบการเชื่อมต่อ ก่อนบันทึก
   - ดูภาพตัวอย่าง (snapshot) ก่อนบันทึก
   - รายการกล้องทั้งหมด — ทดสอบ/ดูภาพ/ลบ ได้ทีละตัว
2. **Task Detail**
   - Dropdown เลือกกล้อง (Source) ที่จะใช้แสดงในหน้า Task นี้ — ค่าเริ่มต้นจะจับคู่อัตโนมัติกับ Zone ของ Task
   - ภาพสด (live) จริงจากกล้องที่เลือก แสดงใน frame เดียวกับที่วาด ROI ได้
   - ปุ่ม "รีเฟรชภาพ" เพื่อรีคอนเนกต์สตรีมใหม่
   - ปิดสตรีม (หยุด ffmpeg process) อัตโนมัติเมื่อออกจากหน้า Task หรือสลับเมนู — ป้องกัน process ค้าง

## วิธีรัน
ต้องมี **Node.js (>=18)** และ **ffmpeg** (มี `ffprobe` มาด้วย) ติดตั้งในเครื่อง

```bash
npm install
npm start
```

เปิดเบราว์เซอร์ไปที่ `http://localhost:3000`

ตรวจสอบว่ามี ffmpeg แล้ว: `ffprobe -version`
ถ้ายังไม่มี (Ubuntu/Debian): `sudo apt install ffmpeg`
macOS: `brew install ffmpeg`

## API Endpoints
| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/api/cameras` | รายการกล้องทั้งหมด |
| POST | `/api/cameras` | เพิ่มกล้องใหม่ `{name, url, zone}` |
| PUT | `/api/cameras/:id` | แก้ไขกล้อง |
| DELETE | `/api/cameras/:id` | ลบกล้อง |
| POST | `/api/cameras/:id/test` | ทดสอบการเชื่อมต่อกล้องที่บันทึกไว้ |
| POST | `/api/test-rtsp` | ทดสอบ URL แบบ ad-hoc (ยังไม่บันทึก) `{url}` |
| GET | `/api/cameras/:id/snapshot` | ดึงภาพนิ่ง JPEG จากกล้องที่บันทึกไว้ |
| GET | `/api/snapshot?url=...` | ดึงภาพนิ่งแบบ ad-hoc จาก URL ที่ระบุ |
| GET | `/api/cameras/:id/stream?fps=6&width=960` | สตรีมภาพสด MJPEG (ใส่ใน `<img src="...">` ได้ตรง ๆ) |
| GET | `/api/health` | Health check |

## ทดสอบแล้วจริง (end-to-end)
ผมได้ตั้ง RTSP server จำลอง (mediamtx) และ push test pattern เข้าไปเป็น live stream จริง
เพื่อทดสอบทุก endpoint แล้วยืนยันว่า:
- ✅ สร้าง/แก้ไข/ลบกล้อง ผ่าน REST API ได้ถูกต้อง
- ✅ ทดสอบการเชื่อมต่อ อ่าน codec/ความละเอียด/fps ได้ถูกต้อง (h264, 640×480, 15fps)
- ✅ ดึงภาพนิ่งได้ JPEG ไฟล์จริง ถูกต้อง
- ✅ Live stream ส่งข้อมูล `multipart/x-mixed-replace` ที่มี boundary/Content-Type/Content-Length ถูกต้องตามสเปก และมีเฟรม JPEG จริงไหลต่อเนื่อง
- ✅ กรณี error ทุกแบบ (URL ผิดรูปแบบ, connection refused, timeout) ส่งข้อความ error ที่ถูกต้องกลับมา

## หมายเหตุสำคัญ
- ระบบใช้ `ffmpeg`/`ffprobe` ของเครื่องที่รัน backend โดยตรง ต้องติดตั้งไว้ล่วงหน้า
- Live stream ใช้พลัง CPU สำหรับ transcode เป็น MJPEG ต่อกล้อง 1 stream — ถ้าเปิดหลายกล้องพร้อมกันจำนวนมาก ควรพิจารณาจำกัด fps/ความละเอียดลง (ปรับผ่าน query parameter `fps`, `width`)
- ข้อมูลกล้องเก็บในไฟล์ `cameras.json` ที่ root โปรเจกต์ (auto สร้างเมื่อเพิ่มกล้องตัวแรก)
- รองรับทั้ง `rtsp://` และ `rtsps://`
