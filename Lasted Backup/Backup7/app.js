/* ===================================================================
   CIVIL — AI Brick Construction Monitoring System
   Front-end prototype logic (mock data, no backend yet)
=================================================================== */

/* ---------------- ICONS (inline SVG, stroke=currentColor) ---------------- */
const ICON = {
  home:  `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/></svg>`,
  task:  `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 10h8M8 14h5"/></svg>`,
  dash:  `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V10M10 19V5M16 19v-7M22 19H2"/></svg>`,
  report:`<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>`,
  logs:  `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/></svg>`,
  gear:  `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14 2h-4l-.5 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.3-.9c.77.66 1.65 1.17 2.6 1.5L10 22h4l.5-2.4a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4-2-1.6z"/></svg>`,
  search:`<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`,
  bell:  `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 21h4"/></svg>`,
  plus:  `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/></svg>`,
  edit:  `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  play:  `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`,
  stop:  `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`,
  download:`<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 19h16"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12 5 5L20 6"/></svg>`,
  x:     `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  camera:`<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13.5" r="3.2"/></svg>`,
  users: `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 19c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5"/><circle cx="17.5" cy="8.5" r="2.6"/><path d="M15.8 13.6c2.9.4 5.2 2.3 5.2 5.4"/></svg>`,
  area:  `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8 10 4l10 5-6 4 6 4-10 5-10-5 6-4Z"/></svg>`,
  percent:`<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19 19 5"/><circle cx="7" cy="7" r="2.3"/><circle cx="17" cy="17" r="2.3"/></svg>`,
  block: `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h8v6H3zM13 9h8v6h-8z"/></svg>`,
  upload:`<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3m0 0 4 4m-4-4L8 7"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  chevron:`<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
  discord:`<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="4"/><circle cx="9" cy="12.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12.5" r="1.3" fill="currentColor" stroke="none"/></svg>`,
  empty: `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v16"/></svg>`,
};

/* ---------------- MOCK DATABASE ---------------- */
const DB = {
  brickTypes: [
    { id:'bt1', name:'อิฐบล็อก' },
    { id:'bt2', name:'อิฐมวลเบา' },
    { id:'bt3', name:'อิฐมอญ' },
  ],
  workersMaster: [
    { id:'w1', name:'สมชาย ใจดี', role:'ช่างก่อสร้าง' },
    { id:'w2', name:'ประยุทธ ทองแดง', role:'ช่างก่อสร้าง' },
    { id:'w3', name:'วิชัย รุ่งเรือง', role:'หัวหน้าช่าง' },
    { id:'w4', name:'อนุชา ศรีสุข', role:'ช่างก่อสร้าง' },
    { id:'w5', name:'มานพ พูลสวัสดิ์', role:'ช่างก่อสร้าง' },
    { id:'w6', name:'ธีระ วงศ์สกุล', role:'ช่างก่อสร้าง' },
  ],
  users: [
    { id:'u1', name:'Admin User', email:'admin@civil.co', role:'Admin' },
    { id:'u2', name:'วิศวกร กิจงาน', email:'engineer@civil.co', role:'Engineer' },
    { id:'u3', name:'ผู้บริหาร ดูงาน', email:'viewer@civil.co', role:'Viewer' },
  ],
  tasks: [], // โหลดจริงจาก backend ผ่าน loadTasks() — ดู /api/tasks
  logs: [
    { time:'2026-08-24 09:12', type:'camera', level:'info', message:'กล้อง Zone A1 เชื่อมต่อสำเร็จ' },
    { time:'2026-08-24 09:00', type:'task', level:'info', message:'เริ่มการตรวจจับ Task "อาคาร A ชั้น 1"' },
    { time:'2026-08-24 08:44', type:'snapshot', level:'info', message:'บันทึก Snapshot อัตโนมัติ Zone B1' },
    { time:'2026-08-24 08:20', type:'error', level:'error', message:'สูญเสียการเชื่อมต่อกล้อง Zone C2' },
    { time:'2026-08-24 08:05', type:'task', level:'warn', message:'พัก Task "อาคาร A ชั้น 2 — ผนังด้านทิศใต้"' },
    { time:'2026-08-23 17:02', type:'task', level:'info', message:'Task "อาคาร B ชั้น 2" เสร็จสิ้น 100%' },
    { time:'2026-08-23 16:40', type:'camera', level:'warn', message:'สัญญาณกล้อง Zone B2 ไม่เสถียร' },
    { time:'2026-08-23 12:00', type:'task', level:'info', message:'พักเที่ยง — หยุดตรวจจับชั่วคราวทุก Zone' },
    { time:'2026-08-23 08:15', type:'edit', level:'info', message:'แก้ไขพื้นที่ ROI ของ Zone A1' },
  ],
  alertConfig:{
    webhook:'', cameraOffline:true, serverOffline:true, aiStopped:true, internetDown:false, noImage:true
  },
  storage:{ usedGB:312, totalGB:500, snapshotCount:8420, autoDelete:true, retentionDays:60 },
  system:{ timezone:'Asia/Bangkok (GMT+7)', version:'v0.9.2-beta' },
};

let currentTaskId = null;
let roiPoints = [];
let roiDrawing = false;

/* ---------------- HELPERS ---------------- */
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const byId = (id) => DB.tasks.find(t => t.id === id);
const brickName = (id) => (DB.brickTypes.find(b => b.id===id) || {}).name || '—';
const workerName = (id) => (DB.workersMaster.find(w => w.id===id) || {}).name || '—';

