import CameraTab from './settings/CameraTab.jsx';
import WorkerTab from './settings/WorkerTab.jsx';
import BrickTab from './settings/BrickTab.jsx';
import UsersTab from './settings/UsersTab.jsx';
import RolesTab from './settings/RolesTab.jsx';
import AlertTab from './settings/AlertTab.jsx';
import StorageTab from './settings/StorageTab.jsx';
import SystemTab from './settings/SystemTab.jsx';

const TABS = [
  ['camera', 'Camera'],
  ['worker', 'Workers'],
  ['brick', 'Brick Types'],
  ['users', 'Users'],
  ['roles', 'Roles & Permissions'],
  ['alert', 'Alerts'],
  ['storage', 'Storage'],
  ['system', 'System'],
];

export default function Settings({
  tab, setTab,
  cameras, reloadCameras,
  workersMaster, reloadWorkers,
  brickTypes, reloadBrickTypes,
  users, reloadUsers,
  roles, reloadRoles, onPermissionsChanged,
  reloadTasks,
}) {
  return (
    <section id="view-settings" className="view active">
      <div className="section-head"><div><h2>Settings</h2><p>ตั้งค่าระบบและข้อมูลพื้นฐาน</p></div></div>
      <div className="settings-layout">
        <div className="settings-nav">
          {TABS.map(([key, label]) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
        <div>
          {tab === 'camera' && <CameraTab cameras={cameras} reloadCameras={reloadCameras} />}
          {tab === 'worker' && <WorkerTab workersMaster={workersMaster} reloadWorkers={reloadWorkers} reloadTasks={reloadTasks} />}
          {tab === 'brick' && <BrickTab brickTypes={brickTypes} reloadBrickTypes={reloadBrickTypes} />}
          {tab === 'users' && <UsersTab users={users} roles={roles} reloadUsers={reloadUsers} />}
          {tab === 'roles' && <RolesTab roles={roles} reloadRoles={reloadRoles} onPermissionsChanged={onPermissionsChanged} />}
          {tab === 'alert' && <AlertTab />}
          {tab === 'storage' && <StorageTab />}
          {tab === 'system' && <SystemTab />}
        </div>
      </div>
    </section>
  );
}
