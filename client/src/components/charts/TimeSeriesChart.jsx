/* Ported from app.js timeSeriesChartSVG() — labeled-bucket time series for Reports. */
export default function TimeSeriesChart({ labels, series, color }) {
  const W = 640, H = 200, padL = 14, padR = 14, padT = 14, padB = 26;
  const max = Math.max(...series, 1);
  const n = series.length;
  const stepX = n > 1 ? (W - padL - padR) / (n - 1) : 0;
  const pts = series.map((v, i) => [padL + i * stepX, H - padB - (v / max) * (H - padT - padB)]);
  const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const area = path + ` L${pts[n - 1][0]},${H - padB} L${pts[0][0]},${H - padB} Z`;
  const showEvery = Math.max(1, Math.ceil(n / 8));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="var(--divider)" strokeWidth="1" />
      <path d={area} fill={color} opacity="0.08" stroke="none" />
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={color} />)}
      {labels.map((lb, i) => i % showEvery === 0 ? (
        <text key={i} x={pts[i][0]} y={H - 8} fontSize="10" fill="var(--muted)" textAnchor="middle">{lb}</text>
      ) : null)}
    </svg>
  );
}
