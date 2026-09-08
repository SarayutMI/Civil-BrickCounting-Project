import { useEffect, useState } from 'react';
import { formatBytes, downloadBlob } from '../../utils.jsx';
import { useToast } from '../../components/Toast.jsx';
import * as api from '../../api.js';

export default function StorageTab() {
  const toast = useToast();
  const [info, setInfo] = useState(null); // { usedBytes, totalBytes, snapshotCount, autoDelete, retentionDays }
  const [autoDelete, setAutoDelete] = useState(true);
  const [retentionDays, setRetentionDays] = useState(60);
  const [backingUp, setBackingUp] = useState(false);

  async function load() {
    try {
      const s = await api.getStorage();
      setInfo(s);
      setAutoDelete(!!s.autoDelete);
      setRetentionDays(s.retentionDays || 60);
    } catch (err) {
      console.error('โหลด Storage settings ไม่สำเร็จ', err);
    }
  }
  useEffect(() => { load(); }, []);

  async function saveStorageSettings() {
    const ok = await api.updateStorage({ autoDelete, retentionDays: parseInt(retentionDays, 10) || 60 });
    if (ok) { toast('บันทึกการตั้งค่า Storage แล้ว', 'success'); load(); }
    else toast('บันทึกไม่สำเร็จ');
  }

  async function runBackup() {
    toast('กำลังสำรองข้อมูลระบบ...');
    setBackingUp(true);
    try {
      const result = await api.runBackup();
      if (!result.ok) { toast(result.message); return; }
      downloadBlob(result.blob, result.filename, 'application/gzip');
      toast('สำรองข้อมูลสำเร็จแล้ว — ดาวน์โหลดไฟล์ .tar.gz แล้ว', 'success');
    } catch (_) {
      toast('เชื่อมต่อ backend ไม่สำเร็จ');
    } finally {
      setBackingUp(false);
    }
  }

  const usedText = info ? formatBytes(info.usedBytes) : '—';
  const totalText = info && info.totalBytes ? ` จาก ${formatBytes(info.totalBytes)} (ดิสก์ทั้งหมด)` : '';
  const pct = info && info.totalBytes ? Math.min(100, (info.usedBytes / info.totalBytes) * 100) : 0;

  return (
    <div id="panel-storage" className="settings-panel active">
      <div className="card">
        <div className="card-head"><h3>Storage</h3></div>
        <div className="card-body">
          <p>{info ? <>Snapshot ใช้พื้นที่ <strong>{usedText}</strong>{totalText}</> : 'กำลังโหลด...'}</p>
          <div className="storage-bar"><div style={{ width: pct + '%' }} /></div>
          <p className="cell-muted" style={{ fontSize: 12, marginTop: 8 }}>{info ? `${(info.snapshotCount || 0).toLocaleString()} ไฟล์ภาพ ในโฟลเดอร์ snapshots/` : ''}</p>
          <div className="divider" />
          <label><input type="checkbox" checked={autoDelete} onChange={(e) => setAutoDelete(e.target.checked)} /> ลบ Snapshot เก่าอัตโนมัติ</label>
          <div className="form-group" style={{ marginTop: 14 }}>
            <label>เก็บข้อมูลย้อนหลัง</label>
            <select className="select" value={String(retentionDays)} onChange={(e) => setRetentionDays(e.target.value)}>
              <option value="30">30 วัน</option>
              <option value="60">60 วัน</option>
              <option value="90">90 วัน</option>
            </select>
          </div>
          <div className="divider" />
          <div className="action-row">
            <button className="btn btn-secondary" onClick={saveStorageSettings}>บันทึกการตั้งค่า</button>
            <button className="btn btn-primary" disabled={backingUp} onClick={runBackup}>{backingUp ? 'กำลังสำรอง...' : 'สำรองข้อมูล (.tar.gz)'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
