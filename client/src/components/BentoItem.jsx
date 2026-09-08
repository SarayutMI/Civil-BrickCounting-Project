export default function BentoItem({ icon, label, value, bg, fg }) {
  return (
    <div className="bento-item">
      <div>
        <div className="b-label">{label}</div>
        <div className="b-value">{value}</div>
      </div>
      <div className="b-icon" style={{ background: bg, color: fg }}>{icon}</div>
    </div>
  );
}
