import Icon from '../icons/Icon.jsx';

const NAV_ITEMS = [
  { key: 'home', icon: 'home', label: 'Home' },
  { key: 'task', icon: 'task', label: 'Task' },
  { key: 'dashboard', icon: 'dash', label: 'Dashboard' },
  { key: 'reports', icon: 'report', label: 'Reports' },
  { key: 'logs', icon: 'logs', label: 'Logs' },
  { key: 'devices', icon: 'pulse', label: 'Device Monitor' },
  { key: 'settings', icon: 'gear', label: 'Settings' },
];

export default function Sidebar({ view, permissions, open, onNavigate, onCloseMobile }) {
  return (
    <>
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand"><strong>CIVIL</strong><small>AI Brick Construction Monitoring</small></div>
        <nav className="nav">
          {NAV_ITEMS.map((item) => {
            const allowed = !permissions || permissions[item.key] !== false;
            if (!allowed) return null;
            return (
              <button
                key={item.key}
                className={`nav-item${view === item.key ? ' active' : ''}`}
                data-view={item.key}
                onClick={() => onNavigate(item.key)}
              >
                <Icon name={item.icon} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-foot">CIVIL · v0.9.2-beta<br />AI Brick Construction Monitoring</div>
      </aside>
      <div className={`sidebar-scrim${open ? ' open' : ''}`} onClick={onCloseMobile} />
    </>
  );
}
