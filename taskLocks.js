// A task's reports and Task Data share one persisted lock in tasks.extra.
const isAdmin = (user) => String(user?.role || '').trim().toLowerCase() === 'admin';
const LOCK_MESSAGE = 'งานนี้ถูกล็อกโดย Admin — ดูข้อมูลได้ แต่แก้ไขไม่ได้';

function createTaskWriteGuard({ getTasks }) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const pathname = req.originalUrl.split('?')[0];
    // Match Express's case-insensitive routes, including URL-encoded task IDs.
    const match = /^\/api\/(tasks|cameras|bricktypes|workers)\/([^/]+)(\/.*)?$/i.exec(pathname);
    if (!match) return next();
    const [, resource, encodedId, suffix = ''] = match;
    let id;
    try { id = decodeURIComponent(encodedId); }
    catch (_) { return res.status(400).json({ success: false, message: 'ID ไม่ถูกต้อง' }); }
    const admin = isAdmin(req.user);
    if (resource.toLowerCase() === 'tasks' && /^\/lock\/?$/i.test(suffix) && !admin) {
      return res.status(403).json({ success: false, message: 'เฉพาะ Admin เท่านั้นที่ Lock / Unlock งานได้' });
    }
    if (admin) return next();
    const blocked = getTasks().find((task) => {
      if (!task.locked) return false;
      switch (resource.toLowerCase()) {
        case 'tasks': return task.id === id;
        case 'cameras': return task.cameraId === id;
        case 'bricktypes': return task.brickType === id;
        case 'workers': return (task.workers || []).includes(id);
        default: return false;
      }
    });
    if (blocked) return res.status(423).json({ success: false, code: 'TASK_LOCKED', message: LOCK_MESSAGE, taskId: blocked.id });
    next();
  };
}

function createTaskLockHandler({ findTask, saveTask, audit }) {
  return async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ success: false, message: 'เฉพาะ Admin เท่านั้นที่ Lock / Unlock งานได้' });
    const task = findTask(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'ไม่พบ Task นี้' });
    if (typeof req.body?.locked !== 'boolean') return res.status(400).json({ success: false, message: 'locked ต้องเป็น true หรือ false' });
    if (!!task.locked === req.body.locked) return res.json(task);
    const fresh = { ...task, locked: req.body.locked, lockedAt: req.body.locked ? new Date().toISOString() : null, lockedBy: req.body.locked ? req.user.username : null };
    try {
      await saveTask(fresh);
      // Don't replace other live fields changed by detection while saving the lock.
      Object.assign(task, { locked: fresh.locked, lockedAt: fresh.lockedAt, lockedBy: fresh.lockedBy });
      audit('task', 'info', `${fresh.locked ? 'Lock' : 'Unlock'} Task "${task.name}" (มีผลกับ Task Data และรายงานทุกหน้า)`, req.user.username);
      res.json(task);
    } catch (err) {
      res.status(500).json({ success: false, message: 'บันทึกสถานะ Lock ไม่สำเร็จ', raw: err.message });
    }
  };
}

module.exports = { isAdmin, createTaskWriteGuard, createTaskLockHandler };
