import { useState } from 'react';
import Icon from '../../icons/Icon.jsx';
import { useToast } from '../../components/Toast.jsx';
import * as api from '../../api.js';

export default function WorkerTab({ workersMaster, reloadWorkers, reloadTasks }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');

  async function addWorkerMaster() {
    if (!name.trim()) { toast('กรุณากรอกชื่อแรงงาน'); return; }
    try {
      const { ok, data } = await api.createWorker({ name: name.trim(), role: role.trim() || 'ช่างก่อสร้าง' });
      if (ok) {
        setName(''); setRole('');
        await reloadWorkers();
        toast('เพิ่มแรงงานเรียบร้อยแล้ว', 'success');
      } else {
        toast(data.message || 'เพิ่มไม่สำเร็จ');
      }
    } catch (_) { toast('เชื่อมต่อ backend ไม่สำเร็จ'); }
  }

  async function removeWorkerMaster(id) {
    const ok = await api.deleteWorker(id);
    if (ok) {
      await reloadWorkers();
      await reloadTasks(); // worker may have been removed from tasks server-side too
      toast('ลบแรงงานแล้ว');
    } else {
      toast('ลบไม่สำเร็จ');
    }
  }

  return (
    <div id="panel-worker" className="settings-panel active">
      <div className="card">
        <div className="card-head"><h3>Workers</h3></div>
        <div className="card-body">
          <div className="form-grid">
            <input className="input" placeholder="ชื่อแรงงาน" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input" placeholder="ตำแหน่ง" value={role} onChange={(e) => setRole(e.target.value)} />
            <button className="btn btn-primary" onClick={addWorkerMaster}>+ เพิ่มแรงงาน</button>
          </div>
          <div className="divider" />
          <div id="workerListBody">
            {workersMaster.map((w) => (
              <div className="list-row" key={w.id}>
                <div className="l-main">
                  <div className="l-avatar">{w.name.slice(0, 1)}</div>
                  <div><div className="l-name">{w.name}</div><div className="l-sub">{w.role}</div></div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => removeWorkerMaster(w.id)}><Icon name="trash" /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
