"""
CIVIL — YOLOv11 Brick Detection Microservice
=============================================
รับภาพ (snapshot จาก RTSP ที่ Node.js backend ดึงมาให้), รัน YOLOv11 (best.pt ของคุณเอง),
แล้วคำนวณว่ามีอิฐ/บล็อกกี่ก้อน "อยู่ในโซน ROI จริง ๆ" โดยใช้จุดศูนย์กลาง (centroid)
ของแต่ละ bounding box เป็นตัวตัดสิน (ป้องกันปัญหาขอบกรอบซ้อนโซนใกล้เคียง)
แล้วแปลงจำนวนบล็อกเป็นพื้นที่ตารางเมตรตามอัตราส่วนของอิฐแต่ละประเภท (blocksPerSqm)
ที่ผู้ใช้ตั้งค่าเองผ่านหน้า UI (Settings > Brick Types)

รันแยกจาก Node server (คนละ process/port) เพราะ inference model ควรอยู่ใน Python runtime
ที่มี ultralytics + torch ติดตั้งไว้ Node server.js จะเรียก service นี้ผ่าน HTTP (ดู server.js
endpoint POST /api/tasks/:id/detect ซึ่ง proxy มาที่นี่)

----------------------------------------------------------------------
วิธีรัน (ดูรายละเอียดเพิ่มเติมใน README_YOLO.md ที่แนบมาด้วย):

  pip install -r requirements.txt
  # วาง best.pt ของคุณไว้โฟลเดอร์เดียวกับไฟล์นี้ (หรือกำหนด path ผ่าน env MODEL_PATH)
  export MODEL_PATH=/path/to/best.pt      # ถ้าไม่ตั้ง จะหาไฟล์ best-V2-25sep26.pt ในโฟลเดอร์เดียวกัน
  export YOLO_PORT=8000                   # ค่า default คือ 8000
  python yolo_service.py

Node server.js (ตั้งค่า env YOLO_SERVICE_URL=http://127.0.0.1:8000 ถ้าเปลี่ยน host/port)
จะยิง POST ภาพ + roi + brickType config มาที่ /detect ของ service นี้โดยอัตโนมัติ
----------------------------------------------------------------------
"""

import base64
import io
import os
from typing import List, Optional, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from PIL import Image

MODEL_PATH = os.environ.get("MODEL_PATH", os.path.join(os.path.dirname(__file__), "best-V2-25sep26.pt"))
YOLO_PORT = int(os.environ.get("YOLO_PORT", "8000"))
DEFAULT_IMG_SIZE = int(os.environ.get("YOLO_IMGSZ", "960"))

# โมเดลที่สอง — แยกจาก best.pt (อิฐ) โดยเฉพาะ ใช้ตรวจจับ "คน" (class person) ในภาพ
# ค่า default เป็น yolov8n.pt (COCO pretrained, class_id 0 = person) — ultralytics จะดาวน์โหลดให้เอง
# ครั้งแรกถ้ายังไม่มีไฟล์นี้ในเครื่อง (ต้องมี internet ตอนรันครั้งแรก)
# ถ้ามีโมเดลของตัวเองที่เทรนตรวจจับคนโดยเฉพาะ ให้ตั้ง env PERSON_MODEL_PATH ชี้ไปที่ไฟล์นั้นแทน
PERSON_MODEL_PATH = os.environ.get("PERSON_MODEL_PATH", "yolo26s.pt")
PERSON_CLASS_ID = int(os.environ.get("PERSON_CLASS_ID", "0"))  # COCO: 0 = person

app = FastAPI(title="CIVIL YOLOv11 Brick Detection Service")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

_model = None  # โหลดแบบ lazy ครั้งแรกที่มี request เข้ามา (ไม่บล็อก startup ถ้ายังไม่มี best.pt)
_person_model = None  # โหลดแบบ lazy เช่นกัน — แยกจาก _model (โมเดลอิฐ) โดยสิ้นเชิง


