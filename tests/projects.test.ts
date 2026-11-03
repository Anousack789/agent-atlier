import { createApprovedTask } from "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { Store } from "../server/store";
import { OfficeRuntime } from "../server/runtime";
import { projectRepositories } from "../shared/projects";
import { projectInput } from "../shared/validation";
import { parseBackup } from "../server/backup";
import { relocatePaths } from "../scripts/relocate-data";
import { readTaskFile } from "../server/task-files";
import type { OfficeBackup } from "../shared/backup";
import type { Task } from "../shared/types";

function setup() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "atelier-projects-")));
  const store = new Store(join(dir, "data"));
  const runtime = new OfficeRuntime(store, "http://127.0.0.1:3210");
  const calls: { method: string; params: Record<string, any> }[] = [];
  runtime.codex.request = async (method, params): Promise<any> => {
    calls.push({ method, params });
    return method === "thread/start" ? { thread: { id: `thread-${calls.length}` } } : { turn: { id: "turn", status: "inProgress" } };
  };
  const git = (path: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@localhost", ...args], {
    cwd: path, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  const repository = (name: string) => {
    const path = join(dir, name);
    mkdirSync(path);
    git(path, "init", "-b", "main");
    writeFileSync(join(path, "source.txt"), "before\n");
    git(path, "add", ".");
    git(path, "commit", "-m", "initial");
    return { id: name, name, path, description: name === "web" ? "Next.js frontend" : "Go/Fiber API" };
  };
  const start = (projectId: string) => {
    store.put("agents", { ...store.get("agents", "nova")!, permission: "workspace-write" });
    runtime.connection = { state: "ready" };
    return createApprovedTask(runtime, { title: "Connect frontend and API", prompt: "Implement both sides", projectId, agentId: "nova", kind: "code" });
  };
  return { dir, store, runtime, calls, git, repository, start, async close() {
    await runtime.close(); rmSync(dir, { recursive: true, force: true });
  } };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await setTimeout(10);
  }
  assert.fail("timed out waiting for task");
}

test("General persists; legacy projects retain their first repo; project paths and descriptions are validated", async () => {
  const f = setup();
  try {
    assert.equal(f.store.get("projects", "default")?.name, "General");
    assert.deepEqual(f.store.get("projects", "default")?.repositories, []);
    const legacy = { id: "legacy", name: "Existing", path: f.dir };
    f.store.put("projects", legacy);
    assert.deepEqual(projectRepositories(legacy), [{ id: "main", name: "Existing", path: f.dir }]);
    const saved = await f.runtime.saveProject({ ...legacy, description: "Keep old files" });
    assert.equal(saved.repositories?.[0].path, f.dir);
    assert.equal(saved.description, "Keep old files");
    const web = f.repository("web"), api = f.repository("api");
    const project = await f.runtime.saveProject({ name: "Shop", path: f.dir, description: "Web uses API", repositories: [
      { ...web, path: "web" }, api,
    ] });
    assert.equal(project.repositories?.[0].path, web.path);
    assert.equal(project.repositories?.[1].description, "Go/Fiber API");
    const compatibilitySave = await f.runtime.saveProject({ id: project.id, name: project.name, path: project.path });
    assert.deepEqual(compatibilitySave.repositories, project.repositories);
    assert.equal(compatibilitySave.description, project.description);
    assert.throws(() => projectInput.parse({ ...project, repositories: [web, web] }), /ID repository/);
    assert.throws(() => projectInput.parse({ ...project, repositories: [{ ...web, id: "../escape" }] }));
    await assert.rejects(f.runtime.saveProject({ ...project, repositories: [web, { ...api, path: web.path }] }), /ซ้ำหรือซ้อน/);
    await assert.rejects(f.runtime.saveProject({ ...project, repositories: [{ ...web, path: "missing" }] }));
    const task = createApprovedTask(f.runtime, { title: "Pending", prompt: "Wait", agentId: "atlas", projectId: project.id });
    await assert.rejects(f.runtime.saveProject(project), /หยุดงาน/);
    await f.runtime.stopTask(task.id);
    const reopened = new Store(f.store.dir);
    try { assert.deepEqual(reopened.get("projects", project.id), project); }
    finally { reopened.close(); }
  } finally { await f.close(); }
});

