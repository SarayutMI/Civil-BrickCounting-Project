export default function Topbar({ title, crumb, user, onTestAlert, onAddTask, onLogout, onOpenMobileMenu }) {
  return (
    <header className="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button id="mobileMenuBtn" className="btn btn-secondary mobile-menu" onClick={onOpenMobileMenu}>☰</button>
        <div>
          <div id="topbarCrumb" className="crumb">{crumb}</div>
          <div id="topbarTitle" className="top-title">{title}</div>
        </div>
      </div>
      <div className="top-actions">
        <button className="btn btn-secondary" onClick={onTestAlert}>แจ้งเตือนทดสอบ</button>
        <button className="btn btn-primary" onClick={onAddTask}>+ Task</button>
        <span id="navUserBox" style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8, fontSize: 13, color: 'var(--muted)' }}>
          {user ? `${user.name} · ${user.role}` : ''}
        </span>
        <button className="btn btn-secondary btn-sm" onClick={onLogout}>ออกจากระบบ</button>
      </div>
    </header>
  );
}
