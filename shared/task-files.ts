export function taskFileLinks(output: string) {
  const paths = new Set<string>();
  // shortcut: inline Markdown links only; add a Markdown parser if richer output is needed.
  for (const match of output.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s()]+(?:\([^\n()]*\)[^\s()]*)*)\s*\)/g)) {
    let path = match[1].replace(/^<|>$/g, "");
    try { path = decodeURIComponent(path); } catch { continue; }
    if (!path || /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//") || /[\x00-\x1f\\]/.test(path)) continue;
    paths.add(path);
  }
  return [...paths];
}

export function taskFileUrl(taskId: string, path: string, download = false, revision?: number) {
  return `/api/task-file?${new URLSearchParams({ id: taskId, path, ...(download ? { download: "1" } : {}), ...(revision ? { revision: String(revision) } : {}) })}`;
}
