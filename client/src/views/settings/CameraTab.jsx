import { useEffect, useRef, useState } from 'react';
import Icon from '../../icons/Icon.jsx';
import { cameraStatusLabel } from '../../utils.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useModal } from '../../components/ModalProvider.jsx';
import * as api from '../../api.js';

const RTSP_RE = /^rtsps?:\/\/\S+$/i;

function CameraSnapshotModalBody({ cam, onClose }) {
  const [status, setStatus] = useState('loading'); // loading|ok|error
  const [key, setKey] = useState(0);
  const imgRef = useRef(null);

  useEffect(() => {
    setStatus('loading');
    const testImg = new Image();
    testImg.onload = () => { if (imgRef.current) imgRef.current.src = testImg.src; setStatus('ok'); };
    testImg.onerror = () => setStatus('error');
    testImg.src = api.cameraSnapshotUrl(cam.id);
  }, [cam.id, key]);

  return (
    <>
      <div className="modal-header"><h3>ภาพจากกล้อง: {cam.name}</h3><button className="modal-close" onClick={onClose}><Icon name="x" /></button></div>
      <div className="modal-body">
        <div className="camera-frame" style={{ height: 320 }}>
          <img ref={imgRef} className="camera-img" style={{ display: status === 'ok' ? 'block' : 'none' }} alt="" />
          {status !== 'ok' && (
            <div className="camera-mock"><div>{status === 'error' ? <>ดึงภาพไม่สำเร็จ<br /><small>ตรวจสอบการเชื่อมต่อกล้อง</small></> : 'กำลังดึงภาพ...'}</div></div>
          )}
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-secondary" onClick={onClose}>ปิด</button>
        <button className="btn btn-primary" onClick={() => setKey((k) => k + 1)}>ดึงภาพใหม่</button>
      </div>
    </>
  );
}

/* แสดง username/password FTP ที่ระบบสุ่มให้ หลังสร้างกล้องโหมด ftp สำเร็จ — ให้ผู้ใช้เอาไปตั้งในตัวกล้องจริง */
function FtpCredentialsModalBody({ cam, ftpPort, onClose }) {
  return (
    <>
      <div className="modal-header"><h3>ตั้งค่า FTP ในกล้อง: {cam.name}</h3><button className="modal-close" onClick={onClose}><Icon name="x" /></button></div>
      <div className="modal-body">
        <p className="cell-muted" style={{ fontSize: 12.5 }}>เอาค่านี้ไปกรอกในเมนู FTP/SFTP ของตัวกล้อง (Server/Host, Port, Username, Password) — ตั้งให้กล้องส่ง snapshot มาที่นี่ตามรอบเวลา/motion alarm</p>
        <div className="form-group"><label>Host</label><input className="input" readOnly value={window.location.hostname} /></div>
        <div className="form-group"><label>Port</label><input className="input" readOnly value={ftpPort ?? '-'} /></div>
        <div className="form-group"><label>Username</label><input className="input" readOnly value={cam.ftpUsername || ''} /></div>
        <div className="form-group"><label>Password</label><input className="input" readOnly value={cam.ftpPassword || ''} /></div>
      </div>
      <div className="modal-foot"><button className="btn btn-primary" onClick={onClose}>ปิด</button></div>
    </>
  );
}

/* Ported from app.js's Camera settings panel: add-camera form + RTSP test +
   ad-hoc snapshot preview, plus the saved-camera list (test/view/delete).
   เพิ่มโหมด FTP push สำหรับกล้อง 4G ที่อยู่คนละเครือข่ายกับ server (ดู server.js "FTP INGEST"). */
