import { useEffect, useRef } from 'react';

/* ===================================================================
   BBoxCanvas — draws AI-detection boxes over the live camera frame.
   Ported from app.js drawBBoxes().
   Color scheme (see index.html hint text above the camera card):
     green  = every brick box the model detected
     blue   = brick boxes actually counted (centroid inside ROI)
     orange = person detections — solid when inside the work zone,
              dashed when outside it (personDetections carry `in_roi`,
              per yolo_service.py's PersonDetection model; the original
              app.js always drew persons solid despite the hint text
              promising dashed-outside — this port implements what the
              hint text documents, since the data to do so is present).
=================================================================== */
const BBOX_COLOR_DETECTED = '#16A34A';
const BBOX_COLOR_COUNTED = '#0071E3';
const BBOX_COLOR_PERSON = '#F97316';

export default function BBoxCanvas({ lastDetection }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDetection]);

  useEffect(() => {
    const handler = () => draw();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDetection]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wrap = canvas.closest('.camera-stage') || canvas.closest('.camera-frame');
    if (!wrap) return;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (!lastDetection || !lastDetection.image_width) return;
    const { image_width: iw, image_height: ih } = lastDetection;

    ctx.lineWidth = 2;
    ctx.font = '11px sans-serif';

    (lastDetection.detections || []).forEach((d) => {
      const x = (d.x1 / iw) * w, y = (d.y1 / ih) * h;
      const bw = ((d.x2 - d.x1) / iw) * w, bh = ((d.y2 - d.y1) / ih) * h;
      const color = d.in_roi ? BBOX_COLOR_COUNTED : BBOX_COLOR_DETECTED;
      ctx.setLineDash([]);
      ctx.strokeStyle = color;
      ctx.strokeRect(x, y, bw, bh);
      ctx.fillStyle = color;
      ctx.fillText(`${Math.round(d.conf * 100)}%`, x + 2, Math.max(y - 4, 10));
    });

    (lastDetection.personDetections || []).forEach((p) => {
      const x = (p.x1 / iw) * w, y = (p.y1 / ih) * h;
      const bw = ((p.x2 - p.x1) / iw) * w, bh = ((p.y2 - p.y1) / ih) * h;
      ctx.setLineDash(p.in_roi === false ? [6, 4] : []);
      ctx.strokeStyle = BBOX_COLOR_PERSON;
      ctx.strokeRect(x, y, bw, bh);
      ctx.setLineDash([]);
      ctx.fillStyle = BBOX_COLOR_PERSON;
      ctx.fillText(`คน ${Math.round(p.conf * 100)}%`, x + 2, Math.max(y - 4, 10));
    });
  }

  return <canvas ref={canvasRef} id="bboxCanvas" className="camera-canvas" style={{ pointerEvents: 'none' }} />;
}