def get_model():
    """โหลด YOLOv11 model จาก best.pt (lazy-load + cache ไว้ใน memory)."""
    global _model
    if _model is None:
        try:
            from ultralytics import YOLO
        except ImportError as e:
            raise HTTPException(
                status_code=500,
                detail="ยังไม่ได้ติดตั้ง ultralytics — รัน: pip install -r requirements.txt",
            ) from e
        if not os.path.exists(MODEL_PATH):
            raise HTTPException(
                status_code=500,
                detail=f"ไม่พบไฟล์โมเดลที่ {MODEL_PATH} — วาง best.pt ไว้ที่นี่ หรือกำหนด env MODEL_PATH",
            )
        _model = YOLO(MODEL_PATH)
    return _model


def get_person_model():
    """โหลดโมเดลตรวจจับคน (lazy-load + cache) — คนละโมเดลกับโมเดลอิฐ (get_model)."""
    global _person_model
    if _person_model is None:
        try:
            from ultralytics import YOLO
        except ImportError as e:
            raise HTTPException(
                status_code=500,
                detail="ยังไม่ได้ติดตั้ง ultralytics — รัน: pip install -r requirements.txt",
            ) from e
        try:
            _person_model = YOLO(PERSON_MODEL_PATH)
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=(
                    f"โหลดโมเดลตรวจจับคนไม่สำเร็จ ({PERSON_MODEL_PATH}): {e} — "
                    "ถ้าไม่มี internet ให้ดาวน์โหลด yolov8n.pt มาวางไว้เอง หรือกำหนด env PERSON_MODEL_PATH"
                ),
            ) from e
    return _person_model


class DetectRequest(BaseModel):
    image_base64: str = Field(..., description="ภาพ JPEG/PNG แบบ base64 (ไม่ต้องมี data: prefix)")
    roi: List[Tuple[float, float]] = Field(
        default_factory=list,
        description="จุด ROI แบบ normalized (0..1) ตามลำดับที่วาดไว้ในหน้า UI, ว่างได้ = ทั้งภาพ",
    )
    blocks_per_sqm: float = Field(
        ..., gt=0, description="พื้นที่ (ตร.ม.) ต่ออิฐ/บล็อก 1 ก้อน — area = จำนวนบล็อก × ค่านี้ (ตั้งค่าต่อประเภทอิฐใน Settings; ชื่อ field คงไว้เพื่อความเข้ากันได้)"
    )
    confidence: float = Field(0.5, ge=0.01, le=0.99, description="ค่า confidence threshold ของโมเดล (0-1)")
    class_id: Optional[int] = Field(
        None, description="ถ้าโมเดลมีหลาย class และต้องการนับเฉพาะ class อิฐ ให้ระบุ index ของ class นั้น"
    )
    imgsz: Optional[int] = Field(None, description="ขนาดภาพที่ใช้ inference (default 960)")


class Detection(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float
    cx: float  # centroid x (normalized 0..1)
    cy: float  # centroid y (normalized 0..1)
    conf: float
    cls: int
    in_roi: bool


class DetectResponse(BaseModel):
    total_detections: int
    blocks_in_roi: int
    area_m2: float
    blocks_per_sqm: float
    detections: List[Detection]
    image_width: int
    image_height: int


def point_in_polygon(x: float, y: float, polygon: List[Tuple[float, float]]) -> bool:
    """
    Ray-casting algorithm มาตรฐาน สำหรับเช็คว่าจุด (x,y) แบบ normalized อยู่ในรูปหลายเหลี่ยม
    ROI (ก็เป็นค่า normalized เช่นกัน) หรือไม่ — ใช้ตรงนี้กับจุด "centroid" ของแต่ละ bbox
    ไม่ใช้ขอบกรอบ bbox ตรง ๆ เพื่อกันปัญหานับซ้ำ/นับผิดโซนตอนกรอบใกล้เคียงกันคาบเกี่ยว ROI
    """
    if len(polygon) < 3:
        return True  # ไม่ได้วาด ROI ไว้ -> ถือว่านับทั้งภาพ
    inside = False
    n = len(polygon)
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        intersect = ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi
        )
        if intersect:
            inside = not inside
        j = i
    return inside


class PersonDetectRequest(BaseModel):
    image_base64: str = Field(..., description="ภาพ JPEG/PNG แบบ base64 (ไม่ต้องมี data: prefix)")
    roi: List[Tuple[float, float]] = Field(
        default_factory=list,
        description="จุด ROI แบบ normalized (0..1) เดียวกับโซนของ Task — ใช้เช็คว่าคนอยู่ในโซนงานหรือไม่",
    )
    confidence: float = Field(0.5, ge=0.01, le=0.99, description="ค่า confidence threshold ของโมเดลตรวจจับคน")
    imgsz: Optional[int] = Field(None, description="ขนาดภาพที่ใช้ inference (default 960)")


