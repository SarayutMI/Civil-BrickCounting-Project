/* Ported from app.js lineChartSVG() — flat progress line with soft fill + dots. */
export default function LineChart({ series, color }) {
  const W = 640, H = 180, pad = 24;
  const max = Math.max(...series, 100);
  const stepX = (W - pad * 2) / (series.length - 1 || 1);
  const pts = series.map((v, i) => [pad + i * stepX, H - pad - (v / max) * (H - pad * 2)]);
  const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const area = path + ` L${pts[pts.length - 1][0]},${H - pad} L${pts[0][0]},${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--divider)" strokeWidth="1" />
      <path d={area} fill={color} opacity="0.08" stroke="none" />
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill={color} />)}
    </svg>
  );
}
