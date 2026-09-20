import { useCallback, useEffect, useMemo, useState } from 'react';
import { ToastProvider, useToast } from './components/Toast.jsx';
import { ModalProvider } from './components/ModalProvider.jsx';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import Login from './views/Login.jsx';
import Home from './views/Home.jsx';
import Task from './views/Task.jsx';
import Dashboard from './views/Dashboard.jsx';
import Reports from './views/Reports.jsx';
import Logs from './views/Logs.jsx';
import Settings from './views/Settings.jsx';
import * as api from './api.js';

const TITLES = { home: 'Home', task: 'Task', dashboard: 'Dashboard', reports: 'Reports', logs: 'Logs', settings: 'Settings' };
function allPermsTrue() {
  return { home: true, task: true, dashboard: true, reports: true, logs: true, settings: true };
}

/* ===================================================================
   App — top-level view-state model, ported from app.js's single
   `view` string (home/task/dashboard/reports/logs/settings) plus the
   task view's list/detail sub-state and settings' 8 sub-tabs. One
   central `tasks`/`brickTypes`/etc. state set (mirrors the original's
   DB object) is held here and passed down via props.
=================================================================== */
export default function App() {
  // undefined = still asking the server, null = not signed in. The session lives in an HttpOnly
  // cookie on the server (table sessions) — the browser keeps no user object or token itself.
  const [currentUser, setCurrentUser] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    api.me().then((u) => { if (!cancelled) setCurrentUser(u); });
    const onUnauthorized = () => setCurrentUser(null);
    window.addEventListener('civil:unauthorized', onUnauthorized);
    return () => { cancelled = true; window.removeEventListener('civil:unauthorized', onUnauthorized); };
  }, []);

  async function handleLogout() {
    await api.logout();
    setCurrentUser(null);
  }

  return (
    <ToastProvider>
      <ModalProvider>
        {currentUser === undefined ? null
          : !currentUser ? <Login onLogin={setCurrentUser} />
          : <Shell user={currentUser} onLogout={handleLogout} />}
      </ModalProvider>
    </ToastProvider>
  );
}