class PersonDetection(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float
    cx: float
    cy: float
    conf: float
    in_roi: bool


class PersonDetectResponse(BaseModel):
    total_detections: int
    persons_in_roi: int
    detections: List[PersonDetection]
    image_width: int
    image_height: int


@app.get("/health")
def health():
    return {
        "ok": True,
        "model_loaded": _model is not None,
        "model_path": MODEL_PATH,
        "person_model_loaded": _person_model is not None,
        "person_model_path": PERSON_MODEL_PATH,
    }


@app.post("/detect", response_model=DetectResponse)
def detect(req: DetectRequest):
    model = get_model()

    try:
        raw = base64.b64decode(req.image_base64)
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"ถอดรหัสภาพไม่สำเร็จ: {e}")

    W, H = img.size
    results = model.predict(
        img,
        conf=req.confidence,
        imgsz=req.imgsz or DEFAULT_IMG_SIZE,
        verbose=False,
    )

    detections: List[Detection] = []
    blocks_in_roi = 0

    if results:
        r = results[0]
        boxes = r.boxes
        if boxes is not None:
            for box in boxes:
                cls_id = int(box.cls[0].item())
                if req.class_id is not None and cls_id != req.class_id:
                    continue
                x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
                conf = float(box.conf[0].item())

                # จุดศูนย์กลาง (centroid) ของ bbox แบบ normalized 0..1 ใช้ตัดสินว่าอยู่ใน ROI หรือไม่
                cx_n = ((x1 + x2) / 2.0) / W
                cy_n = ((y1 + y2) / 2.0) / H
                inside = point_in_polygon(cx_n, cy_n, req.roi)

                detections.append(
                    Detection(
                        x1=x1, y1=y1, x2=x2, y2=y2,
                        cx=cx_n, cy=cy_n, conf=conf, cls=cls_id, in_roi=inside,
                    )
                )
                if inside:
                    blocks_in_roi += 1

    area_m2 = round(blocks_in_roi * req.blocks_per_sqm, 3)

    return DetectResponse(
        total_detections=len(detections),
        blocks_in_roi=blocks_in_roi,
        area_m2=area_m2,
        blocks_per_sqm=req.blocks_per_sqm,
        detections=detections,
        image_width=W,
        image_height=H,
    )


@app.post("/detect-person", response_model=PersonDetectResponse)
def detect_person(req: PersonDetectRequest):
    """
    ตรวจจับ "คน" ในภาพด้วยโมเดลที่สอง (แยกจากโมเดลอิฐโดยสิ้นเชิง — ดู get_person_model())
    ใช้ ROI เดียวกับ Task เพื่อนับเฉพาะคนที่อยู่ในโซนงานจริง (centroid-based เช่นเดียวกับการนับอิฐ)
    """
    model = get_person_model()

    try:
        raw = base64.b64decode(req.image_base64)
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"ถอดรหัสภาพไม่สำเร็จ: {e}")

    W, H = img.size
    results = model.predict(
        img,
        conf=req.confidence,
        imgsz=req.imgsz or DEFAULT_IMG_SIZE,
        classes=[PERSON_CLASS_ID],
        verbose=False,
    )

    detections: List[PersonDetection] = []
    persons_in_roi = 0

    if results:
        r = results[0]
        boxes = r.boxes
        if boxes is not None:
            for box in boxes:
                x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
                conf = float(box.conf[0].item())

                cx_n = ((x1 + x2) / 2.0) / W
                cy_n = ((y1 + y2) / 2.0) / H
                inside = point_in_polygon(cx_n, cy_n, req.roi)

                detections.append(
                    PersonDetection(x1=x1, y1=y1, x2=x2, y2=y2, cx=cx_n, cy=cy_n, conf=conf, in_roi=inside)
                )
                if inside:
                    persons_in_roi += 1

    return PersonDetectResponse(
        total_detections=len(detections),
        persons_in_roi=persons_in_roi,
        detections=detections,
        image_width=W,
        image_height=H,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=YOLO_PORT)
