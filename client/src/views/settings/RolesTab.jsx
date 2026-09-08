import { useToast } from '../../components/Toast.jsx';
import * as api from '../../api.js';

const PAGE_KEYS = ['home', 'task', 'dashboard', 'reports', 'logs', 'settings'];

export default function RolesTab({ roles, reloadRoles, onPermissionsChanged }) {
  const toast = useToast();

  async function updateRolePermission(id, key, checked) {
    const { ok } = await api.updateRole(id, { permissions: { [key]: checked } });
    if (ok) {
      await reloadRoles();
      onPermissionsChanged();
      toast('อัปเดตสิทธิ์แล้ว', 'success');
    } else {
      toast('อัปเดตสิทธิ์ไม่สำเร็จ');
    }
  }

  return (
    <div id="panel-roles" className="settings-panel active">
      <div className="card">
        <div className="card-head"><h3>Roles & Permissions</h3></div>
        <div className="card-body">
          <p className="cell-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Role มี 3 แบบคงที่ (Admin/Engineer/Viewer) เพิ่มหรือลบ Role ไม่ได้ — ปรับได้เฉพาะสิทธิ์เข้าเมนู/หน้าของแต่ละ Role</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Role</th><th>Home</th><th>Task</th><th>Dashboard</th><th>Reports</th><th>Logs</th><th>Settings</th></tr></thead>
              <tbody>
                {roles.length === 0 ? (
                  <tr><td colSpan={7}><div className="cell-muted" style={{ fontSize: 13 }}>ยังไม่มี Role</div></td></tr>
                ) : roles.map((r) => (
                  <tr key={r.id}>
                    <td className="cell-strong">{r.name}</td>
                    {PAGE_KEYS.map((k) => (
                      <td key={k} style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={!!r.permissions[k]} onChange={(e) => updateRolePermission(r.id, k, e.target.checked)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
