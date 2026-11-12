const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskWriteGuard, createTaskLockHandler } = require('../taskLocks');
const { requiredPermission } = require('../auth');

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
const admin = { username: 'admin', role: 'Admin' };
const engineer = { username: 'engineer', role: 'Engineer' };

test('locked tasks reject every write route for other roles, including stale editors and copies', () => {
  const guard = createTaskWriteGuard({ getTasks: () => [{ id: 'original', locked: true }, { id: 'copy', copyOf: 'original', locked: true }] });
  const writes = [
    ['PUT', ''], ['DELETE', ''], ['POST', '/duplicate'], ['POST', '/clear'],
    ['POST', '/detect'], ['POST', '/timelapse/build'], ['PUT', '/label-frames/1'],
    ['POST', '/label-frames/apply-roi'], ['POST', '/label-frames/mark-reviewed'],
    ['POST', '/label-frames/exclude'], ['DELETE', '/label-frames/1'], ['PATCH', '/future-editor'],
  ];
  for (const role of ['Engineer', 'Viewer', 'Custom']) for (const id of ['original', 'copy']) for (const [method, suffix] of writes) {
    const res = response();
    guard({ method, originalUrl: `/api/tasks/${id}${suffix}`, user: { role }, body: { locked: false, role: 'Admin' } }, res, () => assert.fail('locked write reached handler'));
    assert.equal(res.statusCode, 423, `${role} ${method} ${id}${suffix}`);
    assert.equal(res.body.code, 'TASK_LOCKED');
  }
});

test('reading and exporting locked reports remain available; unlocked tasks retain role permissions', () => {
  const guard = createTaskWriteGuard({ getTasks: () => [{ id: 'locked', locked: true }, { id: 'open' }] });
  for (const [method, originalUrl, user] of [
    ['GET', '/api/tasks/locked', engineer], ['GET', '/api/tasks/locked/history', engineer],
    ['HEAD', '/api/tasks/locked/timelapse', engineer], ['GET', '/api/reports/productivity', engineer],
    ['PUT', '/api/tasks/open', engineer], ['POST', '/api/tasks/open/duplicate', engineer],
    ['PUT', '/api/tasks/locked', admin], ['DELETE', '/api/tasks/locked', admin],
  ]) {
    let allowed = false;
    guard({ method, originalUrl, user }, response(), () => { allowed = true; });
    assert.ok(allowed, `${method} ${originalUrl}`);
  }
  assert.equal(requiredPermission('PUT', '/api/tasks/open'), 'task');
});

test('changing shared camera, brick or worker cannot indirectly change a locked task', () => {
  const guard = createTaskWriteGuard({ getTasks: () => [{ id: 'locked', locked: true, cameraId: 'cam', brickType: 'brick', workers: ['worker'] }] });
  for (const originalUrl of ['/api/cameras/cam/view', '/api/cameras/cam', '/api/bricktypes/brick', '/api/workers/worker']) {
    for (const method of ['PUT', 'DELETE']) {
      const res = response();
      guard({ method, originalUrl, user: engineer }, res, () => assert.fail('indirect edit allowed'));
      assert.equal(res.statusCode, 423);
    }
  }
  let allowed = false;
  guard({ method: 'PUT', originalUrl: '/api/cameras/unrelated/view', user: engineer }, response(), () => { allowed = true; });
  assert.ok(allowed);
});

test('encoded IDs, route casing and trailing slashes do not bypass lock checks', () => {
  const guard = createTaskWriteGuard({ getTasks: () => [{ id: 'abc', locked: true }] });
  for (const originalUrl of ['/api/tasks/%61bc', '/API/TASKS/abc/', '/api/tasks/abc?locked=false']) {
    const res = response();
    guard({ method: 'PUT', originalUrl, user: engineer }, res, () => assert.fail('bypass'));
    assert.equal(res.statusCode, 423);
  }
});

test('only Admin can lock or unlock, even an unlocked task', async () => {
  const task = { id: 'task', name: 'Task' };
  const guard = createTaskWriteGuard({ getTasks: () => [task] });
  const handler = createTaskLockHandler({ findTask: () => task, saveTask: () => assert.fail('unauthorized save'), audit: () => {} });
  for (const locked of [true, false]) {
    const req = { method: 'PUT', originalUrl: '/api/tasks/task/lock/', params: { id: 'task' }, body: { locked }, user: engineer };
    const res = response();
    guard(req, res, () => assert.fail('non-admin lock route allowed'));
    assert.equal(res.statusCode, 403);
    const direct = response();
    await handler(req, direct);
    assert.equal(direct.statusCode, 403);
  }
});

test('lock persists with actor/time, can be reloaded, and unlock restores editing', async () => {
  const task = { id: 'task', name: 'Task', blocks: 3 };
  let persisted, saves = 0;
  const events = [];
  const handler = createTaskLockHandler({ findTask: () => task, saveTask: async (fresh) => { persisted = JSON.stringify(fresh); saves++; }, audit: (...event) => events.push(event) });
  const call = (locked) => handler({ params: { id: 'task' }, user: admin, body: { locked, lockedBy: 'fake', lockedAt: 'fake' } }, response());
  await call(true);
  const reloaded = JSON.parse(persisted);
  assert.equal(reloaded.locked, true);
  assert.equal(reloaded.lockedBy, 'admin');
  assert.ok(Number.isFinite(Date.parse(reloaded.lockedAt)));
  assert.equal(task.lockedAt, reloaded.lockedAt);
  await call(true);
  assert.equal(saves, 1, 'idempotent lock must preserve the original actor/time');
  await call(false);
  assert.equal(task.locked, false);
  assert.equal(task.lockedBy, null);
  assert.equal(task.lockedAt, null);
  assert.equal(events.length, 2);
  let allowed = false;
  createTaskWriteGuard({ getTasks: () => [task] })({ method: 'PUT', originalUrl: '/api/tasks/task', user: engineer }, response(), () => { allowed = true; });
  assert.ok(allowed);
});

test('invalid state and missing task are rejected; a failed save does not change the lock', async () => {
  const task = { id: 'task', name: 'Task', locked: false };
  let saves = 0;
  const handler = createTaskLockHandler({ findTask: (id) => id === task.id ? task : null, saveTask: async () => { saves++; throw new Error('DB unavailable'); }, audit: () => assert.fail('failed write was audited as success') });
  for (const locked of ['true', 1, null, undefined]) {
    const res = response();
    await handler({ params: { id: 'task' }, user: admin, body: { locked } }, res);
    assert.equal(res.statusCode, 400);
  }
  const missing = response();
  await handler({ params: { id: 'missing' }, user: admin, body: { locked: true } }, missing);
  assert.equal(missing.statusCode, 404);
  const failed = response();
  await handler({ params: { id: 'task' }, user: admin, body: { locked: true } }, failed);
  assert.equal(failed.statusCode, 500);
  assert.equal(saves, 1);
  assert.equal(task.locked, false);
  assert.equal(task.lockedBy, undefined);
});
