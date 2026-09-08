/* Ported from app.js barChartSVG() — used by Reports "byTask" / "byWorker" tabs. */
export default function BarChart({ labels, values, color }) {
  const W = 640, H = 200, padL = 8, padR = 8, padT = 14, padB = 30, gap = 10;
  const max = Math.max(...values, 1);
  const n = values.length || 1;
  const barW = Math.max(6, (W - padL - padR - gap * (n - 1)) / n);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="var(--divider)" strokeWidth="1" />
      {values.map((v, i) => {
        const x = padL + i * (barW + gap);
        const h = (v / max) * (H - padT - padB);
        return <rect key={i} x={x.toFixed(1)} y={(H - padB - h).toFixed(1)} width={barW.toFixed(1)} height={h.toFixed(1)} rx="4" fill={color} />;
      })}
      {labels.map((lb, i) => {
        const x = padL + i * (barW + gap) + barW / 2;
        const short = String(lb).length > 10 ? String(lb).slice(0, 9) + '…' : lb;
        return <text key={i} x={x.toFixed(1)} y={H - 10} fontSize="10" fill="var(--muted)" textAnchor="middle">{short}</text>;
      })}
    </svg>
  );
}
