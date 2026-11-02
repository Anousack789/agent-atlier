import { existsSync } from "node:fs";
import { isAbsolute, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store";

export function relocatePaths(store: Store, from: string, to: string) {
  const source = resolve(from);
  const target = resolve(to);
  const relocate = (path: string) =>
    path === source || path.startsWith(source + sep)
      ? target + path.slice(source.length)
      : path;
  return store.transaction(() => {
    let changed = 0;
    for (const project of store.list("projects")) {
      const path = relocate(project.path);
      if (path !== project.path) {
        store.put("projects", { ...project, path });
        changed++;
      }
    }
    for (const task of store.list("tasks")) {
      if (!task.workspace) continue;
      const workspace = relocate(task.workspace);
      if (workspace !== task.workspace) {
        store.put("tasks", { ...task, workspace });
        changed++;
      }
    }
    return changed;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [from, to, dataDir] = process.argv.slice(2);
  if (
    process.argv.length !== 5 ||
    ![from, to, dataDir].every((path) => path && isAbsolute(path)) ||
    !existsSync(join(dataDir, "office.sqlite"))
  ) {
    throw new Error("Usage: node --import tsx scripts/relocate-data.ts <absolute-old-root> <absolute-new-root> <existing-data-dir>");
  }
  const store = new Store(dataDir);
  try {
    console.log(`Updated ${relocatePaths(store, from, to)} project/task paths`);
  } finally {
    store.close();
  }
}
