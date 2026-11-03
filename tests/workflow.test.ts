import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { Store } from "../server/store";
import { OfficeRuntime } from "../server/runtime";
import { assertDeliveryCurrent, assertReviewUnchanged, latestDelivery, readDeliveryFile, validateWorkflow } from "../server/workflow";
import { parseBackup } from "../server/backup";
import type { Intake, Task, TaskPlan } from "../shared/types";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
async function until(check: () => boolean) {
  for (let i = 0; i < 1000; i++) { if (check()) return; await new Promise((r) => setTimeout(r, 5)); }
  assert.fail("workflow did not reach expected state");
}
const stage = (key: string, kind: "design" | "work" | "review" | "summary", repositories: string[] = [], reviewRequired = false) => ({ key, kind, repositories, reviewRequired, criteria: [`${key} criterion`] });
function plan(): TaskPlan {
  return { workflow: true, goal: "login", steps: ["design", "implement", "verify", "accept"], deliverable: "working login", assignments: [
    { agentId: "pixel", title: "Design", prompt: "desktop/mobile design", kind: "general", deliverable: "images and spec", stage: stage("design", "design", [], true) },
    { agentId: "nova", title: "Frontend", prompt: "implement approved login", kind: "code", deliverable: "frontend", stage: stage("frontend", "work", ["frontend"]), dependsOn: [0] },
    { agentId: "sage", title: "Backend", prompt: "reuse or implement login endpoint", kind: "code", deliverable: "backend", stage: stage("backend", "work", ["backend"]), dependsOn: [0] },
    { agentId: "pixel", title: "Integration", prompt: "test exact pair", kind: "general", deliverable: "test evidence", stage: stage("verify", "review"), dependsOn: [1, 2] },
    { agentId: "atlas", title: "Boss review", prompt: "review brief and all evidence", kind: "general", deliverable: "reviewed summary", stage: stage("summary", "summary"), dependsOn: [3] },
  ] };
}
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "atelier-workflow-"));
  for (const name of ["frontend", "backend"]) {
    const path = join(dir, name);
    await mkdir(path);
    git(path, "init", "-b", "main");
    await writeFile(join(path, "README.md"), name);
    git(path, "add", "README.md");
    git(path, "-c", "user.name=Test", "-c", "user.email=test@local", "commit", "-m", "initial");
  }
  const store = new Store(join(dir, "data"));
  const runtime = new OfficeRuntime(store, "http://127.0.0.1:3210");
  const calls: { method: string; params: any }[] = [];
  runtime.codex.request = async (method, params): Promise<any> => {
    calls.push({ method, params });
    return method === "thread/start" ? { thread: { id: randomUUID() } } : { turn: { id: randomUUID(), status: "inProgress" } };
  };
  runtime.codex.reply = () => {};
  runtime.connection = { state: "ready" };
  for (const agent of store.list("agents")) runtime.saveAgent({ ...agent, permission: "workspace-write", boss: agent.id === "atlas" });
  const project = await runtime.saveProject({ name: "Login", path: dir, repositories: ["frontend", "backend"].map((id) => ({ id, name: id, path: join(dir, id) })) });
  async function finishIntake(id: string, proposed = plan()) {
    await until(() => !!store.get("intakes", id)?.turnId);
    const intake = runtime.active.get(id)!.task;
    await runtime.tool(intake, "office_intake_result", { intent: "plan", reply: "review plan", title: "Login", kind: "general", plan: proposed }, 1);
    runtime.codex.onNotification("turn/completed", { threadId: intake.threadId, turn: { status: "completed" } });
    await until(() => store.get("intakes", id)?.status === "completed");
  }
  async function start(proposed = plan()) {
    const intake = await runtime.sendMessage({ projectId: project.id, channel: "team", body: "design login" }) as Intake;
    await finishIntake(intake.id, proposed);
    const parent = store.list("tasks").find((t) => !t.parentTaskId)!;
    runtime.confirmPlan({ id: parent.id, revision: parent.planRevision });
    return parent.id;
  }
  const child = (parentId: string, key: string) => store.list("tasks").find((t) => t.parentTaskId === parentId && t.stage?.key === key)!;
  async function finish(task: Task, output = "verified result", status: "passed" | "failed" | "unverified" = "passed") {
    await until(() => !!store.get("tasks", task.id)?.turnId && runtime.active.has(task.id));
    const current = runtime.active.get(task.id)!.task;
    await runtime.tool(current, "office_submit_result", { output, checks: current.stage!.criteria.map((criterion) => ({ criterion, status, evidence: "fake-provider fixture evidence" })), ...(status === "passed" ? {} : { incomplete: { reason: "unknown", completed: "inspection", remaining: "implementation", needed: "approved plan" } }) }, 2);
    runtime.codex.onNotification("turn/completed", { threadId: current.threadId, turn: { status: "completed" } });
    await until(() => ["completed", "failed"].includes(store.get("tasks", task.id)!.status));
    return store.get("tasks", task.id)!;
  }
  async function design(parentId: string, color = "red") {
    const task = child(parentId, "design");
    await until(() => runtime.active.has(task.id) && !!store.get("tasks", task.id)?.turnId);
    const path = join(store.get("tasks", task.id)!.workspace!, "login.png");
    await sharp({ create: { width: 2, height: 2, channels: 3, background: color } }).png().toFile(path);
    return finish(task, "Desktop/mobile preview and specification [login](login.png)");
  }
  async function approve(task: Task) { return runtime.workflowDecision({ id: task.id, revision: latestDelivery(task)!.revision, decision: "approve" }); }
  async function throughDesign(parentId: string) { await approve(await design(parentId)); }
  return { dir, store, runtime, project, calls, start, child, finish, design, approve, throughDesign, finishIntake,
    close: async () => { await runtime.close(); await rm(dir, { recursive: true, force: true }); } };
}