/* ================= TASKS — BACKEND SYNC ================= */
// ดึงรายการ Task จริงจาก backend (persist ลง tasks.json ข้ามการรีสตาร์ท)
async function loadTasks(){
  try{
    const res = await fetch('/api/tasks');
    DB.tasks = await res.json();
  }catch(err){
    console.error('โหลด Task ไม่สำเร็จ', err);
    DB.tasks = [];
    toast('เชื่อมต่อ backend ไม่สำเร็จ — ไม่สามารถโหลด Task ได้');
  }
}
// ส่งการแก้ไขบางส่วนของ task กลับไป persist ที่ backend
async function patchTask(id, partial){
  try{
    const res = await fetch(`/api/tasks/${id}`, {
      method:'PUT',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(partial),
    });
    if(!res.ok){
      const data = await res.json().catch(()=>({}));
      toast(data.message || 'บันทึกไม่สำเร็จ');
      return null;
    }
    return await res.json();
  }catch(err){
    toast('เชื่อมต่อ backend ไม่สำเร็จ');
    return null;
  }
}
function openAddTaskModal(){
  const brickOpts = DB.brickTypes.map(b=>`<option value="${b.id}">${b.name}</option>`).join('');
  const camOpts = `<option value="">— ไม่เลือกกล้อง (เลือกทีหลังได้) —</option>` +
    CAMERAS.map(c=>`<option value="${c.id}">${c.name}${c.zone ? ' — '+c.zone : ''}</option>`).join('');
  openModal(`
    <div class="modal-header"><h3>เพิ่ม Task ใหม่</h3><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="form-group"><label>ชื่องาน</label><input id="newTaskName" class="input" placeholder="เช่น อาคาร A ชั้น 3"></div>
      <div class="form-group"><label>Zone</label><input id="newTaskZone" class="input" placeholder="เช่น Zone A3"></div>
      <div class="form-group"><label>ประเภทอิฐ</label><select id="newTaskBrickType" class="select">${brickOpts}</select></div>
      <div class="form-group"><label>เลือกกล้อง (Source)</label><select id="newTaskCamera" class="select">${camOpts}</select></div>
      <div class="form-group"><label>พื้นที่เป้าหมาย (m²)</label><input id="newTaskExpectedArea" type="number" class="input" value="100" min="1"></div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-secondary" onclick="closeModal()">ยกเลิก</button>
      <button id="submitNewTaskBtn" class="btn btn-primary" onclick="submitAddTask()">เพิ่ม Task</button>
    </div>
  `);
}
async function submitAddTask(){
  const name = $('#newTaskName')?.value.trim();
  const zone = $('#newTaskZone')?.value.trim();
  const brickType = $('#newTaskBrickType')?.value;
  const cameraId = $('#newTaskCamera')?.value || null;
  const expectedArea = parseInt($('#newTaskExpectedArea')?.value, 10) || 100;
  const btn = $('#submitNewTaskBtn');
  if(!name){ toast('กรุณากรอกชื่องาน'); return; }
  try{
    if(btn){ btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }
    const res = await fetch('/api/tasks', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ name, zone, brickType, cameraId, expectedArea }),
    });
    const data = await res.json();
    if(res.ok){
      toast('เพิ่ม Task สำเร็จ','success');
      closeModal();
      await loadTasks();
      renderTaskList();
      renderHome();
      openTaskDetail(data.id);
    } else {
      toast(data.message || 'เพิ่ม Task ไม่สำเร็จ');
    }
  }catch(err){
    toast('เชื่อมต่อ backend ไม่สำเร็จ');
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = 'เพิ่ม Task'; }
  }
}
async function deleteTaskItem(id){
  if(!confirm('ยืนยันลบ Task นี้? การลบไม่สามารถย้อนกลับได้')) return;
  try{
    const res = await fetch(`/api/tasks/${id}`, { method:'DELETE' });
    const data = await res.json();
    if(res.ok){
      toast('ลบ Task แล้ว','success');
      await loadTasks();
      backToTaskList();
    } else {
      toast(data.message || 'ลบ Task ไม่สำเร็จ');
    }
  }catch(err){
    toast('เชื่อมต่อ backend ไม่สำเร็จ');
  }
}

function statusBadge(status){
  const map = { running:['badge-running','กำลังดำเนินการ'], pause:['badge-pause','พัก'], finished:['badge-finished','เสร็จสิ้น'] };
  const [cls,label] = map[status] || ['badge-finished', status];
  return `<span class="badge ${cls}">${label}</span>`;
}
function cameraBadge(status){
  const map = { live:['badge-live','Live'], connecting:['badge-connecting','Connecting'], disconnect:['badge-disconnect','Disconnect'] };
  const [cls,label] = map[status] || ['badge-disconnect', status];
  return `<span class="badge ${cls}">${label}</span>`;
}
function toast(message, type='info'){
  const wrap = $('#toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${type==='success' ? ICON.check : ICON.bell}<span>${message}</span>`;
  wrap.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .3s ease'; setTimeout(()=>el.remove(),300); }, 2800);
}
function openModal(html){
  const overlay = $('#modalOverlay');
  $('#modalRoot').innerHTML = html;
  overlay.classList.add('open');
}
function closeModal(){ $('#modalOverlay').classList.remove('open'); }

/* ---------------- NAVIGATION ---------------- */
function setView(viewName){
  if(viewName!=='task') stopTaskCameraStream();
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`#view-${viewName}`).classList.add('active');
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view===viewName));
  const titles = { home:'Home', task:'Task', dashboard:'Dashboard', reports:'Reports', logs:'Logs', settings:'Settings' };
  $('#topbarTitle').textContent = titles[viewName] || viewName;
  $('#topbarCrumb').textContent = `CIVIL / ${titles[viewName] || viewName}`;
  document.querySelector('.sidebar').classList.remove('open');
  document.querySelector('.sidebar-scrim').classList.remove('open');
  if (viewName==='home') renderHome();
  if (viewName==='task') renderTaskList();
  if (viewName==='dashboard') renderDashboard();
  if (viewName==='reports') renderReports();
  if (viewName==='logs') renderLogs();
  if (viewName==='settings') { /* keep current settings tab */ }
  window.scrollTo({top:0, behavior:'instant'});
}