function Shell({ user, onLogout }) {
  const toast = useToast();

  // ---- view-state model ----
  const [view, setViewRaw] = useState('home');
  const [taskSubView, setTaskSubView] = useState('list');
  const [currentTaskId, setCurrentTaskId] = useState(null);
  const [taskFilter, setTaskFilter] = useState('all');
  const [taskSearch, setTaskSearch] = useState('');
  const [settingsTab, setSettingsTab] = useState('camera');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ---- central app-data (mirrors the original's DB object) ----
  const [tasks, setTasks] = useState([]);
  const [brickTypes, setBrickTypes] = useState([]);
  const [workersMaster, setWorkersMaster] = useState([]);
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [cameras, setCameras] = useState([]);

  const reloadTasks = useCallback(async () => setTasks(await api.getTasks()), []);
  const reloadBrickTypes = useCallback(async () => setBrickTypes(await api.getBrickTypes()), []);
  const reloadWorkers = useCallback(async () => setWorkersMaster(await api.getWorkers()), []);
  const reloadUsers = useCallback(async () => setUsers(await api.getUsers()), []);
  const reloadRoles = useCallback(async () => setRoles(await api.getRoles()), []);
  const reloadCameras = useCallback(async () => setCameras(await api.getCameras()), []);

  const mergeTask = useCallback((fresh) => {
    setTasks((list) => {
      const idx = list.findIndex((x) => x.id === fresh.id);
      if (idx >= 0) { const copy = list.slice(); copy[idx] = fresh; return copy; }
      return [...list, fresh];
    });
  }, []);
  const patchTaskRemote = useCallback((id, partial) => {
    api.patchTask(id, partial).then(({ ok, data }) => { if (ok) mergeTask(data); });
  }, [mergeTask]);

  // ---- initial load, once logged in ----
  useEffect(() => {
    reloadRoles();
    reloadCameras();
    reloadBrickTypes();
    reloadWorkers();
    reloadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- permissions (ported from applyPermissionGate) ----
  const permissions = useMemo(() => {
    const role = roles.find((r) => r.name === user.role);
    return role ? role.permissions : allPermsTrue();
  }, [roles, user.role]);

  // /api/users is settings-only on the server — don't ask for it (and eat a 403) as an Engineer/Viewer
  useEffect(() => {
    if (roles.length > 0 && permissions.settings) reloadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles.length, permissions.settings]);

  useEffect(() => {
    if (roles.length === 0) return; // not loaded yet — don't redirect prematurely
    if (permissions[view] === false) {
      toast('คุณไม่มีสิทธิ์เข้าถึงเมนูนี้');
      setViewRaw('home');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissions, view, roles.length]);

  function onNavigate(viewName) {
    if (permissions[viewName] === false) { toast('คุณไม่มีสิทธิ์เข้าถึงเมนูนี้'); return; }
    setViewRaw(viewName);
    if (viewName === 'task') setTaskSubView('list'); // matches renderTaskList() always resetting to list
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function openTaskDetail(id) {
    setCurrentTaskId(id);
    setViewRaw('task');
    setTaskSubView('detail');
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function backToTaskList() {
    setTaskSubView('list');
  }

  async function onTestAlert() {
    toast('กำลังส่งการแจ้งเตือนทดสอบไปยัง Discord...');
    const { ok, data } = await api.testAlert();
    toast(data.message || (ok ? 'ส่งการแจ้งเตือนทดสอบสำเร็จ' : 'ส่งการแจ้งเตือนทดสอบไม่สำเร็จ'), ok ? 'success' : 'info');
  }

  // ---- topbar title/crumb (task detail overrides with task name/zone) ----
  let title = TITLES[view] || view;
  let crumb = `CIVIL / ${TITLES[view] || view}`;
  if (view === 'task' && taskSubView === 'detail' && currentTaskId) {
    const t = tasks.find((x) => x.id === currentTaskId);
    if (t) { title = t.name; crumb = `CIVIL / Task / ${t.zone}`; }
  }

  return (
    <div className="app">
      <Sidebar view={view} permissions={permissions} open={sidebarOpen} onNavigate={onNavigate} onCloseMobile={() => setSidebarOpen(false)} />
      <main className="main">
        <Topbar
          title={title}
          crumb={crumb}
          user={user}
          onTestAlert={onTestAlert}
          onAddTask={() => onNavigate('task')}
          onLogout={onLogout}
          onOpenMobileMenu={() => setSidebarOpen(true)}
        />
        <div className="content">
          {view === 'home' && (
            <Home tasks={tasks} brickTypes={brickTypes} onOpenTask={openTaskDetail} onGoTask={() => onNavigate('task')} />
          )}
          {view === 'task' && (
            <Task
              taskSubView={taskSubView}
              currentTaskId={currentTaskId}
              onOpenTask={openTaskDetail}
              onBack={backToTaskList}
              taskFilter={taskFilter}
              setTaskFilter={setTaskFilter}
              taskSearch={taskSearch}
              setTaskSearch={setTaskSearch}
              tasks={tasks}
              brickTypes={brickTypes}
              workersMaster={workersMaster}
              cameras={cameras}
              reloadCameras={reloadCameras}
              mergeTask={mergeTask}
              patchTaskRemote={patchTaskRemote}
              reloadTasks={reloadTasks}
            />
          )}
          {view === 'dashboard' && <Dashboard tasks={tasks} currentTaskId={currentTaskId} />}
          {view === 'reports' && <Reports tasks={tasks} workersMaster={workersMaster} />}
          {view === 'logs' && <Logs />}
          {view === 'settings' && (
            <Settings
              tab={settingsTab}
              setTab={setSettingsTab}
              cameras={cameras}
              reloadCameras={reloadCameras}
              workersMaster={workersMaster}
              reloadWorkers={reloadWorkers}
              brickTypes={brickTypes}
              reloadBrickTypes={reloadBrickTypes}
              users={users}
              reloadUsers={reloadUsers}
              roles={roles}
              reloadRoles={reloadRoles}
              onPermissionsChanged={() => {}}
              reloadTasks={reloadTasks}
            />
          )}
        </div>
      </main>
    </div>
  );
}