test("workflow rejects duplicate repo owners, missing gates/review, invalid graphs and non-Boss summary", () => {
  assert.doesNotThrow(() => validateWorkflow(plan(), "atlas", ["frontend", "backend"]));
  for (const mutate of [
    (p: TaskPlan) => { p.assignments[2].stage!.repositories = ["frontend"]; },
    (p: TaskPlan) => { p.assignments[0].stage!.reviewRequired = false; },
    (p: TaskPlan) => { p.assignments[1].dependsOn = []; },
    (p: TaskPlan) => { p.assignments[3].stage!.kind = "work"; },
    (p: TaskPlan) => { p.assignments[4].agentId = "nova"; },
    (p: TaskPlan) => { p.assignments[4].dependsOn = [0]; },
  ]) { const p = plan(); mutate(p); assert.throws(() => validateWorkflow(p, "atlas", ["frontend", "backend"])); }
});

test("first dependent run receives approved design without a synthetic user follow-up", async () => {
  const f = await setup();
  try {
    const id = await f.start();
    const frontend = f.child(id, "frontend");
    await f.throughDesign(id);
    await until(() => !!f.store.get("tasks", frontend.id)?.turnId);
    const turn = f.calls.find((call) => call.method === "turn/start" && call.params.threadId === f.store.get("tasks", frontend.id)!.threadId)!;
    const input = turn.params.input[0].text as string;
    assert.doesNotMatch(input, /Address the latest user follow-up/);
    assert.match(input, /approvedAt/);
    assert.match(input, /human-approved/);
  } finally { await f.close(); }
});

test("replanning requires an explicit choice to reuse an approved design or rerun it", async () => {
  for (const decision of ["reuse", "rerun"] as const) {
    const f = await setup();
    try {
      const id = await f.start(); await f.throughDesign(id);
      const design = f.child(id, "design");
      await until(() => !!f.child(id, "frontend").turnId);
      const workspace = f.child(id, "frontend").workspace;
      const parent = f.store.get("tasks", id)!;
      await f.runtime.workflowDecision({ id, revision: parent.workflow!.revision, decision: "replan", body: "continue implementation" });
      const revised = plan(); revised.assignments[0].prompt = "changed design instructions";
      await f.finishIntake(f.store.get("tasks", id)!.planningIntakeId!, revised);
      const draft = f.store.get("tasks", id)!;
      assert.throws(() => f.runtime.confirmPlan({ id, revision: draft.planRevision }), /แบบ/);
      assert.throws(() => f.runtime.confirmPlan({ id, revision: draft.planRevision, designs: [{ taskId: design.id, revision: 2, fingerprint: design.deliveries![0].fingerprint, decision }] }), /เวอร์ชัน/);
      f.runtime.confirmPlan({ id, revision: draft.planRevision, designs: [{ taskId: design.id, revision: 1, fingerprint: design.deliveries![0].fingerprint, decision }] });
      const result = f.child(id, "design");
      assert.equal(result.status, decision === "reuse" ? "completed" : "queued");
      assert.equal(result.deliveries![0].approvedAt, design.deliveries![0].approvedAt);
      if (decision === "reuse") {
        assert.deepEqual(result.stage!.criteria, design.deliveries![0].checks.map((check) => check.criterion));
        await until(() => f.child(id, "frontend").status === "running");
        assert.equal(f.child(id, "frontend").workspace, workspace);
      }
    } finally { await f.close(); }
  }
});