test("one task isolates two repos, receives only its project map, and merges each repo independently", async () => {
  const f = setup();
  try {
    const web = f.repository("web"), api = f.repository("api");
    const project = await f.runtime.saveProject({ name: "Shop", path: f.dir, description: "Web consumes Go API", repositories: [web, api] });
    f.store.put("projects", { id: "other", name: "OTHER_PROJECT_SECRET", path: "/outside", description: "OTHER_DESCRIPTION" });
    const task = f.start(project.id);
    await until(() => f.calls.some((c) => c.method === "turn/start"));
    const running = f.store.get("tasks", task.id)!;
    assert.equal(running.worktrees?.length, 2);
    assert.equal(running.workspace, join(f.store.dir, "worktrees", task.id));
    const thread = f.calls.find((c) => c.method === "thread/start")!.params;
    const turn = f.calls.find((c) => c.method === "turn/start")!.params;
    assert.equal(thread.approvalPolicy, "on-request");
    assert.equal(thread.approvalsReviewer, "auto_review");
    assert.equal(thread.cwd, running.workspace);
    assert.deepEqual(turn.sandboxPolicy, { type: "workspaceWrite", writableRoots: [running.workspace], networkAccess: false });
    assert.match(thread.developerInstructions, /README.md/);
    assert.match(thread.developerInstructions, /AGENTS.md/);
    assert.match(thread.developerInstructions, /isolated worktrees/);
    const context = turn.input[0].text;
    assert.match(context, /Web consumes Go API/);
    assert.match(context, /Next.js frontend/);
    assert.match(context, /Go\/Fiber API/);
    assert.ok(!context.includes("OTHER_"));
    for (const tree of running.worktrees!) {
      assert.equal(f.git(tree.path, "branch", "--show-current"), "main");
      assert.equal(f.git(tree.workspace, "branch", "--show-current"), tree.branch);
      writeFileSync(join(tree.workspace, "source.txt"), `after ${tree.name}\n`);
      assert.equal(readFileSync(join(tree.path, "source.txt"), "utf8"), "before\n");
      assert.match(await f.runtime.diff(task.id, tree.id), new RegExp(`after ${tree.name}`));
    }
    const artifact = join(running.worktrees![0].workspace, "result.md");
    writeFileSync(artifact, "Generated specification");
    assert.equal((await readTaskFile({ ...running, output: `[Specification](${artifact})` }, artifact)).bytes.toString(), "Generated specification");
    await assert.rejects(readTaskFile({ ...running, output: `[Original](${web.path}/source.txt)` }, `${web.path}/source.txt`));
    await assert.rejects(f.runtime.diff(task.id), /repository/);
    await assert.rejects(f.runtime.merge(task.id, web.id), /เสร็จแล้ว/);
    f.runtime.codex.onNotification("turn/completed", { threadId: running.threadId, turn: { status: "completed" } });
    await f.runtime.merge(task.id, web.id);
    const partial = f.store.get("tasks", task.id)!;
    assert.ok(partial.worktrees![0].mergedAt);
    assert.equal(partial.worktrees![1].mergedAt, undefined);
    assert.equal(partial.mergedAt, undefined);
    assert.equal(readFileSync(join(api.path, "source.txt"), "utf8"), "before\n");
    await assert.rejects(f.runtime.merge(task.id, web.id), /รวมแล้ว/);
    // The immutable task map survives project edits; merge still targets the original repository.
    await f.runtime.saveProject({ ...project, repositories: [] });
    await f.runtime.merge(task.id, api.id);
    assert.ok(f.store.get("tasks", task.id)?.mergedAt);
    assert.equal(readFileSync(join(api.path, "source.txt"), "utf8"), "after api\n");
    assert.equal(f.git(web.path, "status", "--porcelain"), "");
    assert.equal(f.git(api.path, "status", "--porcelain"), "");
  } finally { await f.close(); }
});

test("failed preparation preserves earlier worktrees and never starts Codex or changes originals", async () => {
  const f = setup();
  try {
    const web = f.repository("web"), api = f.repository("api");
    writeFileSync(join(api.path, "source.txt"), "human dirty edit\n");
    const project = await f.runtime.saveProject({ name: "Shop", path: f.dir, repositories: [web, api] });
    const task = f.start(project.id);
    await until(() => f.store.get("tasks", task.id)?.status === "failed");
    const failed = f.store.get("tasks", task.id)!;
    assert.match(failed.error!, /ยังไม่ commit/);
    assert.equal(failed.worktrees?.length, 1);
    assert.equal(readFileSync(join(failed.worktrees![0].workspace, "source.txt"), "utf8"), "before\n");
    assert.equal(readFileSync(join(api.path, "source.txt"), "utf8"), "human dirty edit\n");
    assert.equal(f.calls.length, 0);
    assert.equal(f.git(web.path, "branch", "--show-current"), "main");
  } finally { await f.close(); }
});