export default function CameraTab({ cameras, reloadCameras }) {
  const toast = useToast();
  const modal = useModal();

  const [mode, setMode] = useState('rtsp'); // 'rtsp' | 'ftp'
  const [name, setName] = useState('');
  const [zone, setZone] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [ftpPort, setFtpPort] = useState(null);

  useEffect(() => {
    api.getFtpInfo().then((info) => setFtpPort(info.port)).catch(() => {});
  }, []);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState({ text: '', color: 'var(--muted)' });
  const [testDetail, setTestDetail] = useState('');

  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewStatus, setPreviewStatus] = useState('loading'); // loading|ok|error
  const previewImgRef = useRef(null);

  async function testCameraConnection() {
    setTestDetail('');
    setTestResult({ text: '', color: 'var(--muted)' });
    const u = url.trim();
    if (!u) { toast('กรุณากรอก Camera URL ก่อนทดสอบ'); return; }
    if (!RTSP_RE.test(u)) { toast('รูปแบบ URL ไม่ถูกต้อง ต้องขึ้นต้นด้วย rtsp:// หรือ rtsps://'); return; }
    toast('กำลังทดสอบการเชื่อมต่อกล้อง...');
    setTesting(true);
    setTestResult({ text: 'กำลังเชื่อมต่อไปยังกล้อง...', color: 'var(--muted)' });
    try {
      const data = await api.testRtsp(u, 8000);
      if (data.success) {
        toast(data.message || 'เชื่อมต่อกล้องสำเร็จ', 'success');
        setTestResult({ text: '✓ เชื่อมต่อสำเร็จ', color: 'var(--green)' });
        if (data.stream) {
          const s = data.stream;
          setTestDetail(`Codec: ${s.codec_name || '-'} | ความละเอียด: ${s.width || '-'}x${s.height || '-'} | FPS: ${s.avg_frame_rate || '-'}`);
        }
      } else {
        toast(data.message || 'เชื่อมต่อกล้องไม่สำเร็จ');
        setTestResult({ text: '✕ เชื่อมต่อไม่สำเร็จ', color: 'var(--danger)' });
        if (data.raw) setTestDetail(data.raw);
      }
    } catch (err) {
      toast('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้ (backend ไม่ทำงาน หรือเครือข่ายมีปัญหา)');
      setTestResult({ text: '✕ ไม่สามารถติดต่อเซิร์ฟเวอร์ได้', color: 'var(--danger)' });
      setTestDetail(String(err.message || err));
    } finally {
      setTesting(false);
    }
  }

  function previewAdHocSnapshot() {
    const u = url.trim();
    if (!u) { toast('กรุณากรอก Camera URL ก่อน'); return; }
    if (!RTSP_RE.test(u)) { toast('รูปแบบ URL ไม่ถูกต้อง'); return; }
    setPreviewVisible(true);
    setPreviewStatus('loading');
    const testImg = new Image();
    testImg.onload = () => { if (previewImgRef.current) previewImgRef.current.src = testImg.src; setPreviewStatus('ok'); };
    testImg.onerror = () => setPreviewStatus('error');
    testImg.src = api.adhocSnapshotUrl(u);
  }

  async function submitAddCamera() {
    if (!name.trim()) { toast('กรุณากรอกชื่อกล้อง'); return; }
    if (mode === 'rtsp') {
      if (!url.trim()) { toast('กรุณากรอก Camera URL'); return; }
      if (!RTSP_RE.test(url.trim())) { toast('รูปแบบ URL ไม่ถูกต้อง ต้องขึ้นต้นด้วย rtsp:// หรือ rtsps://'); return; }
    }
    setSaving(true);
    try {
      const body = mode === 'rtsp'
        ? { name: name.trim(), zone: zone.trim(), url: url.trim(), mode: 'rtsp' }
        : { name: name.trim(), zone: zone.trim(), mode: 'ftp' };
      const { ok, data } = await api.createCamera(body);
      if (ok) {
        toast('เพิ่มกล้องเรียบร้อยแล้ว', 'success');
        setName(''); setZone(''); setUrl('');
        await reloadCameras();
        if (mode === 'ftp') modal.open(<FtpCredentialsModalBody cam={data} ftpPort={ftpPort} onClose={modal.close} />);
      } else {
        toast(data.message || 'เพิ่มกล้องไม่สำเร็จ');
      }
    } catch (_) {
      toast('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้');
    } finally {
      setSaving(false);
    }
  }

  async function regenerateFtpPasswordFor(cam) {
    if (!window.confirm(`สร้าง password ใหม่สำหรับ "${cam.name}"? password เก่าจะใช้ไม่ได้อีกต่อไป ต้องไปตั้งค่าในกล้องใหม่`)) return;
    const { ok, data } = await api.regenerateFtpPassword(cam.id);
    if (ok) {
      toast('สร้าง password ใหม่แล้ว', 'success');
      await reloadCameras();
      modal.open(<FtpCredentialsModalBody cam={data} ftpPort={ftpPort} onClose={modal.close} />);
    } else {
      toast(data.message || 'ทำรายการไม่สำเร็จ');
    }
  }

  async function deleteCameraItem(id) {
    if (!window.confirm('ลบกล้องนี้ใช่หรือไม่?')) return;
    const { ok, data } = await api.deleteCamera(id);
    if (ok) { toast('ลบกล้องแล้ว', 'success'); await reloadCameras(); }
    else toast(data.message || 'ลบไม่สำเร็จ');
  }

  async function testSavedCamera(id) {
    const { ok, data } = await api.testCamera(id);
    await reloadCameras();
    toast(data.message || (data.success ? 'เชื่อมต่อสำเร็จ' : 'เชื่อมต่อไม่สำเร็จ'), data.success ? 'success' : 'error');
    if (!ok && !data.message) toast('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้', 'error');
  }

  function viewCameraSnapshotModal(cam) {
    modal.open(<CameraSnapshotModalBody cam={cam} onClose={modal.close} />);
  }

  return (
    <div id="panel-camera" className="settings-panel active">
      <div className="card">
        <div className="card-head"><h3>เพิ่มกล้องใหม่</h3></div>
        <div className="card-body">
          <div className="form-group" style={{ marginBottom: 14 }}>
            <label>วิธีรับภาพจากกล้อง</label>
            <div className="tabs" style={{ display: 'inline-flex' }}>
              <button className={`tab-btn${mode === 'rtsp' ? ' active' : ''}`} onClick={() => setMode('rtsp')}>RTSP (server ดึงภาพเอง)</button>
              <button className={`tab-btn${mode === 'ftp' ? ' active' : ''}`} onClick={() => setMode('ftp')}>FTP/SFTP (กล้อง push เข้ามาเอง)</button>
            </div>
          </div>
          {mode === 'ftp' && (
            <div className="setting-note" style={{ marginBottom: 14 }}>
              ใช้กับกล้องที่อยู่คนละเครือข่ายกับ server (เช่นกล้อง 4G) และตัวกล้องรองรับ FTP/SFTP upload ในตัว — บันทึกแล้วระบบจะสุ่ม username/password ให้เอาไปตั้งในกล้อง ไม่ต้องกรอก URL
            </div>
          )}
          <div className="form-grid">
            <div className="form-group"><label>ชื่อกล้อง</label><input className="input" placeholder="เช่น กล้อง Zone A1" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="form-group"><label>Zone</label><input className="input" placeholder="Zone A1" value={zone} onChange={(e) => setZone(e.target.value)} /></div>
            {mode === 'rtsp' && (
              <div className="form-group" style={{ gridColumn: '1/-1' }}><label>Camera URL (RTSP)</label><input className="input" placeholder="rtsp://user:pass@camera-address:554/stream" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
            )}
          </div>
          <div className="divider" />
          <div className="action-row" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {mode === 'rtsp' && (
              <>
                <button className="btn btn-secondary" disabled={testing} onClick={testCameraConnection}>{testing ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}</button>
                <button className="btn btn-secondary" onClick={previewAdHocSnapshot}>ดูภาพตัวอย่าง</button>
              </>
            )}
            <button className="btn btn-primary" disabled={saving} onClick={submitAddCamera}>{saving ? 'กำลังบันทึก...' : '+ บันทึกกล้องนี้'}</button>
            <span style={{ fontSize: 12, color: testResult.color }}>{testResult.text}</span>
          </div>
          {testDetail && <div className="setting-note" style={{ marginTop: 12 }}>{testDetail}</div>}
          {mode === 'rtsp' && previewVisible && (
            <div style={{ marginTop: 14 }}>
              <div className="camera-frame" style={{ height: 220 }}>
                <img ref={previewImgRef} className="camera-img" style={{ display: previewStatus === 'ok' ? 'block' : 'none' }} alt="" />
                {previewStatus !== 'ok' && (
                  <div className="camera-mock"><div>{previewStatus === 'error' ? <>ดึงภาพไม่สำเร็จ<br /><small>ตรวจสอบ URL และเครือข่าย</small></> : 'กำลังดึงภาพตัวอย่าง...'}</div></div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-head"><h3>รายการกล้องทั้งหมด</h3><button className="btn btn-secondary btn-sm" onClick={reloadCameras}>รีเฟรชรายการ</button></div>
        <div className="card-body">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>ชื่อกล้อง</th><th>Zone</th><th>โหมด</th><th>URL / FTP</th><th>สถานะ</th><th></th></tr></thead>
              <tbody>
                {cameras.length === 0 ? (
                  <tr><td colSpan={6}><div className="empty-state"><Icon name="empty" /><div className="e-title">ยังไม่มีกล้อง</div><div className="e-desc">เพิ่มกล้องใหม่จากฟอร์มด้านบน</div></div></td></tr>
                ) : cameras.map((c) => (
                  <tr key={c.id}>
                    <td className="cell-strong">{c.name}</td>
                    <td className="cell-muted">{c.zone || '-'}</td>
                    <td><span className="badge badge-finished">{c.mode === 'ftp' ? 'FTP push' : 'RTSP'}</span></td>
                    <td className="cell-muted text-mono" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.mode === 'ftp' ? c.ftpUsername : c.url}>
                      {c.mode === 'ftp' ? `${c.ftpUsername} @ port ${ftpPort ?? '-'}` : c.url}
                    </td>
                    <td>{cameraStatusLabel(c.status)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {c.mode === 'ftp' ? (
                        <>
                          <button className="btn btn-secondary btn-sm" onClick={() => modal.open(<FtpCredentialsModalBody cam={c} ftpPort={ftpPort} onClose={modal.close} />)}>ดูค่า FTP</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => regenerateFtpPasswordFor(c)}>สร้าง password ใหม่</button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-secondary btn-sm" onClick={() => testSavedCamera(c.id)}>ทดสอบ</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => viewCameraSnapshotModal(c)}>ดูภาพ</button>
                        </>
                      )}
                      <button className="btn btn-secondary btn-sm" onClick={() => deleteCameraItem(c.id)}>ลบ</button>
                    </td>
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
