import { useState } from 'react';
import Icon from '../icons/Icon.jsx';
import { useToast } from './Toast.jsx';
import * as api from '../api.js';

export const isAdmin = (user) => String(user?.role || '').trim().toLowerCase() === 'admin';
export const taskReadOnly = (task, user) => !!task?.locked && !isAdmin(user);

export default function TaskLockControl({ task, currentUser, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!task) return null;
  const admin = isAdmin(currentUser);
  const title = task.locked
    ? `ล็อกโดย ${task.lockedBy || 'Admin'}${task.lockedAt ? ` · ${new Date(task.lockedAt).toLocaleString('th-TH')}` : ''}`
    : 'ยังไม่ล็อก · แก้ไขได้ตามสิทธิ์ของผู้ใช้';

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const { ok, data } = await api.setTaskLock(task.id, !task.locked);
      if (!ok) return toast(data.message || 'บันทึกสถานะ Lock ไม่สำเร็จ');
      onChanged?.(data);
      window.dispatchEvent(new Event('civil:tasks-changed'));
      toast(data.locked ? 'ล็อกแล้ว — ผู้ใช้อื่นแก้ไข Task และรายงานของงานนี้ไม่ได้' : 'ปลดล็อกแล้ว — แก้ไขได้ตามสิทธิ์เดิม', 'success');
    } catch (_) {
      toast('เชื่อมต่อ backend ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="task-lock-control" onClick={(e) => e.stopPropagation()}>
      <span className={`task-lock-status${task.locked ? ' is-locked' : ''}`} title={title}>
        <Icon name={task.locked ? 'lock' : 'unlock'} /> {task.locked ? 'Locked' : 'Unlocked'}
      </span>
      {admin && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={toggle}
        aria-label={`${task.locked ? 'Unlock' : 'Lock'} ${task.name}`} title={task.locked ? 'ปลดล็อก Task และรายงานที่เกี่ยวข้อง' : 'ล็อก Task และรายงานที่เกี่ยวข้องสำหรับผู้ใช้อื่น'}>
        {busy ? 'กำลังบันทึก…' : task.locked ? 'Unlock' : 'Lock'}
      </button>}
    </div>
  );
}

export function TaskLockNotice({ task, currentUser }) {
  if (!task.locked) return null;
  return <div className="task-lock-notice" role="status">
    <Icon name="lock" />
    <div><strong>งานนี้ถูกล็อกโดย {task.lockedBy || 'Admin'}</strong>
      {task.lockedAt && <span className="cell-muted"> · {new Date(task.lockedAt).toLocaleString('th-TH')}</span>}
      <div>{isAdmin(currentUser) ? 'Admin ยังแก้ไขและปลดล็อกได้' : 'ดูข้อมูลและส่งออกรายงานได้ · แก้ไข ลบ ล้างข้อมูล และทำสำเนาไม่ได้'} · มีผลกับ Task Data และรายงานทุกหน้า</div>
    </div>
  </div>;
}