test("multi-repo consultations inspect the task worktrees; only the original agent can resume before any merge", async () => {
  const f = setup();
  try {
    const web = f.repository("web"), api = f.repository("api");
    const project = await f.runtime.saveProject({ name: "Shop", path: f.dir, repositories: [web, api] });
    const root = f.start(project.id);
    await until(() => f.calls.some((c) => c.method === "turn/start"));
    const finish = (taskId: string) => f.runtime.codex.onNotification("turn/completed", {
      threadId: f.store.get("tasks", taskId)!.threadId, turn: { status: "completed" },
    });
    finish(root.id);
    const workspace = f.store.get("tasks", root.id)!.workspace;
    const consult = async (agentId: string) => {
      const count = f.calls.filter((c) => c.method === "turn/start").length;
      const task = createApprovedTask(f.runtime, { title: "Review API contract", prompt: "Check both sides", kind: "general", projectId: project.id, agentId }, { rootId: root.id, round: 1 });
      await until(() => f.calls.filter((c) => c.method === "turn/start").length > count);
      const thread = f.calls.filter((c) => c.method === "thread/start").at(-1)!.params;
      const turn = f.calls.filter((c) => c.method === "turn/start").at(-1)!.params;
      assert.equal(thread.cwd, workspace);
      assert.ok(turn.input[0].text.includes(f.store.get("tasks", root.id)!.worktrees![1].workspace));
      await assert.rejects(f.runtime.merge(root.id, web.id), /ยังปรึกษา/);
      finish(task.id);
      return { thread, turn };
    };
    assert.equal((await consult("sage")).thread.sandbox, "read-only");
    const returning = await consult("nova");
    assert.equal(returning.thread.sandbox, "workspace-write");
    assert.deepEqual(returning.turn.sandboxPolicy.writableRoots, [workspace]);
    await f.runtime.merge(root.id, web.id);
    const afterPartialMerge = await consult("nova");
    assert.equal(afterPartialMerge.thread.sandbox, "read-only");
    assert.equal(afterPartialMerge.turn.sandboxPolicy, undefined);
  } finally { await f.close(); }
});

test("Git initialization approval binds a repo path and cannot silently follow edited project settings", async () => {
  const f = setup();
  try {
    const first = join(f.dir, "first"), second = join(f.dir, "second");
    mkdirSync(first); mkdirSync(second);
    const project = await f.runtime.saveProject({ name: "Setup", path: f.dir, repositories: [{ id: "api", name: "API", path: first }] });
    const approval = await f.runtime.requestGitInit(project.id, "api");
    assert.match(approval.details, new RegExp(first));
    assert.equal(approval.payload.path, first);
    await f.runtime.saveProject({ ...project, repositories: [{ id: "api", name: "API", path: second }] });
    await assert.rejects(f.runtime.decide({ id: approval.id, approve: true }), /เปลี่ยนไป/);
    assert.throws(() => f.git(second, "rev-parse", "--show-toplevel"));
    assert.equal(f.store.get("approvals", approval.id)?.status, "failed");
    f.store.put("approvals", { ...approval, id: "legacy-git-init", status: "pending", payload: {} });
    const reopened = new OfficeRuntime(new Store(f.store.dir), "http://127.0.0.1:3210");
    try {
      assert.equal(reopened.store.get("approvals", "legacy-git-init")?.status, "expired");
      await assert.rejects(reopened.decide({ id: "legacy-git-init", approve: true }), /จัดการแล้ว/);
    } finally { await reopened.close(); }
  } finally { await f.close(); }
});

test("backup and relocation retain project maps; restore strips executable worktree paths", async () => {
  const f = setup();
  try {
    const repo = f.repository("api");
    const project = await f.runtime.saveProject({ name: "API", path: f.dir, description: "Project details", repositories: [repo] });
    const task = f.start(project.id);
    await until(() => f.calls.some((c) => c.method === "turn/start"));
    f.runtime.codex.onNotification("turn/completed", { threadId: f.store.get("tasks", task.id)!.threadId, turn: { status: "completed" } });
    const backup = JSON.parse(await f.runtime.backups.export()) as OfficeBackup;
    assert.deepEqual(parseBackup(backup), backup);
    assert.equal(backup.data.tasks[0].worktrees?.length, 1);
    const invalid = structuredClone(backup);
    invalid.data.projects.find((p) => p.id === project.id)!.repositories![0].path = "relative";
    assert.throws(() => parseBackup(invalid));
    const preview = await f.runtime.backups.inspect(backup);
    await f.runtime.backups.restore(backup, preview.token);
    assert.equal(f.store.get("tasks", task.id)?.worktrees, undefined);
    assert.equal(f.store.get("projects", project.id)?.description, "Project details");
    const restoredProject = f.store.get("projects", project.id)!;
    f.store.put("tasks", { ...backup.data.tasks[0] } as Task);
    relocatePaths(f.store, f.dir, join(f.dir, "moved"));
    assert.equal(f.store.get("projects", project.id)?.repositories?.[0].path, join(f.dir, "moved", "api"));
    assert.equal(f.store.get("tasks", task.id)?.worktrees?.[0].path, join(f.dir, "moved", "api"));
    assert.equal(restoredProject.repositories?.[0].path, repo.path);
  } finally { await f.close(); }
});