test("three design revisions stay immutable; approval releases owned repos, real Boss step, acceptance and per-repo merges", async () => {
  const f = await setup();
  try {
    const parentId = await f.start();
    let design = await f.design(parentId);
    const original = await readDeliveryFile(f.store.dir, design, 1, "login.png");
    for (const color of ["blue", "green", "orange"]) {
      assert.equal(f.child(parentId, "frontend").status, "queued");
      await f.runtime.workflowDecision({ id: design.id, revision: latestDelivery(design)!.revision, decision: "revise", body: `change to ${color}` });
      design = await f.design(parentId, color);
    }
    assert.equal(design.deliveries!.length, 4);
    assert.deepEqual(f.store.list("messages").filter((m) => m.taskId === design.id && m.from === "pixel").map((m) => m.deliveryRevision), [1, 2, 3, 4]);
    assert.deepEqual((await readDeliveryFile(f.store.dir, design, 1, "login.png")).bytes, original.bytes);
    await assert.rejects(f.runtime.workflowDecision({ id: design.id, revision: 1, decision: "approve" }), /เวอร์ชัน/);
    await f.approve(design);
    await assert.rejects(f.approve(design), /อนุมัติแล้ว/);
    const front = f.child(parentId, "frontend"), back = f.child(parentId, "backend");
    await until(() => !!f.store.get("tasks", front.id)?.turnId && !!f.store.get("tasks", back.id)?.turnId);
    assert.deepEqual(f.store.get("tasks", front.id)!.worktrees!.map((r) => r.id), ["frontend"]);
    assert.deepEqual(f.store.get("tasks", back.id)!.worktrees!.map((r) => r.id), ["backend"]);
    assert.equal(f.runtime.active.size, 2);
    await writeFile(join(f.store.get("tasks", front.id)!.worktrees![0].workspace, "login.ts"), "export const frontend = true;");
    await writeFile(join(f.store.get("tasks", back.id)!.worktrees![0].workspace, "login.ts"), "export const backend = true;");
    await f.finish(front); await f.finish(back);
    const reviewer = f.child(parentId, "verify");
    await until(() => !!f.store.get("tasks", reviewer.id)?.turnId);
    const workspace = f.store.get("tasks", reviewer.id)!.workspace!;
    assert.match(await readFile(join(workspace, "frontend", "login.ts"), "utf8"), /frontend/);
    assert.match(await readFile(join(workspace, "backend", "login.ts"), "utf8"), /backend/);
    assert.equal(git(join(f.dir, "frontend"), "status", "--porcelain"), "");
    await f.finish(reviewer);
    const boss = f.child(parentId, "summary");
    await until(() => !!f.store.get("tasks", boss.id)?.turnId);
    const bossThread = f.calls.find((c) => c.method === "thread/start" && c.params.cwd === f.store.get("tasks", boss.id)!.workspace)!;
    assert.equal(bossThread.params.sandbox, "read-only");
    assert.match(bossThread.params.developerInstructions, /Boss's real review/);
    await f.finish(boss, "Boss reviewed the brief and all integration evidence");
    let parent = f.store.get("tasks", parentId)!;
    assert.equal(parent.workflow!.phase, "acceptance");
    await assert.rejects(f.runtime.merge(front.id, "frontend"), /ตรวจรับ/);
    await f.runtime.workflowDecision({ id: parentId, revision: parent.workflow!.revision, decision: "accept" });
    await assert.rejects(f.runtime.merge(front.id, "frontend"), /diff/);
    await f.runtime.merge(front.id, "frontend", latestDelivery(f.store.get("tasks", front.id)!)!.repositories[0].fingerprint);
    parent = f.store.get("tasks", parentId)!;
    await assert.rejects(f.runtime.workflowDecision({ id: parentId, revision: parent.workflow!.revision, decision: "close" }), /ไม่ครบ/);
    await assert.rejects(f.runtime.workflowDecision({ id: design.id, revision: 4, decision: "revise", body: "change" }), /รวมแล้ว/);
    await f.runtime.merge(back.id, "backend", latestDelivery(f.store.get("tasks", back.id)!)!.repositories[0].fingerprint);
    await f.runtime.workflowDecision({ id: parentId, revision: parent.workflow!.revision, decision: "close" });
    assert.equal(f.store.get("tasks", parentId)!.workflow!.phase, "closed");
    assert.match(await readFile(join(f.dir, "frontend", "login.ts"), "utf8"), /frontend/);
    assert.match(await readFile(join(f.dir, "backend", "login.ts"), "utf8"), /backend/);
    assert.equal(parseBackup(JSON.parse(await f.runtime.backups.export())).data.tasks.find((t) => t.id === parentId)!.workflow!.phase, "closed");
  } finally { await f.close(); }
});

test("changing an approved design after dev starts pauses affected tasks, replans, and reuses original worktrees", async () => {
  const f = await setup();
  try {
    const id = await f.start(); await f.throughDesign(id);
    await until(() => !!f.child(id, "frontend").turnId && !!f.child(id, "backend").turnId);
    const workspace = f.child(id, "frontend").workspace;
    const design = f.child(id, "design");
    await f.runtime.workflowDecision({ id: design.id, revision: 1, decision: "revise", body: "change layout after implementation started" });
    let parent = f.store.get("tasks", id)!;
    assert.equal(parent.status, "draft");
    assert.equal(parent.workflow!.phase, "replanning");
    assert.equal(f.child(id, "frontend").workflowBlocked, true);
    await f.finishIntake(parent.planningIntakeId!);
    parent = f.store.get("tasks", id)!;
    f.runtime.confirmPlan({ id, revision: parent.planRevision, designs: [{ taskId: design.id, revision: 1, fingerprint: latestDelivery(design)!.fingerprint, decision: "rerun" }] });
    assert.equal(f.child(id, "frontend").workspace, workspace);
    assert.equal(f.child(id, "frontend").status, "queued");
    const revised = await f.design(id, "blue"); await f.approve(revised);
    await until(() => f.child(id, "frontend").status === "running");
    assert.equal(f.child(id, "frontend").workspace, workspace);
  } finally { await f.close(); }
});

test("failed or unverified evidence never releases dependent stages; snapshot corruption is rejected", async () => {
  const f = await setup();
  try {
    const id = await f.start();
    const design = await f.design(id);
    const file = latestDelivery(design)!.files[0];
    await writeFile(join(f.store.dir, "deliveries", design.id, "1", file.name), "changed");
    await assert.rejects(f.approve(design), /เปลี่ยน|เสียหาย/);
    assert.equal(f.child(id, "frontend").status, "queued");
  } finally { await f.close(); }
  const g = await setup();
  try {
    const id = await g.start(); await g.throughDesign(id);
    const failed = await g.finish(g.child(id, "frontend"), "could not verify", "unverified");
    assert.equal(failed.status, "failed");
    assert.equal(latestDelivery(failed)?.incomplete?.reason, "unknown");
    assert.match(failed.error!, /สมาชิกส่งผลงานที่ยังไม่ครบ/);
    await g.finish(g.child(id, "backend"));
    assert.notEqual(g.child(id, "verify").status, "running");
    assert.notEqual(g.store.get("tasks", id)!.workflow!.phase, "acceptance");
    await g.runtime.stopAll();
    assert.equal(parseBackup(JSON.parse(await g.runtime.backups.export())).data.tasks.find((t) => t.id === failed.id)?.deliveries?.at(-1)?.incomplete?.remaining, "implementation");
  } finally { await g.close(); }
});

test("incomplete workflow results require an explanation before acceptance", async () => {
  const f = await setup();
  try {
    const id = await f.start(); await f.throughDesign(id);
    const task = f.child(id, "frontend");
    await until(() => !!f.store.get("tasks", task.id)?.turnId);
    const current = f.runtime.active.get(task.id)!.task;
    let reply: unknown;
    f.runtime.codex.reply = (_id, result) => { reply = result; };
    await f.runtime.tool(current, "office_submit_result", { output: "stopped", checks: [{ criterion: current.stage!.criteria[0], status: "unverified", evidence: "not run" }] }, 2);
    assert.match(JSON.stringify(reply), /incomplete/);
    assert.equal(f.runtime.active.get(task.id)!.workflowResult, undefined);
  } finally { await f.close(); }
});

test("review copies exclude symlinks and edits invalidate evidence; large untracked changes invalidate deliveries", async () => {
  const f = await setup();
  try {
    const id = await f.start(); await f.throughDesign(id);
    await until(() => !!f.child(id, "frontend").turnId && !!f.child(id, "backend").turnId);
    const front = f.child(id, "frontend"), tree = front.worktrees![0];
    await writeFile(join(tree.workspace, "large.txt"), "x".repeat(130000));
    await writeFile(join(tree.workspace, ".gitignore"), "ignored.ts\n");
    await writeFile(join(tree.workspace, "ignored.ts"), "ignored build output");
    await writeFile(join(tree.workspace, "token.ts"), "export const parseToken = () => true;");
    await symlink(join(f.dir, "frontend"), join(tree.workspace, "source-link"));
    await f.finish(front); await f.finish(f.child(id, "backend"));
    await until(() => !!f.child(id, "verify").turnId);
    await writeFile(join(tree.workspace, "large.txt"), "y".repeat(130000));
    await assert.rejects(assertDeliveryCurrent(f.store.dir, f.store.get("tasks", front.id)!), /โค้ดเปลี่ยน/);
    await writeFile(join(tree.workspace, "large.txt"), "x".repeat(130000));
    await until(() => !!f.child(id, "verify").turnId);
    const reviewer = f.child(id, "verify");
    await assert.rejects(readFile(join(reviewer.workspace!, "frontend", "ignored.ts")), /ENOENT/);
    assert.match(await readFile(join(reviewer.workspace!, "frontend", "token.ts"), "utf8"), /parseToken/);
    await assert.rejects(readFile(join(reviewer.workspace!, "frontend", "source-link", "README.md")), /ENOENT/);
    await writeFile(join(reviewer.workspace!, "frontend", "README.md"), "modified review input");
    await assert.rejects(assertReviewUnchanged(f.store.dir, reviewer), /ผู้ตรวจแก้/);
    assert.equal((await f.finish(reviewer)).status, "failed");
  } finally { await f.close(); }
});

test("restart preserves pending design approval but interrupts execution without replay", async () => {
  const f = await setup();
  const id = await f.start(); await f.design(id);
  await f.runtime.close();
  const store = new Store(join(f.dir, "data"));
  const runtime = new OfficeRuntime(store, "http://127.0.0.1:3210");
  try {
    assert.equal(store.get("tasks", id)!.workflow!.phase, "active");
    assert.equal(store.get("tasks", id)!.status, "waiting");
    const design = store.list("tasks").find((t) => t.stage?.kind === "design")!;
    assert.equal(latestDelivery(design)!.approvedAt, undefined);
    assert.equal(runtime.active.size, 0);
    await runtime.stopAll();
    const exported = JSON.parse(await runtime.backups.export());
    const preview = await runtime.backups.inspect(exported);
    await runtime.backups.restore(exported, preview.token);
    assert.equal(store.get("tasks", id)!.workflow!.phase, "interrupted");
    await assert.rejects(runtime.workflowDecision({ id: design.id, revision: 1, decision: "approve" }), /สิทธิ์รัน/);
  } finally { await runtime.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test("non-code workflows run a real Boss summary and close only on explicit acceptance; duplicate acceptance is rejected", async () => {
  const f = await setup();
  try {
    const proposed: TaskPlan = { ...plan(), assignments: [{ agentId: "atlas", title: "Summary", prompt: "summarize", kind: "general", deliverable: "report", stage: stage("summary", "summary") }] };
    const id = await f.start(proposed);
    await f.finish(f.child(id, "summary"), "report reviewed by Boss");
    const revision = f.store.get("tasks", id)!.workflow!.revision;
    const results = await Promise.allSettled([1, 2].map(() => f.runtime.workflowDecision({ id, revision, decision: "accept" })));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(f.store.get("tasks", id)!.status, "completed");
    assert.equal(f.store.get("tasks", id)!.workflow!.phase, "closed");
  } finally { await f.close(); }
});

test("missing structured evidence fails a stage without dispatching descendants", async () => {
  const f = await setup();
  try {
    const id = await f.start();
    const task = f.child(id, "design");
    await until(() => !!f.store.get("tasks", task.id)?.turnId);
    f.runtime.codex.onNotification("turn/completed", { threadId: f.store.get("tasks", task.id)!.threadId, turn: { status: "completed" } });
    await until(() => f.store.get("tasks", task.id)!.status === "failed");
    assert.match(f.store.get("tasks", task.id)!.error!, /office_submit_result/);
    assert.equal(f.child(id, "frontend").threadId, undefined);
  } finally { await f.close(); }
});

test("changed code blocks acceptance; acceptance survives restart without replaying any execution", async () => {
  const f = await setup();
  const id = await f.start(); await f.throughDesign(id);
  await f.finish(f.child(id, "frontend")); await f.finish(f.child(id, "backend"));
  await f.finish(f.child(id, "verify")); await f.finish(f.child(id, "summary"));
  const front = f.child(id, "frontend"), file = join(front.worktrees![0].workspace, "README.md");
  const original = await readFile(file);
  await writeFile(file, "unreviewed change");
  const revision = f.store.get("tasks", id)!.workflow!.revision;
  await assert.rejects(f.runtime.workflowDecision({ id, revision, decision: "accept" }), /โค้ดเปลี่ยน/);
  assert.equal(f.store.get("tasks", id)!.workflow!.phase, "acceptance");
  await writeFile(file, original);
  await f.runtime.close();
  const store = new Store(join(f.dir, "data"));
  const runtime = new OfficeRuntime(store, "http://127.0.0.1:3210");
  try {
    assert.equal(store.get("tasks", id)!.workflow!.phase, "acceptance");
    assert.equal(runtime.active.size, 0);
    await runtime.workflowDecision({ id, revision, decision: "accept" });
    assert.equal(store.get("tasks", id)!.workflow!.phase, "accepted");
  } finally { await runtime.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test("restart interrupts running implementation and holds all dependent work", async () => {
  const f = await setup();
  const id = await f.start(); await f.throughDesign(id);
  await until(() => !!f.child(id, "frontend").turnId && !!f.child(id, "backend").turnId);
  await f.runtime.close();
  const store = new Store(join(f.dir, "data"));
  const runtime = new OfficeRuntime(store, "http://127.0.0.1:3210");
  try {
    assert.equal(store.get("tasks", id)!.workflow!.phase, "interrupted");
    assert.equal(store.get("tasks", id)!.status, "interrupted");
    assert.equal(store.list("tasks").filter((t) => t.stage && t.stage.kind !== "design").every((t) => t.status === "interrupted"), true);
    assert.equal(runtime.active.size, 0);
  } finally { await runtime.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test("workflow waits for consultations; approved extra rounds retain the original read-only worktree context", async () => {
  const f = await setup();
  try {
    const id = await f.start(); await f.throughDesign(id);
    await until(() => !!f.child(id, "frontend").turnId && !!f.child(id, "backend").turnId);
    const front = f.child(id, "frontend");
    f.runtime.paused = true;
    for (let i = 0; i < 7; i++) await f.runtime.tool(front, "office_message", { agentId: "pixel", body: `question ${i}` }, i);
    const approval = f.store.list("approvals").find((a) => a.type === "conversation")!;
    assert.ok(approval);
    await f.finish(front); await f.finish(f.child(id, "backend"));
    f.runtime.paused = false; f.runtime.tick();
    await f.finish(f.child(id, "verify")); await f.finish(f.child(id, "summary"));
    for (const consultation of f.store.list("tasks").filter((t) => t.rootId === front.id && t.id !== front.id)) {
      await until(() => !!f.store.get("tasks", consultation.id)?.turnId);
      f.runtime.codex.onNotification("turn/completed", { threadId: f.store.get("tasks", consultation.id)!.threadId, turn: { status: "completed" } });
    }
    assert.equal(f.store.get("tasks", id)!.workflow!.phase, "active");
    await f.runtime.decide({ id: approval.id, approve: true });
    const extra = f.store.list("tasks").at(-1)!;
    assert.equal(extra.rootId, front.id);
    await until(() => !!f.store.get("tasks", extra.id)?.turnId);
    const thread = f.calls.filter((c) => c.method === "thread/start").at(-1)!;
    assert.equal(thread.params.sandbox, "read-only");
    assert.equal(thread.params.cwd, front.workspace);
    f.runtime.codex.onNotification("turn/completed", { threadId: f.store.get("tasks", extra.id)!.threadId, turn: { status: "completed" } });
    assert.equal(f.store.get("tasks", id)!.workflow!.phase, "acceptance");
  } finally { await f.close(); }
});
