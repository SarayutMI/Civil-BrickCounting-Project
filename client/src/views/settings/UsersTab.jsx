import { useState } from 'react';
import Icon from '../../icons/Icon.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useModal } from '../../components/ModalProvider.jsx';
import * as api from '../../api.js';

function UserModalBody({ user, roles, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = !!user;
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [username, setUsername] = useState(user?.username || '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(user?.role || roles[0]?.name || '');

  async function submit() {
    if (!name.trim() || !username.trim() || (!isEdit && !password)) {
      toast('กรุณากรอกชื่อ, username และ password ให้ครบ');
      return;
    }
    if (isEdit) {
      const body = { name: name.trim(), email: email.trim(), username: username.trim(), role };
      if (password) body.password = password;
      const { ok, data } = await api.updateUser(user.id, body);
      if (ok) { onClose(); await onSaved(); toast('บันทึกการแก้ไขเรียบร้อยแล้ว', 'success'); }
      else toast(data.message || 'แก้ไขไม่สำเร็จ');
    } else {
      const { ok, data } = await api.createUser({ name: name.trim(), email: email.trim(), username: username.trim(), password, role });
      if (ok) { onClose(); await onSaved(); toast('เพิ่มผู้ใช้งานเรียบร้อยแล้ว', 'success'); }
      else toast(data.message || 'เพิ่มผู้ใช้งานไม่สำเร็จ');
    }
  }

  return (
    <>
      <div className="modal-header"><h3>{isEdit ? 'แก้ไขผู้ใช้งาน' : 'เพิ่มผู้ใช้งานใหม่'}</h3><button className="modal-close" onClick={onClose}><Icon name="x" /></button></div>
      <div className="modal-body">
        <div className="form-group"><label>ชื่อ-นามสกุล</label><input className="input" placeholder="เช่น สมหญิง ใจงาม" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="form-group"><label>อีเมล</label><input className="input" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="form-group"><label>Username (สำหรับ login)</label><input className="input" placeholder="เช่น somying" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
        <div className="form-group"><label>{isEdit ? 'Password (เว้นว่างไว้ถ้าไม่เปลี่ยน)' : 'Password'}</label><input type="password" className="input" placeholder={isEdit ? '••••••••' : 'ตั้งรหัสผ่าน'} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <div className="form-group"><label>สิทธิ์การใช้งาน (Role)</label>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
          </select>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-secondary" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" onClick={submit}>{isEdit ? 'บันทึกการแก้ไข' : 'เพิ่มผู้ใช้งาน'}</button>
      </div>
    </>
  );
}

export default function UsersTab({ users, roles, reloadUsers }) {
  const toast = useToast();
  const modal = useModal();

  function openAddUserModal() {
    modal.open(<UserModalBody user={null} roles={roles} onClose={modal.close} onSaved={reloadUsers} />);
  }
  function openEditUserModal(id) {
    const u = users.find((x) => x.id === id);
    if (!u) return;
    modal.open(<UserModalBody user={u} roles={roles} onClose={modal.close} onSaved={reloadUsers} />);
  }
  async function removeUser(id) {
    if (!window.confirm('ยืนยันลบผู้ใช้งานนี้?')) return;
    const { ok, data } = await api.deleteUser(id);
    if (ok) { await reloadUsers(); toast('ลบผู้ใช้งานแล้ว'); }
    else toast(data.message || 'ลบไม่สำเร็จ');
  }

  return (
    <div id="panel-users" className="settings-panel active">
      <div className="card">
        <div className="card-head"><h3>Users</h3><button className="btn btn-primary" onClick={openAddUserModal}>+ เพิ่มผู้ใช้งาน</button></div>
        <div className="card-body">
          <div id="usersListBody">
            {users.length === 0 ? (
              <div className="cell-muted" style={{ fontSize: 13 }}>ยังไม่มีผู้ใช้งาน</div>
            ) : users.map((u) => (
              <div className="list-row" key={u.id}>
                <div className="l-main">
                  <div className="l-avatar">{u.name.slice(0, 1)}</div>
                  <div><div className="l-name">{u.name} <span className="badge badge-role">{u.role}</span></div><div className="l-sub">{u.username} · {u.email || '—'}</div></div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => openEditUserModal(u.id)}><Icon name="edit" /></button>
                  <button className="btn btn-ghost btn-sm" onClick={() => removeUser(u.id)}><Icon name="trash" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
