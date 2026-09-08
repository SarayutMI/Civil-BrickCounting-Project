export default function SystemTab() {
  return (
    <div id="panel-system" className="settings-panel active">
      <div className="card">
        <div className="card-head"><h3>System</h3></div>
        <div className="card-body">
          <div className="form-grid">
            <div className="form-group"><label>Timezone</label><input className="input" defaultValue="Asia/Bangkok (GMT+7)" readOnly /></div>
            <div className="form-group"><label>Version</label><input className="input" defaultValue="v0.9.2-beta" readOnly /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