/* ================= HOME ================= */
function renderHome(){
  const t = DB.tasks;
  const totalTasks = t.length;
  const running = t.filter(x=>x.status==='running').length;
  const finished = t.filter(x=>x.status==='finished').length;
  const totalWorkers = new Set(t.flatMap(x=>x.workers)).size;
  const totalArea = t.reduce((s,x)=>s+x.area,0);
  const todaySuccess = Math.round(t.reduce((s,x)=>s+(x.area/x.expectedArea*100),0)/t.length);

  $('#homeStats').innerHTML = `
    ${statCard(ICON.task,'จำนวน Task ทั้งหมด', totalTasks)}
    ${statCard(ICON.play,'กำลังดำเนินการ', running)}
    ${statCard(ICON.check,'เสร็จสิ้นแล้ว', finished)}
    ${statCard(ICON.users,'แรงงานทั้งหมด', totalWorkers+' คน')}
    ${statCard(ICON.area,'พื้นที่ก่ออิฐรวม', totalArea+' m²')}
    ${statCard(ICON.percent,'ความสำเร็จวันนี้', todaySuccess+'%')}
  `;

  const runningTasks = t.filter(x=>x.status==='running');
  $('#homeRunningList').innerHTML = runningTasks.map(x=>`
    <div class="list-row">
      <div class="l-main">
        <div class="l-avatar">${x.zone.slice(-2)}</div>
        <div>
          <div class="l-name">${x.name}</div>
          <div class="l-sub">${x.zone} · ${brickName(x.brickType)} · ${x.workers.length} คน</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:14px;">
        <div style="width:120px;">
          <div class="progress-bar"><div class="fill" style="width:${Math.round(x.area/x.expectedArea*100)}%"></div></div>
        </div>
        <span class="cell-muted text-mono" style="font-size:12px;">${Math.round(x.area/x.expectedArea*100)}%</span>
        <button class="btn btn-secondary btn-sm" onclick="openTaskDetail('${x.id}')">ดู</button>
      </div>
    </div>
  `).join('') || `<div class="empty-state">${ICON.empty}<div class="e-title">ยังไม่มีงานที่กำลังดำเนินการ</div></div>`;
}
function statCard(icon,label,value){
  return `<div class="stat-card"><div class="stat-icon">${icon}</div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}

/* ================= TASK LIST ================= */
let taskFilter = 'all';
let taskSearch = '';
function renderTaskList(){
  $('#view-task-list').classList.add('active');
  $('#view-task-detail').classList.remove('active');
  const rows = DB.tasks.filter(t=>{
    const okStatus = taskFilter==='all' || t.status===taskFilter;
    const okSearch = t.name.toLowerCase().includes(taskSearch.toLowerCase()) || t.zone.toLowerCase().includes(taskSearch.toLowerCase());
    return okStatus && okSearch;
  });
  $('#taskTableBody').innerHTML = rows.map(t=>`
    <tr class="clickable" onclick="openTaskDetail('${t.id}')">
      <td class="cell-strong">${t.name}</td>
      <td class="cell-muted">${t.zone}</td>
      <td class="cell-muted">${brickName(t.brickType)}</td>
      <td class="cell-muted">${t.workers.length} คน</td>
      <td style="min-width:140px;">
        <div class="progress-bar"><div class="fill" style="width:${Math.round(t.area/t.expectedArea*100)}%"></div></div>
        <div class="cell-muted" style="font-size:11.5px; margin-top:4px;">${Math.round(t.area/t.expectedArea*100)}% · ${t.area}/${t.expectedArea} m²</div>
      </td>
      <td>${statusBadge(t.status)}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openTaskDetail('${t.id}')">ดูรายละเอียด</button></td>
    </tr>
  `).join('') || `<tr><td colspan="7"><div class="empty-state">${ICON.empty}<div class="e-title">ไม่พบ Task</div><div class="e-desc">ลองเปลี่ยนคำค้นหาหรือตัวกรอง</div></div></td></tr>`;
}

/* ================= TASK DETAIL ================= */
function openTaskDetail(id){
  currentTaskId = id;
  setView('task');
  $('#view-task-list').classList.remove('active');
  $('#view-task-detail').classList.add('active');
  paintTaskDetail();
}
function backToTaskList(){
  stopTaskCameraStream();
  $('#view-task-detail').classList.remove('active');
  $('#view-task-list').classList.add('active');
  renderTaskList();
}
function paintTaskDetail(){
  const t = byId(currentTaskId);
  if(!t) return;
  $('#topbarTitle').textContent = t.name;
  $('#topbarCrumb').textContent = `CIVIL / Task / ${t.zone}`;

  $('#tdCameraBadge').innerHTML = cameraBadge(t.cameraStatus);
  $('#tdStatusBadge').innerHTML = statusBadge(t.status);
  $('#tdUpdated').textContent = `อัปเดตล่าสุด ${t.lastUpdate}`;

  $('#tdBento').innerHTML = `
    ${bentoItem(ICON.users,'แรงงานที่ตรวจพบ', t.workers.length+' คน', 'var(--accent-tint)','var(--accent)')}
    ${bentoItem(ICON.area,'พื้นที่ที่ตรวจจับได้', t.area+' m²', 'var(--green-tint)','var(--green)')}
    ${bentoItem(ICON.percent,'อัตราความสำเร็จ', Math.round(t.area/t.expectedArea*100)+'%', 'var(--amber-tint)','var(--amber)')}
    ${bentoItem(ICON.block,'จำนวนบล็อกทั้งหมด', t.blocks.toLocaleString(), 'var(--gray-tint)','var(--muted)')}
  `;

  // Task info form
  $('#tiName').value = t.name;
  $('#tiZone').value = t.zone;
  $('#tiBrickType').innerHTML = DB.brickTypes.map(b=>`<option value="${b.id}" ${b.id===t.brickType?'selected':''}>${b.name}</option>`).join('');

  // Workers
  renderTaskWorkers(t);

  // Schedule
  $('#schStart').value = t.schedule.start;
  $('#schBreakStart').value = t.schedule.breakStart;
  $('#schBreakEnd').value = t.schedule.breakEnd;
  $('#schEnd').value = t.schedule.end;

  // AI setting
  $('#aiConfidence').value = t.confidence;
  $('#aiConfidenceVal').textContent = t.confidence + '%';
  $('#aiSnapshotInterval').value = t.snapshotInterval;

  // Action buttons state
  $('#actStart').disabled = t.status==='running';
  $('#actPause').disabled = t.status!=='running';
  $('#actStop').disabled = t.status==='finished';

  // ROI canvas
  roiPoints = (t.roi || []).map(p=>[...p]);
  drawROI();

  // Live camera binding
  populateTaskCameraSelect();
}
function bentoItem(icon,label,value,bg,fg){
  return `<div class="bento-item"><div><div class="b-label">${label}</div><div class="b-value">${value}</div></div><div class="b-icon" style="background:${bg}; color:${fg};">${icon}</div></div>`;
}
function renderTaskWorkers(t){
  $('#tdWorkerPills').innerHTML = t.workers.map(wid=>`
    <span class="pill">${workerName(wid)} <button onclick="removeWorkerFromTask('${wid}')" aria-label="ลบ">${ICON.x}</button></span>
  `).join('') || `<span class="cell-muted" style="font-size:13px;">ยังไม่มีแรงงานในงานนี้</span>`;
  const available = DB.workersMaster.filter(w=>!t.workers.includes(w.id));
  $('#tdWorkerSelect').innerHTML = `<option value="">+ เพิ่มแรงงาน...</option>` + available.map(w=>`<option value="${w.id}">${w.name} — ${w.role}</option>`).join('');
}
async function removeWorkerFromTask(wid){
  const t = byId(currentTaskId);
  t.workers = t.workers.filter(w=>w!==wid);
  renderTaskWorkers(t);
  await patchTask(t.id, { workers: t.workers });
  toast('นำแรงงานออกจากงานแล้ว');
}
async function addWorkerToTask(wid){
  if(!wid) return;
  const t = byId(currentTaskId);
  if(!t.workers.includes(wid)) t.workers.push(wid);
  renderTaskWorkers(t);
  $('#tdWorkerSelect').value = '';
  await patchTask(t.id, { workers: t.workers });
  toast('เพิ่มแรงงานเข้างานแล้ว');
}
async function saveTaskInfo(){
  const t = byId(currentTaskId);
  t.name = $('#tiName').value || t.name;
  t.zone = $('#tiZone').value || t.zone;
  t.brickType = $('#tiBrickType').value;
  t.schedule = {
    start:$('#schStart').value, breakStart:$('#schBreakStart').value,
    breakEnd:$('#schBreakEnd').value, end:$('#schEnd').value
  };
  t.confidence = parseInt($('#aiConfidence').value,10);
  t.snapshotInterval = parseInt($('#aiSnapshotInterval').value,10);
  t.roi = roiPoints.map(p=>[...p]);
  const saved = await patchTask(t.id, {
    name:t.name, zone:t.zone, brickType:t.brickType, schedule:t.schedule,
    confidence:t.confidence, snapshotInterval:t.snapshotInterval, roi:t.roi,
  });
  if(saved){
    toast('บันทึกข้อมูล Task เรียบร้อยแล้ว (persist ลง tasks.json)','success');
    $('#topbarTitle').textContent = t.name;
    renderTaskList();
  }
}
async function setTaskStatus(status){
  const t = byId(currentTaskId);
  t.status = status;
  $('#tdStatusBadge').innerHTML = statusBadge(t.status);
  $('#actStart').disabled = t.status==='running';
  $('#actPause').disabled = t.status!=='running';
  $('#actStop').disabled = t.status==='finished';
  await patchTask(t.id, { status });
  const label = { running:'เริ่มตรวจจับแล้ว', pause:'พักการตรวจจับแล้ว', finished:'หยุดการตรวจจับแล้ว' };
  toast(label[status] || 'อัปเดตสถานะแล้ว', 'success');
}

/* ---------------- ROI Canvas ---------------- */
function drawROI(){
  const canvas = $('#roiCanvas');
  if(!canvas) return;
  const wrap = canvas.closest('.camera-frame');
  const w = wrap.clientWidth, h = wrap.clientHeight;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,w,h);
  if(roiPoints.length===0) return;
  ctx.beginPath();
  roiPoints.forEach(([nx,ny],i)=>{
    const x = nx*w, y = ny*h;
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  if(roiPoints.length>2) ctx.closePath();
  ctx.fillStyle = 'rgba(0,113,227,0.18)';
  ctx.strokeStyle = '#0071E3';
  ctx.lineWidth = 2;
  if(roiPoints.length>2) ctx.fill();
  ctx.stroke();
  roiPoints.forEach(([nx,ny])=>{
    ctx.beginPath();
    ctx.arc(nx*w, ny*h, 4.5, 0, Math.PI*2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0071E3';
    ctx.stroke();
  });
}
function roiCanvasClick(e){
  const canvas = $('#roiCanvas');
  const rect = canvas.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  roiPoints.push([nx,ny]);
  drawROI();
}
function roiUndo(){ roiPoints.pop(); drawROI(); }
function roiClear(){ roiPoints = []; drawROI(); toast('ลบพื้นที่ ROI แล้ว'); }
function roiClose(){ if(roiPoints.length<3){ toast('ต้องมีอย่างน้อย 3 จุดเพื่อปิดพื้นที่'); return;} drawROI(); toast('ปิดพื้นที่ ROI แล้ว','success'); }

/* ================= DASHBOARD ================= */
function renderDashboard(){
  const select = $('#dashTaskSelect');
  select.innerHTML = DB.tasks.map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
  select.value = currentTaskId && byId(currentTaskId) ? currentTaskId : DB.tasks[0].id;
  paintDashboard(select.value);
}
function paintDashboard(taskId){
  const t = byId(taskId);
  if(!t) return;
  const pct = Math.round(t.area/t.expectedArea*100);
  $('#dashStats').innerHTML = `
    ${statCard(ICON.percent,'ความสำเร็จของงาน', pct+'%')}
    ${statCard(ICON.area,'พื้นที่เป้าหมาย', t.expectedArea+' m²')}
    ${statCard(ICON.check,'พื้นที่ที่ก่อเสร็จแล้ว', t.area+' m²')}
    ${statCard(ICON.users,'แรงงานที่ตรวจพบ', t.workers.length+' คน')}
  `;
  // Timeline
  const steps = ['เริ่มงาน','ตรวจจับ 25%','ตรวจจับ 50%','ตรวจจับ 75%','เสร็จสิ้น'];
  const activeStep = Math.min(4, Math.floor(pct/25));
  $('#dashTimeline').innerHTML = steps.map((s,i)=>`
    <div style="flex:1; text-align:center; position:relative;">
      <div style="width:12px;height:12px;border-radius:50%; margin:0 auto 8px; background:${i<=activeStep?'var(--accent)':'var(--divider-strong)'};"></div>
      <div style="font-size:11.5px; color:${i<=activeStep?'var(--text)':'var(--muted-2)'}; font-weight:${i<=activeStep?'600':'500'};">${s}</div>
    </div>
  `).join('');

  // Progress chart (flat line, no gradient)
  $('#dashChart').innerHTML = lineChartSVG(t.progressSeries, 'var(--accent)');

  // Snapshot gallery (mock)
  const shots = Array.from({length:8}, (_,i)=>({time:`08:${(i*30%60).toString().padStart(2,'0')}`}));
  $('#dashGallery').innerHTML = shots.map(s=>`
    <div class="gallery-item"><div class="g-mock"></div><div class="g-time">${s.time} · วันนี้</div></div>
  `).join('');

  // History table
  $('#dashHistoryBody').innerHTML = DB.tasks.map(x=>`
    <tr>
      <td class="cell-strong">${x.name}</td>
      <td class="cell-muted">${x.zone}</td>
      <td>${statusBadge(x.status)}</td>
      <td class="cell-muted">${Math.round(x.area/x.expectedArea*100)}%</td>
      <td class="cell-muted">${x.area} m²</td>
    </tr>
  `).join('');
}
function lineChartSVG(series, color){
  const W=640,H=180,pad=24;
  const max = Math.max(...series,100);
  const stepX = (W-pad*2)/(series.length-1);
  const pts = series.map((v,i)=>[pad+i*stepX, H-pad-(v/max)*(H-pad*2)]);
  const path = pts.map((p,i)=> (i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const area = path + ` L${pts[pts.length-1][0]},${H-pad} L${pts[0][0]},${H-pad} Z`;
  const dots = pts.map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${color}"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="var(--divider)" stroke-width="1"/>
    <path d="${area}" fill="${color}" opacity="0.08" stroke="none"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
  </svg>`;
}

