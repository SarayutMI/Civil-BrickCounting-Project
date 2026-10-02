import { useState } from 'react';
import Icon from '../icons/Icon.jsx';
import { StatusBadge, brickName, pct } from '../utils.jsx';
import { useToast } from '../components/Toast.jsx';
import { useModal } from '../components/ModalProvider.jsx';
import * as api from '../api.js';

/* ===================================================================
   Add-Task modal body — ported from app.js openAddTaskModal()/submitAddTask().
=================================================================== */
function AddTaskModalBody({ brickTypes, cameras, onClose, onCreated }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [zone, setZone] = useState('');
  const [brickType, setBrickType] = useState(brickTypes[0]?.id || '');
  const [cameraId, setCameraId] = useState('');
  const [expectedArea, setExpectedArea] = useState(100);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) { toast('กรุณากรอกชื่องาน'); return; }
    setBusy(true);
    try {
      const { ok, data } = await api.createTask({
        name: name.trim(), zone: zone.trim(), brickType,
        cameraId: cameraId || null, expectedArea: parseInt(expectedArea, 10) || 100,
      });
      if (ok) {
        toast('เพิ่ม Task สำเร็จ', 'success');
        onClose();
        onCreated(data.id);
      } else {
        toast(data.message || 'เพิ่ม Task ไม่สำเร็จ');
      }
    } catch (_) {
      toast('เชื่อมต่อ backend ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="modal-header"><h3>เพิ่ม Task ใหม่</h3><button className="modal-close" onClick={onClose}>×</button></div>
      <div className="modal-body">
        <div className="form-group"><label>ชื่องาน</label><input className="input" placeholder="เช่น อาคาร A ชั้น 3" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="form-group"><label>Zone</label><input className="input" placeholder="เช่น Zone A3" value={zone} onChange={(e) => setZone(e.target.value)} /></div>
        <div className="form-group"><label>ประเภทอิฐ</label>
          <select className="select" value={brickType} onChange={(e) => setBrickType(e.target.value)}>
            {brickTypes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>เลือกกล้อง (Source)</label>
          <select className="select" value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
            <option value="">— ไม่เลือกกล้อง (เลือกทีหลังได้) —</option>
            {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}{c.zone ? ' — ' + c.zone : ''}</option>)}
          </select>
        </div>
        <div className="form-group"><label>พื้นที่เป้าหมาย (m²)</label><input type="number" min="1" className="input" value={expectedArea} onChange={(e) => setExpectedArea(e.target.value)} /></div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-secondary" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'กำลังบันทึก...' : 'เพิ่ม Task'}</button>
      </div>
    </>
  );
}

export default function TaskList({ tasks, brickTypes, cameras, filter, setFilter, search, setSearch, onOpenTask, reloadTasks }) {
  const modal = useModal();
  const toast = useToast();
  const [copying, setCopying] = useState(null); // id of the task being duplicated

  // Copy settings + history (images, AI boxes, human labels) + report; the copy has no camera.
  async function duplicate(t) {
    const newName = window.prompt('ชื่องานสำเนา (คัดลอกค่าตั้ง + ประวัติภาพ + Label + Report — ไม่ผูกกล้อง)', `${t.name} (สำเนา)`);
    if (newName === null) return;
    setCopying(t.id);
    try {
      const { ok, data } = await api.duplicateTask(t.id, newName);
      if (!ok) { toast(data.message || 'คัดลอก Task ไม่สำเร็จ'); return; }
      toast(`คัดลอกแล้ว: "${data.name}" — ประวัติ ${data.historyRows} แถว`, 'success');
      await reloadTasks();
    } finally {
      setCopying(null);
    }
  }

  const rows = tasks.filter((t) => {
    const okStatus = filter === 'all' || t.status === filter;
    const q = search.toLowerCase();
    const okSearch = t.name.toLowerCase().includes(q) || t.zone.toLowerCase().includes(q);
    return okStatus && okSearch;
  });

  function openAddTaskModal() {
    modal.open(
      <AddTaskModalBody
        brickTypes={brickTypes}
        cameras={cameras}
        onClose={modal.close}
        onCreated={async (id) => { await reloadTasks(); onOpenTask(id); }}
      />
    );
  }

  return (
    <div id="view-task-list" className="active">
      <div className="section-head">
        <div><h2>Tasks</h2><p>จัดการงานและพื้นที่ตรวจจับ</p></div>
        <button className="btn btn-primary" onClick={openAddTaskModal}>+ เพิ่ม Task</button>
      </div>
      <div className="card">
        <div className="card-head">
          <div className="toolbar">
            <input className="input search" placeholder="ค้นหาชื่องาน / Zone" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="tabs">
              {[['all', 'ทั้งหมด'], ['running', 'กำลังทำ'], ['pause', 'พัก'], ['finished', 'เสร็จสิ้น']].map(([key, label]) => (
                <button key={key} className={`tab-btn task-filter-btn${filter === key ? ' active' : ''}`} onClick={() => setFilter(key)}>{label}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>ชื่องาน</th><th>Zone</th><th>ประเภทอิฐ</th><th>แรงงาน</th><th>ความคืบหน้า</th><th>สถานะ</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7}><div className="empty-state"><Icon name="empty" /><div className="e-title">ไม่พบ Task</div><div className="e-desc">ลองเปลี่ยนคำค้นหาหรือตัวกรอง</div></div></td></tr>
              ) : rows.map((t) => (
                <tr className="clickable" key={t.id} onClick={() => onOpenTask(t.id)}>
                  <td className="cell-strong">{t.name}{t.copyOf && <span className="copy-badge" title={`คัดลอกจาก "${t.copyOfName || ''}"`}>สำเนา</span>}</td>
                  <td className="cell-muted">{t.zone}</td>
                  <td className="cell-muted">{brickName(brickTypes, t.brickType)}</td>
                  <td className="cell-muted">{t.workers.length} คน</td>
                  <td style={{ minWidth: 140 }}>
                    <div className="progress-bar"><div className="fill" style={{ width: pct(t.area, t.expectedArea) + '%' }} /></div>
                    <div className="cell-muted" style={{ fontSize: 11.5, marginTop: 4 }}>{pct(t.area, t.expectedArea)}% · {t.area}/{t.expectedArea} m²</div>
                  </td>
                  <td><StatusBadge status={t.status} /></td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onOpenTask(t.id); }}>ดูรายละเอียด</button>
                      <button className="btn btn-secondary btn-sm btn-icon" disabled={copying === t.id} onClick={(e) => { e.stopPropagation(); duplicate(t); }}
                        aria-label="Duplicate" title={copying === t.id ? 'กำลังคัดลอก…' : 'Duplicate — สร้างงานสำเนาไว้ลองแก้ / ลองปรับ (คัดลอกค่าตั้ง ประวัติภาพ Label และ Report, ไม่ผูกกล้อง)'}>
                        <Icon name="copy" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
