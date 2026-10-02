import { useLayoutEffect, useRef, useState } from 'react';

/* ===================================================================
   CameraStage — draws a camera image with the camera's saved view
   (flip -> rotate -> perspective -> straighten -> zoom) applied in CSS,
   inside a box whose aspect ratio equals the TRANSFORMED frame. ROI /
   bbox canvases live inside this box, so their 0..1 coordinates are
   relative to the transformed image — exactly what the server feeds to
   YOLO (see imageView.js, which applies the same order of operations to
   the real JPEG).
=================================================================== */
export const IDENTITY_VIEW = { rotate: 0, flipH: false, flipV: false, vertical: 0, horizontal: 0, straighten: 0, zoom: 1, cx: 0.5, cy: 0.5 };

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const KEYSTONE_MAX = 0.3; // must match imageView.js

export function normalizeView(v) {
  return { ...IDENTITY_VIEW, ...(v || {}) };
}
export function sameView(a, b) {
  const x = normalizeView(a), y = normalizeView(b);
  const zoomed = x.zoom > 1 || y.zoom > 1; // pan only matters while zoomed in
  return x.rotate === y.rotate && !!x.flipH === !!y.flipH && !!x.flipV === !!y.flipV && x.zoom === y.zoom
    && x.vertical === y.vertical && x.horizontal === y.horizontal && x.straighten === y.straighten
    && (!zoomed || (x.cx === y.cx && x.cy === y.cy));
}

// Source corners (fractions of the frame: TL, TR, BL, BR) that get stretched onto the output
// corners — same formula as keystoneQuad() in imageView.js.
function keystoneQuad(vertical, horizontal) {
  const kv = (clamp(vertical || 0, -100, 100) / 100) * KEYSTONE_MAX;
  const kh = (clamp(horizontal || 0, -100, 100) / 100) * KEYSTONE_MAX;
  const top = Math.max(kv, 0), bottom = Math.max(-kv, 0), left = Math.max(kh, 0), right = Math.max(-kh, 0);
  return [[top, left], [1 - top, right], [bottom, 1 - left], [1 - bottom, 1 - right]];
}

// 3x3 homography (row-major, h[8] = 1) mapping src[i] -> dst[i] for four point pairs.
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) { // Gauss-Jordan with partial pivoting
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const k = A[r][c] / A[c][c];
      for (let j = c; j < 8; j++) A[r][j] -= k * A[c][j];
      b[r] -= k * b[c];
    }
  }
  return [...b.map((val, i) => val / A[i][i]), 1];
}

// CSS matrix3d for the keystone on a w x h box (transform-origin 0 0), or 'none'.
function perspectiveTransform(v, w, h) {
  if (!v.vertical && !v.horizontal) return 'none';
  const src = keystoneQuad(v.vertical, v.horizontal).map(([fx, fy]) => [fx * w, fy * h]);
  const m = homography(src, [[0, 0], [w, 0], [0, h], [w, h]]);
  return `matrix3d(${m[0]},${m[3]},0,${m[6]},${m[1]},${m[4]},0,${m[7]},0,0,1,0,${m[2]},${m[5]},0,${m[8]})`;
}

// Fine rotation scaled up just enough that the frame has no empty corners (same as imageView.js).
function straightenTransform(v, w, h) {
  if (!v.straighten) return 'none';
  const a = (Math.abs(v.straighten) * Math.PI) / 180;
  const cover = Math.cos(a) + Math.max(w / h, h / w) * Math.sin(a);
  return `rotate(${v.straighten}deg) scale(${cover})`;
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
  // nested so CSS applies them innermost-first: rotate/flip (img) -> perspective -> straighten -> zoom
  const straightenStyle = { position: 'absolute', inset: 0, transformOrigin: '50% 50%', transform: box ? straightenTransform(v, box.w, box.h) : 'none' };
  const perspectiveStyle = box
    ? { position: 'absolute', left: 0, top: 0, width: box.w, height: box.h, transformOrigin: '0 0', transform: perspectiveTransform(v, box.w, box.h) }
    : { position: 'absolute', inset: 0 };

  return (
    <div ref={frameRef} className="camera-stage" style={box ? { width: box.w, height: box.h } : { left: 0, top: 0, right: 0, bottom: 0, transform: 'none' }}>
      <div className="camera-view">
        <div style={zoomStyle}>
          <div style={straightenStyle}>
            <div style={perspectiveStyle}>{image(imgStyle)}</div>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
