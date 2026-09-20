import { useEffect, useRef } from 'react';

/* ===================================================================
   RoiCanvas — click-to-add-point ROI drawing, ported from app.js
   drawROI()/roiCanvasClick(). Points are normalized [0..1] coords
   relative to the parent .camera-frame box, same as the original.
=================================================================== */
export default function RoiCanvas({ points, onAddPoint }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  useEffect(() => {
    const handler = () => draw();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wrap = canvas.closest('.camera-stage') || canvas.closest('.camera-frame');
    if (!wrap) return;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (points.length === 0) return;
    ctx.beginPath();
    points.forEach(([nx, ny], i) => {
      const x = nx * w, y = ny * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    if (points.length > 2) ctx.closePath();
    ctx.fillStyle = 'rgba(0,113,227,0.18)';
    ctx.strokeStyle = '#0071E3';
    ctx.lineWidth = 2;
    if (points.length > 2) ctx.fill();
    ctx.stroke();
    points.forEach(([nx, ny]) => {
      ctx.beginPath();
      ctx.arc(nx * w, ny * h, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0071E3';
      ctx.stroke();
    });
  }

  function handleClick(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    onAddPoint(nx, ny);
  }

  return <canvas ref={canvasRef} id="roiCanvas" className="camera-canvas" onClick={handleClick} />;
}