/* ================= REPORTS ================= */
let reportTab = 'daily';
function setReportTab(tab){
  reportTab = tab;
  $$('#reportTabs .tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  renderReports();
}
function renderReports(){
  const rows = DB.tasks.map(t=>({
    name:t.name, zone:t.zone, worker: t.workers.map(workerName).join(', '),
    area:t.area, expected:t.expectedArea, pct: Math.round(t.area/t.expectedArea*100), status:t.status
  }));
  $('#reportTableBody').innerHTML = rows.map(r=>`
    <tr>
      <td class="cell-strong">${r.name}</td>
      <td class="cell-muted">${r.zone}</td>
      <td class="cell-muted">${r.worker}</td>
      <td class="cell-muted">${r.area} / ${r.expected} m²</td>
      <td class="cell-muted">${r.pct}%</td>
      <td>${statusBadge(r.status)}</td>
    </tr>
  `).join('');
  $('#reportChart').innerHTML = lineChartSVG(DB.tasks[0].progressSeries.map((v,i)=> v + i*3), 'var(--green)');
  $('#reportPeriodLabel').textContent = { daily:'รายวัน', weekly:'รายสัปดาห์', monthly:'รายเดือน', byTask:'ตามงาน', byWorker:'ตามแรงงาน' }[reportTab];
}
function exportCSV(){
  const rows = [['ชื่องาน','Zone','แรงงาน','พื้นที่ (m²)','เป้าหมาย (m²)','ความคืบหน้า (%)','สถานะ']];
  DB.tasks.forEach(t=> rows.push([t.name, t.zone, t.workers.map(workerName).join('/'), t.area, t.expectedArea, Math.round(t.area/t.expectedArea*100), t.status]));
  const csv = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  downloadBlob(csv, 'civil-report.csv', 'text/csv;charset=utf-8;');
  toast('ดาวน์โหลดไฟล์ CSV แล้ว','success');
}
function exportExcel(){
  const rows = DB.tasks.map(t=>`<tr><td>${t.name}</td><td>${t.zone}</td><td>${t.area}</td><td>${t.expectedArea}</td><td>${Math.round(t.area/t.expectedArea*100)}%</td><td>${t.status}</td></tr>`).join('');
  const html = `<table><tr><th>ชื่องาน</th><th>Zone</th><th>พื้นที่</th><th>เป้าหมาย</th><th>ความคืบหน้า</th><th>สถานะ</th></tr>${rows}</table>`;
  downloadBlob(html, 'civil-report.xls', 'application/vnd.ms-excel');
  toast('ดาวน์โหลดไฟล์ Excel แล้ว','success');
}
function exportPDF(){
  toast('กำลังเปิดหน้าต่างพิมพ์ / บันทึกเป็น PDF...');
  setTimeout(()=>window.print(), 400);
}
function downloadBlob(content, filename, mime){
  const blob = new Blob([content], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ================= LOGS ================= */
let logFilter = 'all';
let logSearch = '';
function renderLogs(){
  const typeLabel = { camera:'กล้อง', task:'Task', snapshot:'Snapshot', error:'Error', edit:'แก้ไข' };
  const rows = DB.logs.filter(l=>{
    const okType = logFilter==='all' || l.type===logFilter;
    const okSearch = l.message.toLowerCase().includes(logSearch.toLowerCase());
    return okType && okSearch;
  });
  $('#logsTableBody').innerHTML = rows.map(l=>`
    <tr>
      <td class="cell-muted text-mono" style="font-size:12px;">${l.time}</td>
      <td><span class="badge ${l.level==='error'?'badge-live':l.level==='warn'?'badge-pause':'badge-finished'}">${typeLabel[l.type]||l.type}</span></td>
      <td>${l.message}</td>
    </tr>
  `).join('') || `<tr><td colspan="3"><div class="empty-state">${ICON.empty}<div class="e-title">ไม่พบ Log</div></div></td></tr>`;
}

/* ================= SETTINGS ================= */
function setSettingsTab(tab){
  $$('.settings-nav button').forEach(b=>b.classList.toggle('active', b.dataset.stab===tab));
  $$('.settings-panel').forEach(p=>p.classList.toggle('active', p.id==='panel-'+tab));
  if(tab==='worker') renderSettingsWorkers();
  if(tab==='brick') renderSettingsBrickTypes();
  if(tab==='users') renderSettingsUsers();
}
function renderSettingsWorkers(){
  $('#workerListBody').innerHTML = DB.workersMaster.map(w=>`
    <div class="list-row">
      <div class="l-main">
        <div class="l-avatar">${w.name.slice(0,1)}</div>
        <div><div class="l-name">${w.name}</div><div class="l-sub">${w.role}</div></div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="removeWorkerMaster('${w.id}')">${ICON.trash}</button>
    </div>
  `).join('');
}
function addWorkerMaster(){
  const name = $('#newWorkerName').value.trim();
  const role = $('#newWorkerRole').value.trim() || 'ช่างก่อสร้าง';
  if(!name){ toast('กรุณากรอกชื่อแรงงาน'); return; }
  DB.workersMaster.push({ id:'w'+Date.now(), name, role });
  $('#newWorkerName').value=''; $('#newWorkerRole').value='';
  renderSettingsWorkers();
  toast('เพิ่มแรงงานเรียบร้อยแล้ว','success');
}
function removeWorkerMaster(id){
  DB.workersMaster = DB.workersMaster.filter(w=>w.id!==id);
  DB.tasks.forEach(t=> t.workers = t.workers.filter(w=>w!==id));
  renderSettingsWorkers();
  toast('ลบแรงงานแล้ว');
}
function renderSettingsBrickTypes(){
  $('#brickListBody').innerHTML = DB.brickTypes.map(b=>`
    <span class="pill">${b.name} <button onclick="removeBrickType('${b.id}')">${ICON.x}</button></span>
  `).join('');
}
function addBrickType(){
  const name = $('#newBrickName').value.trim();
  if(!name){ toast('กรุณากรอกชื่อประเภทอิฐ'); return; }
  DB.brickTypes.push({ id:'bt'+Date.now(), name });
  $('#newBrickName').value='';
  renderSettingsBrickTypes();
  toast('เพิ่มประเภทอิฐเรียบร้อยแล้ว','success');
}
function removeBrickType(id){
  DB.brickTypes = DB.brickTypes.filter(b=>b.id!==id);
  renderSettingsBrickTypes();
  toast('ลบประเภทอิฐแล้ว');
}
function renderSettingsUsers(){
  $('#usersTableBody').innerHTML = DB.users.map(u=>`
    <tr>
      <td class="cell-strong">${u.name}</td>
      <td class="cell-muted">${u.email}</td>
      <td><span class="badge badge-role">${u.role}</span></td>
      <td><button class="btn btn-ghost btn-sm" onclick="removeUser('${u.id}')">${ICON.trash}</button></td>
    </tr>
  `).join('');
}
function removeUser(id){
  DB.users = DB.users.filter(u=>u.id!==id);
  renderSettingsUsers();
  toast('ลบผู้ใช้งานแล้ว');
}
function openAddUserModal(){
  openModal(`
    <div class="modal-header"><h3>เพิ่มผู้ใช้งานใหม่</h3><button class="modal-close" onclick="closeModal()">${ICON.x}</button></div>
    <div class="modal-body">
      <div class="form-group"><label>ชื่อ-นามสกุล</label><input id="muName" class="input" placeholder="เช่น สมหญิง ใจงาม"></div>
      <div class="form-group"><label>อีเมล</label><input id="muEmail" class="input" placeholder="name@company.com"></div>
      <div class="form-group"><label>สิทธิ์การใช้งาน</label>
        <select id="muRole" class="select">
          <option>Admin</option><option>Engineer</option><option selected>Viewer</option>
        </select>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-secondary" onclick="closeModal()">ยกเลิก</button>
      <button class="btn btn-primary" onclick="confirmAddUser()">เพิ่มผู้ใช้งาน</button>
    </div>
  `);
}
function confirmAddUser(){
  const name = $('#muName').value.trim();
  const email = $('#muEmail').value.trim();
  const role = $('#muRole').value;
  if(!name || !email){ toast('กรุณากรอกข้อมูลให้ครบถ้วน'); return; }
  DB.users.push({ id:'u'+Date.now(), name, email, role });
  closeModal();
  renderSettingsUsers();
  toast('เพิ่มผู้ใช้งานเรียบร้อยแล้ว','success');
}
async function testCameraConnection(){
  const urlInput = $('#cameraUrlInput');
  const btn = $('#testCameraBtn');
  const resultEl = $('#cameraTestResult');
  const detailEl = $('#cameraTestDetail');
  const url = urlInput ? urlInput.value.trim() : '';

  if(detailEl){ detailEl.style.display = 'none'; detailEl.textContent = ''; }
  if(resultEl){ resultEl.textContent = ''; resultEl.style.color = 'var(--muted)'; }

  if(!url){
    toast('กรุณากรอก Camera URL ก่อนทดสอบ');
    urlInput?.focus();
    return;
  }
  if(!/^rtsps?:\/\/\S+$/i.test(url)){
    toast('รูปแบบ URL ไม่ถูกต้อง ต้องขึ้นต้นด้วย rtsp:// หรือ rtsps://');
    urlInput?.focus();
    return;
  }

  toast('กำลังทดสอบการเชื่อมต่อกล้อง...');
  if(btn){ btn.disabled = true; btn.textContent = 'กำลังทดสอบ...'; }
  if(resultEl) resultEl.textContent = 'กำลังเชื่อมต่อไปยังกล้อง...';

  try{
    const res = await fetch('/api/test-rtsp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, timeoutMs: 8000 })
    });
    const data = await res.json();

    if(data.success){
      toast(data.message || 'เชื่อมต่อกล้องสำเร็จ', 'success');
      if(resultEl){ resultEl.textContent = '✓ เชื่อมต่อสำเร็จ'; resultEl.style.color = 'var(--green)'; }
      if(detailEl && data.stream){
        const s = data.stream;
        detailEl.style.display = 'block';
        detailEl.textContent = `Codec: ${s.codec_name || '-'} | ความละเอียด: ${s.width || '-'}x${s.height || '-'} | FPS: ${s.avg_frame_rate || '-'}`;
      }
    } else {
      toast(data.message || 'เชื่อมต่อกล้องไม่สำเร็จ', 'error');
      if(resultEl){ resultEl.textContent = '✕ เชื่อมต่อไม่สำเร็จ'; resultEl.style.color = 'var(--danger)'; }
      if(detailEl && data.raw){
        detailEl.style.display = 'block';
        detailEl.textContent = data.raw;
      }
    }
  } catch(err){
    toast('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้ (backend ไม่ทำงาน หรือเครือข่ายมีปัญหา)', 'error');
    if(resultEl){ resultEl.textContent = '✕ ไม่สามารถติดต่อเซิร์ฟเวอร์ได้'; resultEl.style.color = 'var(--danger)'; }
    if(detailEl){
      detailEl.style.display = 'block';
      detailEl.textContent = String(err.message || err);
    }
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = 'ทดสอบการเชื่อมต่อ'; }
  }
}
/* ================= CAMERA SOURCES (real backend) ================= */
let CAMERAS = [];        // list loaded from backend
let currentTaskCameraId = null; // camera currently shown in task-detail live view

function cameraStatusLabel(status){
  return { live:'🟢 Live', disconnect:'🔴 ขาดการเชื่อมต่อ', unknown:'⚪ ยังไม่ทดสอบ' }[status] || '⚪ ยังไม่ทดสอบ';
}

async function loadCameraList(){
  try{
    const res = await fetch('/api/cameras');
    CAMERAS = await res.json();
  }catch(err){
    CAMERAS = [];
    toast('ไม่สามารถโหลดรายการกล้องได้ (เช็คว่า backend ทำงานอยู่)','error');
  }
  renderCameraSettingsList();
  populateTaskCameraSelect();
}

function renderCameraSettingsList(){
  const body = $('#cameraListBody');
  if(!body) return;
  if(!CAMERAS.length){
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state">${ICON.empty}<div class="e-title">ยังไม่มีกล้อง</div><div class="e-desc">เพิ่มกล้องใหม่จากฟอร์มด้านบน</div></div></td></tr>`;
    return;
  }
  body.innerHTML = CAMERAS.map(c => `
    <tr>
      <td class="cell-strong">${c.name}</td>
      <td class="cell-muted">${c.zone || '-'}</td>
      <td class="cell-muted text-mono" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${c.url}">${c.url}</td>
      <td id="camStatus-${c.id}">${cameraStatusLabel(c.status)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-secondary btn-sm" onclick="testSavedCamera('${c.id}')">ทดสอบ</button>
        <button class="btn btn-secondary btn-sm" onclick="viewCameraSnapshotModal('${c.id}')">ดูภาพ</button>
        <button class="btn btn-secondary btn-sm" onclick="deleteCameraItem('${c.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');
}

async function submitAddCamera(){
  const name = $('#cameraNameInput')?.value.trim();
  const zone = $('#cameraZoneInput')?.value.trim();
  const url = $('#cameraUrlInput')?.value.trim();
  const btn = $('#saveCameraBtn');

  if(!name || !url){
    toast('กรุณากรอกชื่อกล้องและ Camera URL');
    return;
  }
  if(!/^rtsps?:\/\/\S+$/i.test(url)){
    toast('รูปแบบ URL ไม่ถูกต้อง ต้องขึ้นต้นด้วย rtsp:// หรือ rtsps://');
    return;
  }

  if(btn){ btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }
  try{
    const res = await fetch('/api/cameras', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, zone, url })
    });
    const data = await res.json();
    if(res.ok){
      toast('เพิ่มกล้องเรียบร้อยแล้ว','success');
      $('#cameraNameInput').value = '';
      $('#cameraZoneInput').value = '';
      $('#cameraUrlInput').value = '';
      await loadCameraList();
    } else {
      toast(data.message || 'เพิ่มกล้องไม่สำเร็จ','error');
    }
  }catch(err){
    toast('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้','error');
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = '+ บันทึกกล้องนี้'; }
  }
}

async function deleteCameraItem(id){
  if(!confirm('ลบกล้องนี้ใช่หรือไม่?')) return;
  try{
    const res = await fetch(`/api/cameras/${id}`, { method:'DELETE' });
    if(res.ok){
      toast('ลบกล้องแล้ว','success');
      await loadCameraList();
    } else {
      const data = await res.json();
      toast(data.message || 'ลบไม่สำเร็จ','error');
    }
  }catch(err){
    toast('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้','error');
  }
}

async function testSavedCamera(id){
  const cell = $(`#camStatus-${id}`);
  if(cell) cell.textContent = 'กำลังทดสอบ...';
  try{
    const res = await fetch(`/api/cameras/${id}/test`, { method:'POST' });
    const data = await res.json();
    const cam = CAMERAS.find(c=>c.id===id);
    if(cam && data.camera) cam.status = data.camera.status;
    if(cell) cell.textContent = cameraStatusLabel(cam?.status);
    toast(data.message || (data.success ? 'เชื่อมต่อสำเร็จ' : 'เชื่อมต่อไม่สำเร็จ'), data.success ? 'success' : 'error');
  }catch(err){
    if(cell) cell.textContent = cameraStatusLabel('disconnect');
    toast('ไม่สามารถติดต่อเซิร์ฟเวอร์ได้','error');
  }
}

function viewCameraSnapshotModal(id){
  const cam = CAMERAS.find(c=>c.id===id);
  if(!cam) return;
  openModal(`
    <div class="modal-head"><h3>ภาพจากกล้อง: ${cam.name}</h3><button class="modal-close" onclick="closeModal()">${ICON.x}</button></div>
    <div class="modal-body">
      <div class="camera-frame" style="height:320px">
        <img id="modalSnapshotImg" class="camera-img" style="display:none">
        <div class="camera-mock" id="modalSnapshotMock"><div>กำลังดึงภาพ...</div></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-secondary" onclick="closeModal()">ปิด</button>
      <button class="btn btn-primary" onclick="loadModalSnapshot('${cam.id}')">ดึงภาพใหม่</button>
    </div>
  `);
  loadModalSnapshot(cam.id);
}
function loadModalSnapshot(id){
  const img = $('#modalSnapshotImg');
  const mock = $('#modalSnapshotMock');
  if(!img) return;
  mock.style.display = 'grid';
  mock.innerHTML = '<div>กำลังดึงภาพ...</div>';
  img.style.display = 'none';
  const testImg = new Image();
  testImg.onload = () => {
    img.src = testImg.src;
    img.style.display = 'block';
    mock.style.display = 'none';
  };
  testImg.onerror = () => {
    mock.innerHTML = '<div>ดึงภาพไม่สำเร็จ<br><small>ตรวจสอบการเชื่อมต่อกล้อง</small></div>';
  };
  testImg.src = `/api/cameras/${id}/snapshot?_=${Date.now()}`;
}

async function previewAdHocSnapshot(){
  const url = $('#cameraUrlInput')?.value.trim();
  const wrap = $('#cameraPreviewWrap');
  const img = $('#cameraPreviewImg');
  const mock = $('#cameraPreviewMock');
  if(!url){ toast('กรุณากรอก Camera URL ก่อน'); return; }
  if(!/^rtsps?:\/\/\S+$/i.test(url)){ toast('รูปแบบ URL ไม่ถูกต้อง'); return; }

  wrap.style.display = 'block';
  mock.style.display = 'grid';
  mock.innerHTML = '<div>กำลังดึงภาพตัวอย่าง...</div>';
  img.style.display = 'none';

  const testImg = new Image();
  testImg.onload = () => {
    img.src = testImg.src;
    img.style.display = 'block';
    mock.style.display = 'none';
  };
  testImg.onerror = () => {
    mock.innerHTML = '<div>ดึงภาพไม่สำเร็จ<br><small>ตรวจสอบ URL และเครือข่าย</small></div>';
  };
  testImg.src = `/api/snapshot?url=${encodeURIComponent(url)}&_=${Date.now()}`;
}

/* ---------- Task-detail live camera binding ---------- */
function populateTaskCameraSelect(){
  const sel = $('#tdCameraSelect');
  if(!sel) return;
  sel.innerHTML = `<option value="">— ไม่เลือกกล้อง —</option>` +
    CAMERAS.map(c=>`<option value="${c.id}">${c.name}${c.zone ? ' — '+c.zone : ''}</option>`).join('');

  const t = byId(currentTaskId);
  if(t){
    const auto = t.cameraId || (CAMERAS.find(c=> c.zone && t.zone && c.zone.toLowerCase()===t.zone.toLowerCase())?.id) || '';
    sel.value = auto;
    setTaskCamera(auto, /*silent*/true);
  }
}

function stopTaskCameraStream(){
  const img = $('#tdCameraImg');
  if(img){ img.src=''; img.style.display='none'; }
  currentTaskCameraId = null;
}

function setTaskCamera(camId, silent){
  const t = byId(currentTaskId);
  if(t){
    t.cameraId = camId || null;
    patchTask(t.id, { cameraId: t.cameraId }); // persist Source ที่เลือกไว้ให้ Task นี้
  }

  const img = $('#tdCameraImg');
  const mock = $('#tdCameraMock');
  const stateEl = $('#tdCameraLiveState');

  if(!camId){
    stopTaskCameraStream();
    if(mock){ mock.style.display='grid'; mock.innerHTML = '<div>ยังไม่ได้เลือกกล้อง<br><small>เลือก Source ด้านบนเพื่อดูภาพสด</small></div>'; }
    if(stateEl) stateEl.textContent = '';
    return;
  }

  currentTaskCameraId = camId;
  if(stateEl) stateEl.textContent = 'กำลังเชื่อมต่อ...';
  if(mock){ mock.style.display='grid'; mock.innerHTML = '<div>กำลังเชื่อมต่อสตรีม...</div>'; }
  if(img){
    img.style.display = 'none';
    img.onload = () => { mock.style.display='none'; img.style.display='block'; if(stateEl) stateEl.textContent='● LIVE'; if(stateEl) stateEl.style.color='var(--green)'; };
    img.onerror = () => { mock.style.display='grid'; mock.innerHTML = '<div>เชื่อมต่อสตรีมไม่สำเร็จ<br><small>ลองกด "รีเฟรชภาพ" หรือตรวจสอบกล้อง</small></div>'; img.style.display='none'; if(stateEl) stateEl.textContent='✕ ไม่สามารถเชื่อมต่อ'; if(stateEl) stateEl.style.color='var(--danger)'; };
    img.src = `/api/cameras/${camId}/stream?fps=6&width=960&_=${Date.now()}`;
  }
  if(!silent) toast('กำลังเชื่อมต่อกล้อง...');
}

function refreshTaskCamera(){
  if(currentTaskCameraId){
    setTaskCamera(currentTaskCameraId);
  } else {
    toast('กรุณาเลือกกล้องก่อน');
  }
}

function testAlert(){
  toast('กำลังส่งการแจ้งเตือนทดสอบไปยัง Discord...');
  setTimeout(()=> toast('ส่งการแจ้งเตือนทดสอบสำเร็จ','success'), 1000);
}
function runBackup(){
  toast('กำลังสำรองข้อมูลระบบ...');
  setTimeout(()=> toast('สำรองข้อมูลสำเร็จแล้ว','success'), 1400);
}

/* ================= INIT ================= */
document.addEventListener('DOMContentLoaded', async () => {
  // Sidebar nav
  $$('.nav-item').forEach(item=>{
    item.addEventListener('click', ()=> setView(item.dataset.view));
  });
  // Mobile menu
  $('#mobileMenuBtn')?.addEventListener('click', ()=>{
    $('.sidebar').classList.add('open');
    $('.sidebar-scrim').classList.add('open');
  });
  $('.sidebar-scrim')?.addEventListener('click', ()=>{
    $('.sidebar').classList.remove('open');
    $('.sidebar-scrim').classList.remove('open');
  });

  // Task list filters
  $('#taskSearchInput')?.addEventListener('input', e=>{ taskSearch = e.target.value; renderTaskList(); });
  $$('.task-filter-btn').forEach(b=> b.addEventListener('click', ()=>{
    taskFilter = b.dataset.filter;
    $$('.task-filter-btn').forEach(x=>x.classList.toggle('active', x===b));
    renderTaskList();
  }));

  // ROI canvas events
  $('#roiCanvas')?.addEventListener('click', roiCanvasClick);
  window.addEventListener('resize', ()=>{ if($('#view-task-detail').classList.contains('active')) drawROI(); });

  // AI confidence slider live label
  $('#aiConfidence')?.addEventListener('input', e=>{ $('#aiConfidenceVal').textContent = e.target.value + '%'; });

  // Dashboard task switcher
  $('#dashTaskSelect')?.addEventListener('change', e=> paintDashboard(e.target.value));

  // Logs filter/search
  $('#logSearchInput')?.addEventListener('input', e=>{ logSearch = e.target.value; renderLogs(); });
  $('#logTypeFilter')?.addEventListener('change', e=>{ logFilter = e.target.value; renderLogs(); });

  // Worker select add
  $('#tdWorkerSelect')?.addEventListener('change', e=> addWorkerToTask(e.target.value));

  // Modal overlay click outside
  $('#modalOverlay')?.addEventListener('click', e=>{ if(e.target.id==='modalOverlay') closeModal(); });

  // Storage auto-delete toggle label
  $('#storageAutoDelete')?.addEventListener('change', e=>{
    toast(e.target.checked ? 'เปิดใช้งานลบข้อมูลอัตโนมัติแล้ว' : 'ปิดใช้งานลบข้อมูลอัตโนมัติแล้ว');
  });

  // โหลดกล้อง (สำหรับ dropdown เลือก Source) ก่อน แล้วค่อยโหลด Task
  // เพราะตอน render Task list/detail ต้องใช้ CAMERAS ประกอบ dropdown ให้ครบ
  await loadCameraList();
  await loadTasks();

  setView('home');
  setSettingsTab('camera');
});