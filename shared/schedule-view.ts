import type { Approval, Schedule, Task } from "./types";

export function latestScheduleTask(schedule: Schedule, tasks: Task[]) {
  if (!schedule.lastTaskId) return undefined;
  return tasks.find((task) => task.id === schedule.lastTaskId && task.scheduleId === schedule.id && task.projectId === schedule.projectId);
}

export function scheduleAttention(projectId: string, tasks: Task[], approvals: Approval[]) {
  const projectTasks = tasks.filter((task) => task.projectId === projectId);
  const roots = new Set(projectTasks.filter((task) => task.scheduleId).map((task) => task.id));
  const related = projectTasks.filter((task) => roots.has(task.id) || roots.has(task.rootId));
  const pendingApprovals = approvals.filter((approval) => approval.projectId === projectId && approval.status === "pending" && related.some((task) => task.id === approval.taskId));
  const pendingTasks = related.filter((task) => ["reviewing", "accepted", "failed", "interrupted"].includes(task.status) ||
    (task.workflow && ["acceptance", "accepted", "replanning"].includes(task.workflow.phase)) ||
    (task.status === "completed" && task.stage?.reviewRequired && task.deliveries?.at(-1) && !task.deliveries.at(-1)?.approvedAt));
  return { tasks: pendingTasks, approvals: pendingApprovals };
}
