import { useLayoutEffect, useRef, useState } from 'react';

/* ===================================================================
   CameraStage — draws a camera image with the camera's saved view
   (flip -> rotate -> zoom) applied in CSS, inside a box whose aspect
   ratio equals the TRANSFORMED frame. ROI / bbox canvases live inside
   this box, so their 0..1 coordinates are relative to the transformed
   image — exactly what the server feeds to YOLO (see imageView.js,
   which applies the same order of operations to the real JPEG).
=================================================================== */
export const IDENTITY_VIEW = { rotate: 0, flipH: false, flipV: false, zoom: 1, cx: 0.5, cy: 0.5 };

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

export function normalizeView(v) {
  return { ...IDENTITY_VIEW, ...(v || {}) };
}
export function sameView(a, b) {
  const x = normalizeView(a), y = normalizeView(b);
  const zoomed = x.zoom > 1 || y.zoom > 1; // pan only matters while zoomed in
  return x.rotate === y.rotate && !!x.flipH === !!y.flipH && !!x.flipV === !!y.flipV && x.zoom === y.zoom
    && (!zoomed || (x.cx === y.cx && x.cy === y.cy));
}

export default function CameraStage({ view, natural, children, image }) {
  const frameRef = useRef(null);
  const [box, setBox] = useState(null);
  const v = normalizeView(view);
  const swap = v.rotate === 90 || v.rotate === 270;
  const nw = natural?.w || 16, nh = natural?.h || 9;
  const aspect = swap ? nh / nw : nw / nh;

  // largest box of the transformed aspect that fits the fixed-height .camera-frame
  useLayoutEffect(() => {
    const el = frameRef.current?.parentElement;
    if (!el) return undefined;
    const calc = () => {
      const W = el.clientWidth, H = el.clientHeight;
      if (!W || !H) return;
      const w = W / H > aspect ? H * aspect : W;
      setBox({ w: Math.round(w), h: Math.round(w / aspect) });
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))); // ROI / bbox canvases re-measure themselves on 'resize'
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  const z = clamp(v.zoom, 1, 5);
  const x0 = clamp(v.cx - 1 / (2 * z), 0, 1 - 1 / z); // same clamp as the server crop
  const y0 = clamp(v.cy - 1 / (2 * z), 0, 1 - 1 / z);
  const zoomStyle = { position: 'absolute', inset: 0, transformOrigin: '0 0', transform: `scale(${z}) translate(${-x0 * 100}%, ${-y0 * 100}%)` };
  const imgStyle = box ? {
    position: 'absolute', left: '50%', top: '50%', objectFit: 'fill', background: '#000',
    width: swap ? box.h : box.w, height: swap ? box.w : box.h,
    transform: `translate(-50%, -50%) rotate(${v.rotate}deg) scaleX(${v.flipH ? -1 : 1}) scaleY(${v.flipV ? -1 : 1})`,
  } : { display: 'none' };

  return (
    <div ref={frameRef} className="camera-stage" style={box ? { width: box.w, height: box.h } : { left: 0, top: 0, right: 0, bottom: 0, transform: 'none' }}>
      <div className="camera-view"><div style={zoomStyle}>{image(imgStyle)}</div></div>
      {children}
    </div>
  );
}
