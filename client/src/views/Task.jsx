import TaskList from './TaskList.jsx';
import TaskDetail from './TaskDetail.jsx';

/* ===================================================================
   Task — container for the Task section's two sub-states (list/detail).
   Sub-view + currentTaskId live in App (openTaskDetail needs to be
   reachable from Home too), taskFilter/taskSearch are owned here so
   they persist while flipping between list and detail, same as the
   original's module-level taskFilter/taskSearch.
=================================================================== */
export default function Task({
  taskSubView, currentTaskId, onOpenTask, onBack,
  taskFilter, setTaskFilter, taskSearch, setTaskSearch,
  tasks, brickTypes, workersMaster, cameras, reloadCameras,
  mergeTask, patchTaskRemote, reloadTasks,
}) {
  return (
    <section id="view-task" className="view active">
      {taskSubView === 'list' ? (
        <TaskList
          tasks={tasks}
          brickTypes={brickTypes}
          cameras={cameras}
          filter={taskFilter}
          setFilter={setTaskFilter}
          search={taskSearch}
          setSearch={setTaskSearch}
          onOpenTask={onOpenTask}
          reloadTasks={reloadTasks}
        />
      ) : (
        <TaskDetail
          taskId={currentTaskId}
          task={tasks.find((t) => t.id === currentTaskId)}
          brickTypes={brickTypes}
          workersMaster={workersMaster}
          cameras={cameras}
          reloadCameras={reloadCameras}
          mergeTask={mergeTask}
          patchTaskRemote={patchTaskRemote}
          onBack={onBack}
          onDeleted={onBack}
          onOpenTask={onOpenTask}
          taskExists={(id) => tasks.some((t) => t.id === id)}
          reloadTasks={reloadTasks}
        />
      )}
    </section>
  );
}
