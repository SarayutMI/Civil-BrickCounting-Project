import { useEffect, useMemo, useState } from 'react';
import TaskLockControl, { TaskLockNotice, taskReadOnly } from '../components/TaskLockControl.jsx';
import Icon from '../icons/Icon.jsx';
import BentoItem from '../components/BentoItem.jsx';
import { TaskProductivityCard } from '../components/ProductivityReport.jsx';
import LabelEditor from '../components/LabelEditor.jsx';
import RoiCanvas from '../components/RoiCanvas.jsx';
import BBoxCanvas from '../components/BBoxCanvas.jsx';
import CameraStage, { IDENTITY_VIEW, normalizeView, sameView } from '../components/CameraStage.jsx';
import { StatusBadge, CameraBadge, workerName, pct } from '../utils.jsx';
import { useToast } from '../components/Toast.jsx';
import * as api from '../api.js';

const HISTORY_TABS = [
  ['hour', '1 ชม.ล่าสุด'],
  ['today', 'วันนี้'],
  ['7d', '7 วัน'],
  ['all', 'ทั้งหมด'],
];

function historyFromParam(period) {
  const now = new Date();
  if (period === 'hour') return new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  if (period === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.toISOString(); }
  if (period === '7d') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return null; // 'all'
}

/* ===================================================================
   TaskDetail — ported from app.js openTaskDetail()/paintTaskDetail()/
   refreshTaskLiveFields(). `task` is the live object from the shared
   central `tasks` state (kept fresh here via 2s polling); the form
   fields below are a separate local copy seeded once per taskId so
   the 2s poll never clobbers an in-progress edit — same split as the
   original (paintTaskDetail vs refreshTaskLiveFields).
=================================================================== */
export default function TaskDetail({ currentUser, taskId, task, brickTypes, workersMaster, cameras, reloadCameras, mergeTask, patchTaskRemote, onBack, onDeleted, onOpenTask, taskExists, reloadTasks }) {
  const toast = useToast();
  const readOnly = taskReadOnly(task, currentUser);

  // ---- Form state (seeded once per taskId; not touched by polling) ----
  const [name, setName] = useState('');
  const [zone, setZone] = useState('');
  const [brickType, setBrickType] = useState('');
  const [expectedArea, setExpectedArea] = useState(100);
  const [schedule, setSchedule] = useState({ start: '', breakStart: '', breakEnd: '', end: '' });
  const [confidence, setConfidence] = useState(75);
  const [snapshotInterval, setSnapshotInterval] = useState(30);
  const [roiPoints, setRoiPoints] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [workerSelectValue, setWorkerSelectValue] = useState('');
  const [streamKey, setStreamKey] = useState(0);
  const [cameraLiveState, setCameraLiveState] = useState('idle'); // idle|connecting|live|error
  const [ftpFrameUrl, setFtpFrameUrl] = useState(null);
  const [timelapseError, setTimelapseError] = useState(false);
  const [natural, setNatural] = useState(null); // {w,h} of the raw camera frame, learned from the <img> once it loads
  const [viewDraft, setViewDraft] = useState(IDENTITY_VIEW); // rotate/flip/perspective/straighten/zoom being edited (saved per camera)

  const [historyPeriod, setHistoryPeriod] = useState('today');
  const [labeling, setLabeling] = useState(false); // Human-in-the-loop label review screen
  const [historyList, setHistoryList] = useState([]);
  useEffect(() => { if (readOnly) setLabeling(false); }, [readOnly]);


  // Seed form state whenever we switch to a different task.
  useEffect(() => {
    if (!task) return;
    setName(task.name);
    setZone(task.zone);
    setBrickType(task.brickType);
    setExpectedArea(task.expectedArea);
    setSchedule(task.schedule || { start: '08:00', breakStart: '12:00', breakEnd: '13:00', end: '17:00' });
    setConfidence(task.confidence);
    setSnapshotInterval(task.snapshotInterval || 30);
    setRoiPoints((task.roi || []).map((p) => [...p]));
    const auto = task.copyOf ? '' : task.cameraId || (cameras.find((c) => c.zone && task.zone && c.zone.toLowerCase() === task.zone.toLowerCase())?.id) || '';
    setSelectedCameraId(auto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // ---- Live polling: GET /api/tasks/:id every 2s ----
  useEffect(() => {
    const id = setInterval(async () => {
      const fresh = await api.getTask(taskId);
      if (fresh) mergeTask(fresh);
    }, 2000);
    return () => clearInterval(id);
  }, [taskId, mergeTask]);

  // ---- Work time + PD: GET /api/tasks/:id/productivity every 60s ----
  const [prod, setProd] = useState(null);
  const [prodKey, setProdKey] = useState(0); // bump to reload now (e.g. after switching result source)
  useEffect(() => {
    let cancelled = false;
    const load = () => api.getTaskProductivity(taskId).then((p) => { if (!cancelled) setProd(p); });
    load();
    const id = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [taskId, prodKey]);
  useEffect(() => { setProd(null); }, [taskId]);

  // ---- History polling: GET /api/tasks/:id/history every 15s + on period change ----
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const from = historyFromParam(historyPeriod);
      const list = await api.getTaskHistory(taskId, from ? { from } : {});
      if (!cancelled) setHistoryList(list);
    }
    refresh();
    const id = setInterval(refresh, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, [taskId, historyPeriod]);

  // ---- Camera live-state reset on (re)connect ----
  useEffect(() => {
    setCameraLiveState(selectedCameraId ? 'connecting' : 'idle');
  }, [selectedCameraId, streamKey]);

  const selectedCamera = cameras.find((c) => c.id === selectedCameraId) || null;
  const isFtpCamera = selectedCamera?.mode === 'ftp';
  const timelapseVersion = useMemo(() => String(Date.now()), [task?.timelapseStatus]); // eslint-disable-line react-hooks/exhaustive-deps
  const savedView = normalizeView(selectedCamera?.view);
  const viewDirty = !sameView(viewDraft, savedView);
  const savedViewKey = JSON.stringify(savedView);
  useEffect(() => { setViewDraft(JSON.parse(savedViewKey)); setNatural(null); }, [selectedCameraId, savedViewKey]);

  const streamUrl = useMemo(
    () => (selectedCameraId && !isFtpCamera ? api.cameraStreamUrl(selectedCameraId, { fps: 6, width: 960 }) : null),
    [selectedCameraId, isFtpCamera, streamKey]
  );

  // ---- FTP-push camera: ไม่มี RTSP ให้ ffmpeg สตรีมสด — poll ภาพล่าสุดที่กล้อง push
  // เข้ามาแทน (เหมือนที่ /api/cameras/:id/snapshot เสิร์ฟให้ตั้งแต่ก่อนกด "เริ่มตรวจจับ")
  // preload ภาพใหม่ก่อนสลับ src จริง กันภาพกะพริบ/หลุดจอเวลา poll พลาดจังหวะ
  useEffect(() => {
    if (!selectedCameraId || !isFtpCamera) return undefined;
    let cancelled = false;
    function tick() {
      const url = api.cameraSnapshotUrl(selectedCameraId);
      const probe = new Image();
      probe.onload = () => {
        if (cancelled) return;
        setFtpFrameUrl(url);
        setCameraLiveState('live');
      };
      probe.onerror = () => {
        if (cancelled) return;
        setCameraLiveState((s) => (s === 'live' ? s : 'error'));
      };
      probe.src = url;
    }
    tick();
    const id = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [selectedCameraId, isFtpCamera, streamKey]);

  if (!task) return null;

  const bt = brickTypes.find((b) => b.id === task.brickType);
  const ratio = bt?.blocksPerSqm ?? null;

  function setTaskCamera(camId, silent) {
    setSelectedCameraId(camId);
    mergeTask({ ...task, cameraId: camId || null });
    patchTaskRemote(task.id, { cameraId: camId || null });
    if (!silent) toast('กำลังเชื่อมต่อกล้อง...');
  }

  function refreshTaskCamera() {
    if (selectedCameraId) setStreamKey((k) => k + 1);
    else toast('กรุณาเลือกกล้องก่อน');
  }

  function patchView(partial) { setViewDraft((v) => ({ ...v, ...partial })); }
  async function saveView() {
    if (readOnly) return;
    if (!selectedCameraId) return;
    if (task.roi && task.roi.length > 0 && !window.confirm('เปลี่ยนมุมภาพแล้ว ROI ที่วาดไว้ (ของทุก Task ที่ใช้กล้องนี้) จะไม่ตรงกับภาพใหม่ — ต้องวาด ROI ใหม่ ต้องการบันทึกต่อหรือไม่?')) return;
    const { ok, data } = await api.saveCameraView(selectedCameraId, viewDraft);
    if (ok) { await reloadCameras(); toast('บันทึกมุมภาพของกล้องแล้ว — ใช้กับทุก Task บนกล้องนี้ (รอบตรวจจับถัดไปเป็นต้นไป)', 'success'); }
    else toast(data.message || 'บันทึกมุมภาพไม่สำเร็จ');
  }

  function addWorkerToTask(wid) {
    if (readOnly) return;
    if (!wid) return;
    if (task.workers.includes(wid)) return;
    const workers = [...task.workers, wid];
    mergeTask({ ...task, workers });
    patchTaskRemote(task.id, { workers });
    toast('เพิ่มแรงงานเข้างานแล้ว');
    setWorkerSelectValue('');
  }
  function removeWorkerFromTask(wid) {
    if (readOnly) return;
    const workers = task.workers.filter((w) => w !== wid);
    mergeTask({ ...task, workers });
    patchTaskRemote(task.id, { workers });
    toast('นำแรงงานออกจากงานแล้ว');
  }

  async function saveTaskInfo() {
    if (readOnly) return;
    const partial = {
      name: name || task.name,
      zone: zone || task.zone,
      brickType,
      expectedArea: parseFloat(expectedArea) || task.expectedArea,
      schedule,
      confidence: parseInt(confidence, 10),
      snapshotInterval: parseInt(snapshotInterval, 10) || 30,
      roi: roiPoints.map((p) => [...p]),
    };
    const { ok, data } = await api.patchTask(task.id, partial);
    if (ok) {
      mergeTask(data);
      toast('บันทึกข้อมูล Task เรียบร้อยแล้ว (persist ลง tasks.json)', 'success');
    } else {
      toast(data.message || 'บันทึกไม่สำเร็จ');
    }
  }

  async function setTaskStatus(status) {
    if (readOnly) return;
    mergeTask({ ...task, status });
    const { ok, data } = await api.patchTask(task.id, { status });
    if (!ok) { toast(data.message || 'บันทึกสถานะไม่สำเร็จ'); return; }
    mergeTask(data);
    const label = { running: 'เริ่มตรวจจับแล้ว', pause: 'พักการตรวจจับแล้ว', finished: 'หยุดการตรวจจับแล้ว' };
    toast(label[status] || 'อัปเดตสถานะแล้ว', 'success');

  }

  function roiUndo() { setRoiPoints((pts) => pts.slice(0, -1)); }
  function roiClear() { setRoiPoints([]); toast('ลบพื้นที่ ROI แล้ว'); }
  function roiClose() {
    if (roiPoints.length < 3) { toast('ต้องมีอย่างน้อย 3 จุดเพื่อปิดพื้นที่'); return; }
    toast('ปิดพื้นที่ ROI แล้ว — อย่าลืมกด "บันทึก ROI" เพื่อ persist ค่านี้');
  }
  async function saveRoi() {
    if (readOnly) return;
    if (roiPoints.length > 0 && roiPoints.length < 3) {
      toast('ต้องมีอย่างน้อย 3 จุดเพื่อบันทึก ROI (หรือกด Clear ถ้าไม่ต้องการ ROI)');
      return;
    }
    const { ok, data } = await api.patchTask(task.id, { roi: roiPoints.map((p) => [...p]) });
    if (ok) { mergeTask(data); toast('บันทึก ROI แล้ว — ระบบจะใช้ตำแหน่งนี้นับรอบถัดไปทันที', 'success'); }
    else toast(data.message || 'บันทึก ROI ไม่สำเร็จ');
  }

  async function rebuildTimelapse() {
    if (readOnly) return;
    const { ok, data } = await api.buildTimelapse(task.id);
    toast(data.message || 'กำลังสร้างวิดีโอ...', ok ? 'success' : 'info');
    if (ok) mergeTask({ ...task, timelapseStatus: 'building' });
  }

  async function clearTaskData() {
    if (readOnly) return;
    const typed = window.prompt(`ล้างข้อมูลของ "${task.name}"?\nจะลบประวัติ ภาพ Label ที่ตรวจแก้ และไทม์แลปส์ของงานนี้ทั้งหมด แล้วรีเซ็ตพื้นที่/บล็อกเป็น 0 (ค่าตั้งของงานยังอยู่) — ย้อนกลับไม่ได้\n\nพิมพ์ชื่องานเพื่อยืนยัน:`);
    if (typed === null) return;
    const { ok, data } = await api.clearTaskData(task.id, typed);
    if (!ok) return toast(data.message || 'ล้างข้อมูลไม่สำเร็จ');
    toast(`ล้างข้อมูลแล้ว (ประวัติ ${data.clearedRows} แถว)`, 'success');
    mergeTask(data);
    setProdKey((k) => k + 1);
    await reloadTasks();
  }

  async function deleteTaskItem() {
    if (readOnly) return;
    if (!window.confirm('ยืนยันลบ Task นี้? การลบไม่สามารถย้อนกลับได้')) return;
    const { ok, data } = await api.deleteTask(task.id);
    if (ok) { toast('ลบ Task แล้ว', 'success'); await reloadTasks(); onDeleted(); }
    else toast(data.message || 'ลบ Task ไม่สำเร็จ');
  }

  const availableWorkers = workersMaster.filter((w) => !task.workers.includes(w.id));

  const cameraMock = (() => {
    if (!selectedCameraId) return <div>ยังไม่ได้เลือกกล้อง<br /><small>เลือก Source ด้านบนเพื่อดูภาพสด</small></div>;
    if (isFtpCamera && cameraLiveState === 'error') return <div>ยังไม่มีภาพจากกล้องนี้<br /><small>รอกล้อง (บอร์ด FTP push) ส่งภาพเข้ามาก่อน</small></div>;
    if (cameraLiveState === 'error') return <div>เชื่อมต่อสตรีมไม่สำเร็จ<br /><small>ลองกด "รีเฟรชภาพ" หรือตรวจสอบกล้อง</small></div>;
    return <div>{isFtpCamera ? 'กำลังรอภาพจากกล้อง...' : 'กำลังเชื่อมต่อสตรีม...'}</div>;
  })();
  const liveStateText = !selectedCameraId ? '' : cameraLiveState === 'live' ? '● LIVE' : cameraLiveState === 'error' ? '✕ ไม่สามารถเชื่อมต่อ' : 'กำลังเชื่อมต่อ...';
  const liveStateColor = cameraLiveState === 'live' ? 'var(--green)' : cameraLiveState === 'error' ? 'var(--danger)' : 'var(--muted)';

  const historyRows = historyList.slice().reverse();

  if (labeling && !readOnly) return <LabelEditor task={task} onClose={() => { setLabeling(false); setProdKey((k) => k + 1); }} onSourceChanged={(src) => mergeTask({ ...task, resultSource: src })}
    onTaskChanged={(nums) => mergeTask({ ...task, ...nums })} />;

  return (
    <div id="view-task-detail" className="view active">
      <div className="detail-back"><button className="btn btn-secondary" onClick={onBack}>← กลับ Tasks</button></div>
      <div className="section-head">
        <div><h2>Task Detail</h2><p><CameraBadge status={task.cameraStatus} /> <StatusBadge status={task.status} /> <span>อัปเดตล่าสุด {task.lastUpdate}</span></p></div>
        <div className="toolbar">
        <TaskLockControl task={task} currentUser={currentUser} onChanged={mergeTask} />
        <button disabled={readOnly} className={`btn ${task.status === 'finished' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setLabeling(true)}
          title="ตรวจแก้กรอบของ AI ในภาพที่บันทึกไว้ — ลบที่ทายผิด ตีกรอบอิฐที่ AI พลาด แล้วสรุปจำนวนใหม่">
          <Icon name="edit" /> ตรวจแก้ Label (Human-in-the-loop)
        </button>
        </div>
      </div>

      <TaskLockNotice task={task} currentUser={currentUser} />

      {task.copyOf && (
        <div className="copy-banner">
          <strong>งานสำเนา</strong> คัดลอกจาก "{task.copyOfName || 'งานต้นฉบับ'}" — ไว้ลองแก้ / ลองปรับ ไม่กระทบงานต้นฉบับ ·
          ไม่ผูกกล้อง ไม่เริ่ม/พักอัตโนมัติ และไม่นับรวมใน Productivity ทั้งโครงการ
          {taskExists(task.copyOf) && <button className="btn btn-ghost btn-sm" onClick={() => onOpenTask(task.copyOf)}>เปิดงานต้นฉบับ</button>}
        </div>
      )}

      <div id="tdBento" className="bento" style={{ marginBottom: 18 }}>
        <BentoItem icon={<Icon name="users" />} label="แรงงานที่มอบหมาย" value={task.workers.length + ' คน'} bg="var(--accent-tint)" fg="var(--accent)" />
        <BentoItem icon={<Icon name="users" />} label="คนที่ตรวจพบ (AI Real-time)" value={(task.peopleDetected || 0) + ' คน'} bg="var(--purple-tint)" fg="var(--purple)" />
        <BentoItem icon={<Icon name="area" />} label="พื้นที่ที่ตรวจจับได้" value={task.area + ' m²'} bg="var(--green-tint)" fg="var(--green)" />
        <BentoItem icon={<Icon name="percent" />} label="อัตราความสำเร็จ" value={pct(task.area, task.expectedArea) + '%'} bg="var(--amber-tint)" fg="var(--amber)" />
        <BentoItem icon={<Icon name="block" />} label="จำนวนบล็อกทั้งหมด" value={task.blocks.toLocaleString() + (ratio ? ` (×${ratio} m²)` : '')} bg="var(--gray-tint)" fg="var(--muted)" />
      </div>

      <TaskProductivityCard readOnly={readOnly} prod={prod} workerNames={task.workers.map((w) => workerName(workersMaster, w))}
        onSourceChanged={(src) => { mergeTask({ ...task, resultSource: src }); setProdKey((k) => k + 1); }} />

      <div className="detail-grid">
        <div className="card">
          <div className="card-head">
            <h3>Live Camera / ROI</h3>
            <div className="action-row">
              <button className="btn btn-secondary btn-sm" disabled={readOnly} onClick={roiUndo}>Undo</button>
              <button className="btn btn-secondary btn-sm" disabled={readOnly} onClick={roiClear}>Clear</button>
              <button className="btn btn-secondary btn-sm" disabled={readOnly} onClick={roiClose}>ปิด ROI</button>
              <button className="btn btn-primary btn-sm" disabled={readOnly} onClick={saveRoi}>บันทึก ROI</button>
            </div>
          </div>
          <fieldset className="card-body task-edit-fields" disabled={readOnly}>
            <div className="action-row" style={{ alignItems: 'center', marginBottom: 12, gap: 10 }}>
              <select className="input" style={{ maxWidth: 280 }} value={selectedCameraId} onChange={(e) => setTaskCamera(e.target.value)} disabled={!!task.copyOf} title={task.copyOf ? 'งานสำเนาผูกกล้องไม่ได้' : undefined}>
                <option value="">— ไม่เลือกกล้อง —</option>
                {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}{c.zone ? ' — ' + c.zone : ''}</option>)}
              </select>
              <button className="btn btn-secondary btn-sm" onClick={refreshTaskCamera}>รีเฟรชภาพ</button>
              <span style={{ fontSize: 12, color: liveStateColor }}>{liveStateText}</span>
            </div>
            {selectedCameraId && (
              <div className="view-tools">
                <span className="cell-muted" style={{ fontSize: 12 }}>มุมภาพ (ตั้งครั้งเดียวต่อกล้อง):</span>
                <button className="btn btn-secondary btn-sm" onClick={() => patchView({ rotate: (viewDraft.rotate + 270) % 360 })} title="หมุนซ้าย 90°">↺ 90°</button>
                <button className="btn btn-secondary btn-sm" onClick={() => patchView({ rotate: (viewDraft.rotate + 90) % 360 })} title="หมุนขวา 90°">↻ 90°</button>
                <button className="btn btn-secondary btn-sm" aria-pressed={viewDraft.flipH} onClick={() => patchView({ flipH: !viewDraft.flipH })}>⇄ พลิกซ้าย-ขวา</button>
                <button className="btn btn-secondary btn-sm" aria-pressed={viewDraft.flipV} onClick={() => patchView({ flipV: !viewDraft.flipV })}>⇅ พลิกบน-ล่าง</button>
                <label title="Roll / Straighten — หมุนละเอียดให้ภาพตั้งตรง (ขอบดำถูกครอปออกอัตโนมัติ)">Straighten
                  <input type="range" min="-45" max="45" step="0.1" value={viewDraft.straighten} onChange={(e) => patchView({ straighten: Math.round(Number(e.target.value) * 10) / 10 })} onDoubleClick={() => patchView({ straighten: 0 })} />
                  <span className="text-mono">{viewDraft.straighten.toFixed(1)}°</span>
                </label>
                <label title="Vertical perspective — ค่าบวกแก้ผนัง/เสาที่เอียงเข้าหากันด้านบน ค่าลบแก้ด้านล่าง">Vertical
                  <input type="range" min="-100" max="100" step="1" value={viewDraft.vertical} onChange={(e) => patchView({ vertical: Number(e.target.value) })} onDoubleClick={() => patchView({ vertical: 0 })} />
                  <span className="text-mono">{viewDraft.vertical}</span>
                </label>
                <label title="Horizontal perspective — ค่าบวกดึงขอบซ้ายเข้า ค่าลบดึงขอบขวาเข้า (แก้ภาพที่ถ่ายเฉียง)">Horizontal
                  <input type="range" min="-100" max="100" step="1" value={viewDraft.horizontal} onChange={(e) => patchView({ horizontal: Number(e.target.value) })} onDoubleClick={() => patchView({ horizontal: 0 })} />
                  <span className="text-mono">{viewDraft.horizontal}</span>
                </label>
                <label>ซูม
                  <input type="range" min="1" max="5" step="0.1" value={viewDraft.zoom} onChange={(e) => patchView({ zoom: Math.round(Number(e.target.value) * 10) / 10 })} />
                  <span className="text-mono">{viewDraft.zoom.toFixed(1)}×</span>
                </label>
                {viewDraft.zoom > 1 && (
                  <>
                    <label>เลื่อนซ้าย-ขวา <input type="range" min="0" max="1" step="0.01" value={viewDraft.cx} onChange={(e) => patchView({ cx: Number(e.target.value) })} /></label>
                    <label>เลื่อนบน-ล่าง <input type="range" min="0" max="1" step="0.01" value={viewDraft.cy} onChange={(e) => patchView({ cy: Number(e.target.value) })} /></label>
                  </>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => setViewDraft(IDENTITY_VIEW)}>รีเซ็ต</button>
                <button className="btn btn-primary btn-sm" disabled={!viewDirty} onClick={saveView}>{viewDirty ? 'บันทึกมุมภาพ' : 'บันทึกแล้ว'}</button>
              </div>
            )}
            <div className="camera-frame">
              <div className="camera-mock" style={{ display: cameraLiveState === 'live' ? 'none' : 'grid' }}>{cameraMock}</div>
              {selectedCameraId && (
                <CameraStage
                  view={viewDraft}
                  natural={natural}
                  image={(imgStyle) => {
                    const show = cameraLiveState === 'live';
                    const onSize = (e) => {
                      const w = e.target.naturalWidth, h = e.target.naturalHeight;
                      if (w && h) setNatural((n) => (n && n.w === w && n.h === h ? n : { w, h }));
                    };
                    if (!isFtpCamera) {
                      return <img style={{ ...imgStyle, display: show ? imgStyle.display : 'none' }} src={streamUrl} onLoad={(e) => { setCameraLiveState('live'); onSize(e); }} onError={() => setCameraLiveState('error')} alt="" />;
                    }
                    return ftpFrameUrl ? <img style={{ ...imgStyle, display: show ? imgStyle.display : 'none' }} src={ftpFrameUrl} onLoad={onSize} alt="" /> : null;
                  }}
                >
                  <RoiCanvas points={roiPoints} onAddPoint={(nx, ny) => { if (!readOnly) setRoiPoints((pts) => [...pts, [nx, ny]]); }} />
                  <BBoxCanvas lastDetection={task.lastDetection} />
                </CameraStage>
              )}
              <div className="camera-overlay"><span className="badge badge-live">AI CAMERA</span><span className="badge badge-finished">Click เพื่อวาด ROI</span></div>
              {task.imageLost && task.status === 'running' && (
                <div className="camera-loss" role="alert">
                  <div>
                    <strong>Loss data</strong>
                    ไม่ได้รับภาพจากกล้องนานเกินกำหนด
                    <small>ภาพล่าสุด {task.lastImageAt ? new Date(task.lastImageAt).toLocaleTimeString('th-TH', { hour12: false }) : 'ยังไม่เคยได้รับ'}</small>
                    <small>ระบบยังคงรอภาพและจะกลับมาทำงานเองเมื่อได้รับภาพอีกครั้ง</small>
                  </div>
                </div>
              )}
            </div>
            <p className="cell-muted" style={{ fontSize: 12, marginTop: 8 }}>
              ระบบตรวจจับต่อเนื่องอัตโนมัติ (realtime) ทันทีที่ Task อยู่สถานะ "กำลังดำเนินการ" มีกล้อง และวาด ROI แล้ว — ไม่ต้องกดปุ่มตรวจจับเอง<br />
              <span style={{ color: 'var(--green)' }}>■</span> เขียว = อิฐที่ AI ตรวจจับได้ทั้งหมด{' '}
              <span style={{ color: 'var(--accent)' }}>■</span> ฟ้า = bbox ที่นำมานับจริง (จุดกึ่งกลางอยู่ใน ROI){' '}
              <span style={{ color: 'var(--orange)' }}>■</span> ส้ม = คนที่โมเดลที่สองตรวจพบ (เส้นทึบ = อยู่ในโซนงาน, เส้นประ = นอกโซน)
            </p>
          </fieldset>
        </div>

        <div className="card">
          <div className="card-head"><h3>Task Information</h3></div>
          <fieldset className="card-body task-edit-fields" disabled={readOnly}>
            <div className="form-grid">
              <div className="form-group full"><label>ชื่องาน</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="form-group"><label>Zone</label><input className="input" value={zone} onChange={(e) => setZone(e.target.value)} /></div>
              <div className="form-group"><label>ประเภทอิฐ (Profile)</label>
                <select className="select" value={brickType} onChange={(e) => setBrickType(e.target.value)}>
                  {brickTypes.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.blocksPerSqm} ตร.ม./ก้อน</option>)}
                </select>
              </div>
              <div className="form-group"><label>เป้าหมายพื้นที่ (ตร.ม.)</label><input type="number" min="1" step="1" className="input" value={expectedArea} onChange={(e) => setExpectedArea(e.target.value)} /></div>
            </div>
            <div className="divider" />
            <div className="form-group">
              <label>แรงงานในงาน</label>
              <div id="tdWorkerPills">
                {task.workers.length === 0 ? <span className="cell-muted" style={{ fontSize: 13 }}>ยังไม่มีแรงงานในงานนี้</span> : task.workers.map((wid) => (
                  <span className="pill" key={wid}>{workerName(workersMaster, wid)} <button aria-label="ลบ" onClick={() => removeWorkerFromTask(wid)}><Icon name="x" /></button></span>
                ))}
              </div>
              <select className="select" value={workerSelectValue} onChange={(e) => addWorkerToTask(e.target.value)}>
                <option value="">+ เพิ่มแรงงาน...</option>
                {availableWorkers.map((w) => <option key={w.id} value={w.id}>{w.name} — {w.role}</option>)}
              </select>
            </div>
            <div className="divider" />
            <div className="form-grid">
              <div className="form-group"><label>เริ่มงาน</label><input type="time" className="input" value={schedule.start} onChange={(e) => setSchedule({ ...schedule, start: e.target.value })} /></div>
              <div className="form-group"><label>เลิกงาน</label><input type="time" className="input" value={schedule.end} onChange={(e) => setSchedule({ ...schedule, end: e.target.value })} /></div>
              <div className="form-group"><label>เริ่มพัก</label><input type="time" className="input" value={schedule.breakStart} onChange={(e) => setSchedule({ ...schedule, breakStart: e.target.value })} /></div>
              <div className="form-group"><label>จบพัก</label><input type="time" className="input" value={schedule.breakEnd} onChange={(e) => setSchedule({ ...schedule, breakEnd: e.target.value })} /></div>
            </div>
            <p className="cell-muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
              ระบบ <strong>เริ่ม / พัก / เลิกงานอัตโนมัติ</strong> ตามเวลานี้ (เวลาไทย): เริ่มงานและจบพัก = กำลังดำเนินการ, เริ่มพักและเลิกงาน = พัก
              {task.autoPhase ? ` — ตอนนี้อยู่ช่วง "${{ work: 'ทำงาน', break: 'พัก', off: 'นอกเวลางาน' }[task.autoPhase]}"` : ''}.
              กดพัก/เริ่มเองได้ ระบบจะสลับให้ใหม่เมื่อถึงเวลาถัดไป. สถานะ "เสร็จสิ้น" ต้องกดเองเท่านั้น. เว้นว่างไว้ = ไม่สลับอัตโนมัติ
            </p>
            <div className="divider" />
            <div className="form-grid">
              <div className="form-group">
                <label>AI Confidence <span>{confidence}%</span></label>
                <div className="range-row"><input type="range" min="50" max="99" value={confidence} onChange={(e) => setConfidence(e.target.value)} /><span className="text-mono">%</span></div>
              </div>
              <div className="form-group"><label>ความถี่ตรวจจับ (วินาที)</label><input type="number" min="1" step="1" className="input" value={snapshotInterval} onChange={(e) => setSnapshotInterval(e.target.value)} /></div>
            </div>
            <div className="divider" />
            <div className="action-row">
              <button className="btn btn-primary" disabled={task.status === 'running'} onClick={() => setTaskStatus('running')}>เริ่มตรวจจับ</button>
              <button className="btn btn-secondary" disabled={task.status !== 'running'} onClick={() => setTaskStatus('pause')}>พัก</button>
              <button className="btn btn-secondary" disabled={task.status === 'finished'} onClick={() => setTaskStatus('finished')}>หยุด</button>
              <button className="btn btn-secondary" onClick={saveTaskInfo}>บันทึก</button>
              <button className="btn btn-danger-outline" style={{ marginLeft: 'auto' }} disabled={task.status === 'running'} onClick={clearTaskData}
                title={task.status === 'running' ? 'หยุดหรือพักงานก่อน แล้วค่อยล้างข้อมูล' : 'ลบประวัติ ภาพ และ Label ของงานนี้ — ค่าตั้งของงานยังอยู่'}>Clear Data</button>
              <button className="btn btn-danger" onClick={deleteTaskItem}>ลบ Task</button>
            </div>
          </fieldset>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-head">
          <h3>Task History — ประวัติการตรวจจับตามช่วงเวลา</h3>
          <div className="tabs">
            {HISTORY_TABS.map(([key, label]) => (
              <button key={key} className={`tab-btn${historyPeriod === key ? ' active' : ''}`} onClick={() => setHistoryPeriod(key)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>เวลา</th><th>จำนวนบล็อก</th><th>พื้นที่</th><th>คนที่ตรวจพบ (AI)</th><th>แรงงานที่มอบหมาย</th></tr></thead>
            <tbody>
              {historyRows.length === 0 ? (
                <tr><td colSpan={5}><div className="empty-state"><Icon name="empty" /><div className="e-title">ยังไม่มีประวัติในช่วงเวลานี้</div><div className="e-desc">ระบบจะบันทึกทุก 1 นาที ขณะ Task อยู่สถานะ "กำลังดำเนินการ"</div></div></td></tr>
              ) : historyRows.map((e, i) => (
                <tr key={i}>
                  <td className="cell-muted">{new Date(e.at).toLocaleString('th-TH')}</td>
                  <td className="cell-strong">{e.blocks.toLocaleString()}</td>
                  <td className="cell-muted">{e.area} m²</td>
                  <td className="cell-muted">{e.peopleDetected || 0} คน</td>
                  <td className="cell-muted">{e.workersAssigned || 0} คน</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cell-muted" style={{ fontSize: 12, padding: '0 20px 16px' }}>บันทึก snapshot อัตโนมัติทุก 1 นาที ขณะ Task อยู่สถานะ "กำลังดำเนินการ" — persist ลง <code>taskHistory.json</code></p>
      </div>

      <div id="tdTimelapseCard" className="card" style={{ marginTop: 18 }}>
        <div className="card-head">
          <h3>Time-lapse{task.status === 'finished' ? ' — งานนี้เสร็จแล้ว' : ''}</h3>
          <div className="action-row">
            <button className="btn btn-secondary btn-sm" disabled={readOnly || task.timelapseStatus === 'building'} onClick={rebuildTimelapse}>
              {task.timelapseStatus === 'building' ? 'กำลังสร้าง...' : task.timelapseStatus ? 'สร้างใหม่' : 'สร้างไทม์แลปส์'}
            </button>
            {task.timelapseStatus === 'ready' && (
              <>
                <a className="btn btn-primary btn-sm" href={api.timelapseUrl(task.id, { format: 'mp4' })}>ดาวน์โหลด MP4</a>
                <a className="btn btn-primary btn-sm" href={api.timelapseUrl(task.id, { format: 'gif' })}>ดาวน์โหลด GIF</a>
              </>
            )}
          </div>
        </div>
        <div className="card-body">
          {task.timelapseStatus === 'ready' ? (
            <div>
              <video key={timelapseVersion} className="tl-video" controls loop muted playsInline preload="metadata"
                src={api.timelapseUrl(task.id, { format: 'mp4', inline: true, v: timelapseVersion })}
                onError={() => setTimelapseError(true)} onLoadedData={() => setTimelapseError(false)} />
              {timelapseError && <p className="cell-muted" style={{ fontSize: 12, marginTop: 8, color: 'var(--danger)' }}>เล่นวิดีโอไม่ได้ — ไฟล์อาจหายหรือเสีย กด "สร้างใหม่"</p>}
            </div>
          ) : (
            <div className="camera-frame" style={{ height: 200 }}>
              <div className="camera-mock"><div>
                {task.timelapseStatus === 'failed' ? 'สร้างไทม์แลปส์ไม่สำเร็จ — ดูสาเหตุในหน้า Logs แล้วกด "สร้างใหม่"'
                  : task.timelapseStatus === 'building' ? 'กำลังสร้างวิดีโอและ GIF...'
                  : 'ยังไม่ได้สร้างไทม์แลปส์ — กด "สร้างไทม์แลปส์" (ต่อจากภาพ snapshot ที่บันทึกทุก 1 นาที)'}
              </div></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
