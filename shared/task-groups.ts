import type { Task } from "./types";

export function groupTasks(tasks: Task[]) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    let root = task;
    const visited = new Set([root.id]);
    while (true) {
      const parentId = root.parentTaskId || (root.sessionRound ? root.relatedTaskId : root.rootId);
      const parent = parentId && byId.get(parentId);
      if (!parent || parent.projectId !== task.projectId || visited.has(parent.id)) break;
      visited.add(parent.id);
      root = parent;
    }
    const members = groups.get(root.id) || [];
    members.push(task);
    groups.set(root.id, members);
  }
  return groups;
}
