# CIVIL — วิธีรัน YOLOv11 Detection

ระบบตอนนี้มี 2 ส่วนที่ต้องรันพร้อมกัน:

1. **Node.js server (server.js)** — เดิม, ทำหน้าที่ CRUD กล้อง/Task, ดึง snapshot จาก RTSP, เสิร์ฟหน้าเว็บ
2. **Python YOLOv11 service (yolo_service.py)** — ใหม่, รับภาพจาก Node แล้วรัน best.pt ของคุณ,
   คำนวณ bbox → centroid → เช็คว่าอยู่ใน ROI ไหม → นับบล็อก → แปลงเป็นตารางเมตร

## 1) ติดตั้ง Python service

```bash
cd <โฟลเดอร์โปรเจกต์>
pip install -r requirements.txt

# วาง best.pt ของคุณไว้โฟลเดอร์เดียวกับ yolo_service.py
# หรือกำหนด path เองผ่าน env:
export MODEL_PATH=/best.pt

# ถ้าต้องการเปลี่ยน port (default 8000):
export YOLO_PORT=8000

python yolo_service.py
```

ทดสอบว่า service รันอยู่: `curl http://127.0.0.1:8000/health`

## 2) รัน Node server ตามปกติ

```bash
npm install
export YOLO_SERVICE_URL=http://127.0.0.1:8000   # ถ้าเปลี่ยน host/port ของ python service
npm start
```

## 3) วิธีใช้งานในหน้าเว็บ

1. ไปที่ **Settings → Brick Types** — กำหนด 3 profile ว่าอิฐแต่ละประเภทนับกี่ "บล็อก" เท่ากับ 1 ตร.ม.
   (ค่านี้ผู้ใช้กำหนดเองได้เต็มที่ เก็บไว้ที่ `brickTypes.json`)
2. ไปที่ **Task → เปิด Task ใดก็ได้** — ตั้ง "เป้าหมายพื้นที่ (ตร.ม.)" และเลือก "ประเภทอิฐ (Profile)" ใน Task Information
   แล้วเลือกกล้อง (Source) และวาด ROI บนภาพสด (คลิกอย่างน้อย 3 จุด แล้วกด "ปิด ROI")
3. กด **"เริ่มตรวจจับ"** (สถานะ Task เปลี่ยนเป็น running) — ไม่ต้องกดปุ่มตรวจจับซ้ำอีก ระบบจะ:
   - ดึง snapshot จริงจากกล้อง (ffmpeg) แล้วส่งไปที่ Python service ต่อเนื่องอัตโนมัติ (auto-loop ใน server.js ทุก ~1 วินาที ต่อ Task ที่ status=running)
   - รอบถัดไปของ Task นั้นเริ่มทันทีที่รอบก่อนหน้าตรวจจับเสร็จ (ไม่มีการหน่วงเวลาคงที่ — realtime)
   - Python รัน YOLOv11 นับ bbox ที่ "จุดศูนย์กลาง (centroid)" อยู่ใน ROI เท่านั้น (กันปัญหานับซ้ำ/นับผิดโซนจากขอบกรอบ)
   - คำนวณพื้นที่ = จำนวนบล็อกใน ROI × blocksPerSqm (ตร.ม. ต่อ 1 บล็อก)
   - อัปเดตกลับเข้า Task (`area`, `blocks`) และ persist ลง `tasks.json` ทันที
   - หน้าเว็บ poll `/api/tasks/:id` ทุก 2 วินาทีเพื่อวาดกรอบ (bbox) ที่ตรวจพบล่าสุดทับบนภาพกล้องสดแบบ realtime
     (สีเขียว = อยู่ใน ROI, สีเทา = อยู่นอก ROI)

## 4) หลักการคำนวณพื้นที่ (สรุป)

```
สำหรับแต่ละกล่องที่ YOLOv11 ตรวจพบ:
  centroid = ((x1+x2)/2 / ภาพความกว้าง, (y1+y2)/2 / ภาพความสูง)
  ถ้า centroid อยู่ในรูปหลายเหลี่ยม ROI (ray-casting algorithm) -> นับเป็น 1 บล็อกในโซนนี้

พื้นที่ (ตร.ม.) = จำนวนบล็อกที่นับได้ทั้งหมดใน ROI × blocksPerSqm ของประเภทอิฐนั้น (ตร.ม. ต่อ 1 บล็อก)
```

การใช้ **centroid แทนขอบกรอบ (bbox edge)** ช่วยป้องกันปัญหา:
- อิฐก้อนที่อยู่ริม ROI แต่ bbox ยื่นออกไปนอกโซน จะไม่ถูกนับผิดพลาด (นับตามจุดกึ่งกลางจริงของก้อนอิฐ)
- อิฐก้อนที่อยู่นอก ROI แต่ bbox ทับเข้ามาเล็กน้อย จะไม่ถูกนับเข้าโซนผิด

## 5) หมายเหตุการปรับใช้จริง

- ถ้าโมเดล best.pt ของคุณมีหลาย class (เช่น อิฐมอญ/อิฐบล็อก/อิฐมวลเบาแยก class กัน)
  ให้ส่ง `class_id` เพิ่มเติมใน request ของ `/detect` (แก้ตรง server.js บรรทัดที่ยิงไป YOLO service)
  เพื่อเลือกนับเฉพาะ class ที่ตรงกับ brickType ของ Task นั้น ๆ
- `confidence` ของ AI ที่ตั้งในหน้า Task Detail (slider 50-99%) จะถูกส่งไปเป็น threshold ของ YOLO ด้วย
- การตรวจจับต่อเนื่องอัตโนมัติอยู่ใน `autoDetectTick()` (server.js) — วนทุก Task ที่ `status==='running'`,
  มีกล้อง และวาด ROI แล้ว โดยกันไม่ให้ Task เดียวกันตรวจจับซ้อนรอบกัน (`inFlightDetections`)
- bbox ล่าสุดของแต่ละ Task เก็บไว้ใน memory (`lastDetections`, ไม่ persist ลงไฟล์เพราะอัปเดตถี่) แนบไปกับ
  response ของ `GET /api/tasks` และ `GET /api/tasks/:id` เป็นฟิลด์ `lastDetection`
