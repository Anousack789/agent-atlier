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
import { assertDeliveryCurrent, assertReviewUnchanged, dependencyFailureError, incompleteDeliveryError, latestDelivery, readDeliveryFile, recoverLegacyDesignReview, summaryFingerprint, summaryMergeStatus, validateWorkflow } from "../server/workflow";
import { legacyDesignApprovalCriterion, legacyDesignTaskId } from "../shared/workflow";
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
  async function finish(task: Task, output = "verified result", status: "passed" | "failed" | "unverified" = "passed", waitingForUser?: boolean, verificationOnly?: boolean, readyForReview?: boolean) {
    await until(() => !!store.get("tasks", task.id)?.turnId && runtime.active.has(task.id));
    const current = runtime.active.get(task.id)!.task;
    await runtime.tool(current, "office_submit_result", { output, checks: current.stage!.criteria.map((criterion) => ({ criterion, status, evidence: "fake-provider fixture evidence" })), ...(status === "passed" ? {} : { incomplete: { reason: "unknown", completed: "inspection", remaining: verificationOnly ? "browser checks" : "implementation", needed: "approved plan", waitingForUser, verificationOnly, readyForReview } }) }, 2);
    runtime.codex.onNotification("turn/completed", { threadId: current.threadId, turn: { status: "completed" } });
    await until(() => ["completed", "failed", "paused"].includes(store.get("tasks", task.id)!.status));
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
    const designThread = f.calls.find((c) => c.method === "thread/start" && c.params.cwd === design.workspace)!;
    assert.doesNotMatch(designThread.params.developerInstructions, /may start a temporary dev server/);
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
    const frontThread = f.calls.find((c) => c.method === "thread/start" && c.params.cwd === f.store.get("tasks", front.id)!.workspace)!;
    assert.match(frontThread.params.developerInstructions, /may start a temporary dev server.*assigned repository worktree/);
    assert.equal(f.runtime.active.size, 2);
    await writeFile(join(f.store.get("tasks", front.id)!.worktrees![0].workspace, "login.ts"), "export const frontend = true;");
    await writeFile(join(f.store.get("tasks", back.id)!.worktrees![0].workspace, "login.ts"), "export const backend = true;");
    await f.finish(front); await f.finish(back);
    const reviewer = f.child(parentId, "verify");
    await until(() => !!f.store.get("tasks", reviewer.id)?.turnId);
    const workspace = f.store.get("tasks", reviewer.id)!.workspace!;
    const reviewThread = f.calls.find((c) => c.method === "thread/start" && c.params.cwd === workspace)!;
    assert.match(reviewThread.params.developerInstructions, /may start a temporary dev server.*prepared review copy.*without modifying the code under review/);
    for (const { params } of [frontThread, reviewThread]) {
      assert.match(params.developerInstructions, /Bind only to 127\.0\.0\.1 or ::1 on a free port/);
      assert.equal(params.sandbox, "workspace-write");
      assert.equal(params.approvalPolicy, "on-request");
      assert.equal(params.approvalsReviewer, "auto_review");
    }
    assert.match(await readFile(join(workspace, "frontend", "login.ts"), "utf8"), /frontend/);
    assert.match(await readFile(join(workspace, "backend", "login.ts"), "utf8"), /backend/);
    assert.equal(git(join(f.dir, "frontend"), "status", "--porcelain"), "");
    await f.finish(reviewer);
    const boss = f.child(parentId, "summary");
    await until(() => !!f.store.get("tasks", boss.id)?.turnId);
    const bossThread = f.calls.find((c) => c.method === "thread/start" && c.params.cwd === f.store.get("tasks", boss.id)!.workspace)!;
    assert.equal(bossThread.params.sandbox, "read-only");
    assert.match(bossThread.params.developerInstructions, /Boss's real review/);
    assert.doesNotMatch(bossThread.params.developerInstructions, /may start a temporary dev server/);
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

test("workflow approval rejects a corrupted snapshot", async () => {
  const f = await setup();
  try {
    const id = await f.start();
    const design = await f.design(id);
    const file = latestDelivery(design)!.files[0];
    await writeFile(join(f.store.dir, "deliveries", design.id, "1", file.name), "changed");
    await assert.rejects(f.approve(design), /เปลี่ยน|เสียหาย/);
    assert.equal(f.child(id, "frontend").status, "queued");
  } finally { await f.close(); }
});

test("blocked work can be discussed read-only and explicitly resumed in its original worktree", async () => {
  const g = await setup();
  try {
    const id = await g.start(); await g.throughDesign(id);
    const blocked = await g.finish(g.child(id, "frontend"), "could not verify", "unverified", true);
    assert.equal(blocked.status, "paused");
    assert.equal(latestDelivery(blocked)?.incomplete?.reason, "unknown");
    await g.finish(g.child(id, "backend"));
    assert.equal(g.child(id, "verify").status, "queued");

    const correction = "ใช้ repository alias backend-v2 แล้วทำต่อเลย";
    const reply = await g.runtime.sendMessage({ projectId: blocked.projectId, channel: blocked.channel, taskId: blocked.id, taskSession: true, body: correction }) as Intake;
    assert.equal(reply.agentId, blocked.agentId);
    await until(() => !!g.store.get("intakes", reply.id)?.turnId);
    const running = g.store.get("intakes", reply.id)!;
    const thread = g.calls.findLast((call) => call.method === "thread/start")!.params;
    assert.equal(thread.sandbox, "read-only");
    assert.match(thread.developerInstructions, /ทำงานต่อ/);
    g.runtime.codex.onNotification("item/completed", { threadId: running.threadId, item: { type: "agentMessage", id: "answer", text: "ยืนยัน alias แล้ว กดทำงานต่อ" } });
    g.runtime.codex.onNotification("turn/completed", { threadId: running.threadId, turn: { status: "completed" } });
    assert.equal(g.child(id, "frontend").status, "paused");

    const parent = g.store.get("tasks", id)!;
    g.store.put("tasks", { ...parent, planRevision: parent.planRevision! + 1 });
    await assert.rejects(g.runtime.resumeTask({ id: blocked.id })!, /แผนที่อนุมัติ/);
    g.store.put("tasks", parent);
    g.store.put("tasks", { ...blocked, worktrees: blocked.worktrees!.map((tree) => ({ ...tree, mergedAt: new Date().toISOString() })) });
    await assert.rejects(g.runtime.resumeTask({ id: blocked.id })!, /แผนที่อนุมัติ/);
    g.store.put("tasks", blocked);
    const file = latestDelivery(g.child(id, "design"))!.files[0];
    const path = join(g.store.dir, "deliveries", g.child(id, "design").id, "1", file.name);
    const bytes = await readFile(path);
    await writeFile(path, "corrupt");
    await assert.rejects(g.runtime.resumeTask({ id: blocked.id })!, /เปลี่ยนหรือหาย/);
    assert.equal(g.child(id, "frontend").status, "paused");
    await writeFile(path, bytes);

    const resume = g.runtime.resumeTask({ id: blocked.id, body: "ตรวจ API contract ก่อน" });
    await assert.rejects(g.runtime.resumeTask({ id: blocked.id })!, /กำลังเปลี่ยน workflow/);
    await assert.rejects(g.runtime.workflowDecision({
      id: blocked.id, decision: "failWork", revision: 1, fingerprint: latestDelivery(blocked)!.fingerprint, body: "reject while resuming",
    }), /กำลังเปลี่ยน workflow/);
    await resume;
    await until(() => g.child(id, "frontend").status === "running" && !!g.child(id, "frontend").turnId);
    const resumed = g.child(id, "frontend");
    assert.deepEqual(resumed.worktrees, blocked.worktrees);
    assert.equal(resumed.approvedRevision, blocked.approvedRevision);
    const turn = g.calls.findLast((call) => call.method === "turn/start")!.params;
    assert.equal(turn.sandboxPolicy.type, "workspaceWrite");
    assert.deepEqual(turn.sandboxPolicy.writableRoots, [blocked.workspace]);
    assert.equal(turn.sandboxPolicy.networkAccess, false);
    assert.match(turn.input[1].text, /Continue in the original worktree from the previous diff and evidence/);
    const context = turn.input[0].text;
    for (const expected of [correction, "ยืนยัน alias แล้ว", "ตรวจ API contract ก่อน", "could not verify", '"needed":"approved plan"'])
      assert.ok(context.includes(expected), expected);
    const partial = await g.finish(resumed, "API check found a defect", "failed", true);
    assert.equal(partial.status, "paused");
    assert.equal(latestDelivery(partial)?.checks[0]?.status, "failed");
    assert.equal(g.child(id, "verify").status, "queued");
    await g.runtime.resumeTask({ id: partial.id, body: "แก้ API แล้วตรวจอีกครั้ง" });
    await until(() => g.child(id, "frontend").status === "running" && !!g.child(id, "frontend").turnId);
    const finalRound = g.child(id, "frontend");
    assert.equal(finalRound.id, blocked.id);
    assert.deepEqual(finalRound.worktrees, blocked.worktrees);
    await g.finish(finalRound);
    await until(() => g.child(id, "verify").status === "running");
    assert.deepEqual(g.child(id, "frontend").deliveries?.map((delivery) => delivery.revision), [1, 2, 3]);
  } finally { await g.close(); }
});

test("task chat resumes approved blocked work once and leaves approval gates in place", async () => {
  const f = await setup();
  try {
    const id = await f.start(); await f.throughDesign(id);
    const paused = await f.finish(f.child(id, "frontend"), "blocked", "unverified", true);
    const message = { projectId: paused.projectId, channel: paused.channel, taskId: paused.id, taskSession: true, body: "ทำต่อเลย" };
    const approval = {
      id: randomUUID(), type: "external" as const, status: "unknown" as const, title: "Check destination",
      details: "Check", projectId: paused.projectId, agentId: paused.agentId, taskId: paused.id, payload: {}, createdAt: paused.createdAt,
    };
    f.store.put("approvals", approval);
    await f.runtime.sendMessage(message);
    assert.equal(f.child(id, "frontend").status, "paused");
    assert.match(f.store.list("messages").at(-1)!.body, /ตรวจบริการปลายทาง/);
    f.store.put("approvals", { ...approval, status: "approved" });
    const starts = () => f.calls.filter(({ method }) => method === "turn/start").length;
    const before = starts();
    await Promise.all([f.runtime.sendMessage(message), f.runtime.sendMessage(message)]);
    await until(() => !!f.child(id, "frontend").turnId && f.child(id, "frontend").turnId !== paused.turnId);
    const resumed = f.child(id, "frontend");
    assert.deepEqual(resumed.worktrees, paused.worktrees);
    assert.deepEqual(resumed.resumeNotes, ["ทำต่อเลย"]);
    assert.equal(starts(), before + 1);
    assert.equal(f.store.list("messages").filter((m) => m.from === "user" && m.taskId === paused.id).length, 3);
  } finally { await f.close(); }
});

test("human review records mixed outcomes on the exact delivery and requeues dependent work", async () => {
  const f = await setup();
  try {
    const proposed = plan();
    proposed.assignments[1].stage!.criteria.push("mobile", "API");
    const id = await f.start(proposed);
    await f.throughDesign(id);
    const work = await f.finish(f.child(id, "frontend"), "implementation complete", "unverified", false, true);
    await f.finish(f.child(id, "backend"));
    await until(() => f.child(id, "verify").activity === "รอขั้นก่อนหน้า" && f.child(id, "summary").activity === "รอขั้นก่อนหน้า");
    const restarted = new OfficeRuntime(new Store(f.store.dir), "http://127.0.0.1:3210");
    assert.equal(f.store.get("tasks", id)?.workflow?.phase, "active");
    await restarted.close();
    const delivery = latestDelivery(work)!;
    const checks = delivery.checks.map(({ criterion }, index) => ({
      criterion, outcome: index === 0 ? "verified" : "riskAccepted", evidence: index === 0 ? "Checked desktop" : "No test session",
    }));
    const input = { id: work.id, decision: "reviewWork", revision: delivery.revision, fingerprint: delivery.fingerprint, checks };
    await assert.rejects(f.runtime.workflowDecision({ ...input, revision: delivery.revision + 1 }), /เวอร์ชัน/);
    await assert.rejects(f.runtime.workflowDecision({ ...input, checks: checks.slice(1) }), /ครบทุกเกณฑ์/);
    await assert.rejects(f.runtime.workflowDecision({ ...input, fingerprint: "0".repeat(64) }), /ยืนยันไม่ได้/);
    await assert.rejects(f.runtime.workflowDecision(input, "chat-message"), /ยืนยันไม่ได้/);

    for (const changes of [
      { incomplete: { ...delivery.incomplete!, waitingForUser: true } },
      { checks: delivery.checks.map((check) => ({ ...check, status: "failed" as const })) },
    ]) {
      f.store.put("tasks", { ...work, deliveries: [{ ...delivery, ...changes }] });
      await assert.rejects(f.runtime.workflowDecision(input), /ยืนยันไม่ได้/);
    }
    f.store.put("tasks", work);

    const path = join(work.worktrees![0].workspace, "README.md");
    const original = await readFile(path);
    await writeFile(path, "changed after delivery");
    await assert.rejects(f.runtime.workflowDecision(input), /โค้ดเปลี่ยน/);
    await writeFile(path, original);

    await f.runtime.workflowDecision(input);
    const reviewed = f.child(id, "frontend");
    assert.equal(reviewed.status, "completed");
    assert.deepEqual(latestDelivery(reviewed)?.humanReview?.checks, checks);
    assert.deepEqual(latestDelivery(reviewed)?.checks, delivery.checks);
    await assert.rejects(f.runtime.workflowDecision(input), /ยืนยันไม่ได้/);
    const verify = await f.finish(f.child(id, "verify"));
    assert.ok(f.calls.some((call) => call.method === "turn/start" && call.params.threadId === verify.threadId &&
      call.params.input[0].text.includes('"outcome":"riskAccepted"')));
    await f.finish(f.child(id, "summary"));
    assert.equal(f.store.get("tasks", id)?.workflow?.phase, "acceptance");
    assert.ok(f.child(id, "frontend").worktrees?.every((tree) => !tree.mergedAt));
  } finally { await f.close(); }
});

test("legacy unverified work without an explicit continuation choice waits for the user to decide whether it failed", async () => {
  const f = await setup();
  try {
    const id = await f.start();
    await f.throughDesign(id);
    const work = await f.finish(f.child(id, "frontend"), "live verification unavailable", "unverified");
    assert.equal(work.status, "paused");
    assert.equal(work.error, undefined);
    assert.equal(latestDelivery(work)?.incomplete?.waitingForUser, undefined);
    assert.equal(latestDelivery(work)?.checks[0]?.status, "unverified");
    const delivery = latestDelivery(work)!;
    await assert.rejects(f.runtime.workflowDecision({
      id: work.id, decision: "reviewWork", revision: delivery.revision, fingerprint: delivery.fingerprint,
      checks: delivery.checks.map(({ criterion }) => ({ criterion, outcome: "riskAccepted", evidence: "accept" })),
    }), /ยืนยันไม่ได้/);
    await f.finish(f.child(id, "backend"));
    assert.equal(f.child(id, "verify").status, "queued");
    const rejection = { id: work.id, decision: "failWork", revision: delivery.revision, fingerprint: delivery.fingerprint, body: "ยังขาด mobile layout" };
    await assert.rejects(f.runtime.workflowDecision({ ...rejection, revision: delivery.revision + 1 }), /เวอร์ชัน/);
    await assert.rejects(f.runtime.workflowDecision({ ...rejection, fingerprint: "0".repeat(64) }), /ยังรอการตัดสิน/);
    await assert.rejects(f.runtime.workflowDecision({ ...rejection, body: " " }), /ระบุเหตุผล/);
    await assert.rejects(f.runtime.workflowDecision(rejection, "chat-message"), /ยังรอการตัดสิน/);
    await f.runtime.workflowDecision(rejection);
    await assert.rejects(f.runtime.workflowDecision(rejection), /ยังรอการตัดสิน/);
    const failed = f.child(id, "frontend");
    assert.equal(failed.status, "failed");
    assert.deepEqual(latestDelivery(failed)?.checks, delivery.checks);
    assert.equal(latestDelivery(failed)?.humanRejection?.reason, rejection.body);
    assert.equal(latestDelivery(failed)?.humanRejection?.decidedBy, "user");
    assert.deepEqual(failed.worktrees, work.worktrees);
    assert.throws(() => f.runtime.resumeTask({ id: failed.id }), /ยังไม่พร้อมทำต่อ/);
    assert.equal(f.child(id, "verify").status, "queued");
    assert.equal(f.child(id, "verify").activity, "รอขั้นก่อนหน้า");
    const restarted = new OfficeRuntime(new Store(f.store.dir), "http://127.0.0.1:3210");
    try {
      assert.equal(f.store.get("tasks", id)?.workflow?.phase, "active");
      assert.deepEqual(latestDelivery(f.child(id, "frontend"))?.humanRejection, latestDelivery(failed)?.humanRejection);
      assert.equal(f.child(id, "frontend").status, "failed");
    } finally { await restarted.close(); }
  } finally { await f.close(); }
});

test("work continues twice in its original worktree and keeps the budget after a manual resume", async () => {
  const f = await setup();
  try {
    const id = await f.start();
    await f.throughDesign(id);
    let work = f.child(id, "frontend");
    await until(() => !!f.child(id, "frontend").turnId);
    work = f.child(id, "frontend");
    const original = work.worktrees;
    for (let count = 1; count <= 2; count++) {
      const oldTurn = work.turnId;
      await f.finish(work, `work still pending ${count}`, "failed", false);
      await until(() => {
        const next = f.child(id, "frontend");
        return !!next.turnId && next.turnId !== oldTurn && next.autoContinuation?.count === count;
      });
      work = f.child(id, "frontend");
      assert.deepEqual(work.worktrees, original);
      assert.ok(f.calls.some((call) => call.method === "turn/start" && call.params.threadId === work.threadId &&
        call.params.input[0].text.includes("queued this continuation automatically")));
    }
    work = await f.finish(work, "still incomplete", "failed", false);
    assert.equal(work.status, "paused");
    await f.runtime.resumeTask({ id: work.id });
    work = await f.finish(f.child(id, "frontend"), "still incomplete after manual resume", "failed", false);
    assert.equal(work.status, "paused");
    assert.deepEqual(work.autoContinuation, { count: 2 });
    assert.deepEqual(work.deliveries?.map(({ revision }) => revision), [1, 2, 3, 4]);
  } finally { await f.close(); }
});

test("unknown external outcomes prevent automatic continuation", async () => {
  const f = await setup();
  try {
    const id = await f.start();
    await f.throughDesign(id);
    const work = f.child(id, "frontend");
    f.store.put("approvals", {
      id: randomUUID(), type: "external", status: "unknown", taskId: work.id, title: "Test external action",
      details: "", projectId: work.projectId, agentId: work.agentId, payload: {}, createdAt: new Date().toISOString(),
    });
    await f.finish(work, "implementation pending", "failed", false);
    await until(() => f.child(id, "frontend").activity.includes("ตรวจบริการปลายทาง"));
    assert.equal(f.child(id, "frontend").status, "paused");
    assert.equal(f.child(id, "frontend").autoContinuation, undefined);
  } finally { await f.close(); }
});

test("restart preserves an automatic continuation budget without replaying the queued turn", async () => {
  const f = await setup();
  try {
    const id = await f.start();
    await f.throughDesign(id);
    await f.finish(f.child(id, "backend"));
    f.runtime.setPaused(true);
    await f.finish(f.child(id, "frontend"), "implementation pending", "failed", false);
    await until(() => f.child(id, "frontend").status === "queued");
    const work = f.child(id, "frontend");
    await f.runtime.close();
    const store = new Store(f.store.dir);
    const runtime = new OfficeRuntime(store, "http://127.0.0.1:3210");
    try {
      const interrupted = store.get("tasks", work.id)!;
      assert.equal(interrupted.status, "interrupted");
      assert.deepEqual(interrupted.autoContinuation, { count: 1, fromRevision: 1 });
      assert.deepEqual(interrupted.deliveries, work.deliveries);
      assert.equal(runtime.active.size, 0);
    } finally { await runtime.close(); }
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("known minor misses can be waived without changing evidence or merging", async () => {
  const f = await setup();
  try {
    const id = await f.start();
    await f.throughDesign(id);
    const work = await f.finish(f.child(id, "frontend"), "layout detail remains", "failed", false, false, true);
    const delivery = latestDelivery(work)!;
    assert.equal(work.status, "paused");
    assert.equal(work.autoContinuation, undefined);
    const input = { id: work.id, decision: "reviewWork", revision: delivery.revision, fingerprint: delivery.fingerprint };
    const decision = { criterion: delivery.checks[0].criterion, evidence: "Accepted the layout detail" };
    await assert.rejects(f.runtime.workflowDecision({ ...input, checks: [{ ...decision, outcome: "verified" }] }), /ครบทุกเกณฑ์/);
    await f.runtime.workflowDecision({ ...input, checks: [{ ...decision, outcome: "riskAccepted" }] });
    await f.finish(f.child(id, "backend"));
    await until(() => !!f.child(id, "verify").turnId);
    const reviewed = f.child(id, "frontend");
    assert.deepEqual(latestDelivery(reviewed)?.checks, delivery.checks);
    assert.equal(reviewed.worktrees?.some((tree) => tree.mergedAt), false);
    assert.ok(f.calls.some((call) => call.method === "turn/start" && call.params.threadId === f.child(id, "verify").threadId &&
      call.params.input[0].text.includes("Accepted the layout detail")));
  } finally { await f.close(); }
});

test("startup restores legacy blocked work and unstarted dependents without replay", async () => {
  const f = await setup();
  try {
    const id = await f.start(); await f.throughDesign(id);
    const blocked = await f.finish(f.child(id, "frontend"), "missing implementation", "failed");
    assert.equal(blocked.status, "paused");
    const legacy = latestDelivery(blocked)!;
    assert.equal(legacy.incomplete?.waitingForUser, undefined);
    legacy.incomplete!.waitingForUser = false;
    await f.finish(f.child(id, "backend"));
    f.store.put("tasks", { ...blocked, status: "failed", error: incompleteDeliveryError });
    for (const key of ["verify", "summary"]) {
      const child = f.child(id, key);
      f.store.put("tasks", { ...child, status: "failed", error: dependencyFailureError });
    }
    await f.runtime.close();
    const dir = join(f.dir, "data");
    for (let boot = 0; boot < 2; boot++) {
      const store = new Store(dir);
      const runtime = new OfficeRuntime(store, "http://127.0.0.1:3210");
      try {
        assert.equal(store.get("tasks", id)?.workflow?.phase, "active");
        const recovered = store.get("tasks", blocked.id)!;
        assert.equal(recovered.status, "paused");
        assert.deepEqual(recovered.deliveries, blocked.deliveries);
        for (const key of ["verify", "summary"])
          assert.equal(store.list("tasks").find((task) => task.stage?.key === key)?.status, "queued");
        assert.equal(runtime.active.size, 0);
      } finally { await runtime.close(); }
    }
  } finally { await rm(f.dir, { recursive: true, force: true }); }
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

test("human design approval belongs in the review gate, not the agent's criteria", () => {
  const proposed = plan();
  proposed.assignments[0].stage!.criteria.push(legacyDesignApprovalCriterion);
  assert.throws(() => validateWorkflow(proposed, "atlas", ["frontend", "backend"]), /reviewRequired/);
});

test("startup restores the legacy Sage delivery and queues descendants behind explicit design approval", async () => {
  const f = await setup();
  let runtime = f.runtime;
  const origin = "http://127.0.0.1:3210";
  try {
    const parentId = await f.start();
    const design = await f.design(parentId);
    const parent = f.store.get("tasks", parentId)!;
    const delivery = latestDelivery(design)!;
    const original = delivery.files[0];
    const bytes = await readFile(join(f.store.dir, "deliveries", design.id, "1", original.name));
    const destination = join(f.store.dir, "deliveries", legacyDesignTaskId, "1");
    await mkdir(destination, { recursive: true });
    delivery.files = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
      const name = `preview-${index}.png`;
      await writeFile(join(destination, name), bytes);
      return { ...original, name, path: name };
    }));
    delivery.checks.push({ criterion: legacyDesignApprovalCriterion, status: "unverified", evidence: "waiting for human review" });
    const legacy: Task = { ...design, id: legacyDesignTaskId, rootId: legacyDesignTaskId, status: "failed", error: incompleteDeliveryError,
      stage: { ...design.stage!, criteria: [...design.stage!.criteria, legacyDesignApprovalCriterion] } };
    f.store.remove("tasks", design.id);
    f.store.put("tasks", legacy);
    parent.workflow!.taskIds[0] = legacy.id;
    f.store.put("tasks", parent);
    const descendants = parent.workflow!.taskIds.slice(1);
    for (const id of descendants) {
      const child = f.store.get("tasks", id)!;
      f.store.put("tasks", { ...child, status: "failed", error: dependencyFailureError,
        dependsOn: child.dependsOn!.map((dependency) => dependency === design.id ? legacy.id : dependency) });
    }

    const firstCheck = delivery.checks[0];
    firstCheck.status = "unverified";
    f.store.put("tasks", legacy);
    recoverLegacyDesignReview(f.store);
    assert.equal(f.store.get("tasks", legacy.id)!.status, "failed");
    firstCheck.status = "passed";
    f.store.put("tasks", legacy);
    const preview = join(destination, delivery.files[0].name);
    await writeFile(preview, "corrupt");
    recoverLegacyDesignReview(f.store);
    assert.equal(f.store.get("tasks", legacy.id)!.status, "failed");
    assert.ok(descendants.every((id) => f.store.get("tasks", id)!.status === "failed"));
    await writeFile(preview, bytes);

    await runtime.close();
    let store = new Store(join(f.dir, "data"));
    runtime = new OfficeRuntime(store, origin);
    const restored = store.get("tasks", legacy.id)!;
    assert.equal(restored.status, "completed");
    assert.equal(restored.error, undefined);
    assert.deepEqual(restored.stage!.criteria, design.stage!.criteria);
    assert.deepEqual(latestDelivery(restored), delivery);
    assert.equal(store.get("tasks", parentId)!.workflow!.phase, "active");
    assert.ok(descendants.every((id) => store.get("tasks", id)!.status === "queued"));
    await runtime.close();
    store = new Store(join(f.dir, "data"));
    runtime = new OfficeRuntime(store, origin);
    assert.deepEqual(store.get("tasks", legacy.id), restored);
    runtime.codex.request = f.runtime.codex.request;
    runtime.connection = { state: "ready" };
    await runtime["pump"]();
    assert.equal(runtime.active.size, 0);
    await runtime.workflowDecision({ id: legacy.id, revision: 1, decision: "approve" });
    await until(() => !!store.get("tasks", descendants[0])?.turnId);
    assert.ok(latestDelivery(store.get("tasks", legacy.id)!)!.approvedAt);
  } finally {
    await runtime.close();
    await rm(f.dir, { recursive: true, force: true });
  }
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

test("incomplete review resumes in the same stage and releases its waiting dependent", async () => {
  const f = await setup();
  try {
    const id = await f.start();
    await f.throughDesign(id);
    await Promise.all([f.finish(f.child(id, "frontend")), f.finish(f.child(id, "backend"))]);
    const review = await f.finish(f.child(id, "verify"), "API unavailable", "unverified");
    assert.equal(review.status, "paused");
    assert.equal(f.child(id, "summary").status, "queued");
    assert.equal(f.child(id, "summary").threadId, undefined);
    await f.runtime.resumeTask({ id: review.id });
    await until(() => !!f.child(id, "verify").turnId && f.child(id, "verify").turnId !== review.turnId);
    assert.match(f.calls.at(-1)?.params.input[0].text, /Continue only the outstanding verification/);
    const done = await f.finish(f.child(id, "verify"), "API verified");
    assert.deepEqual(done.deliveries?.map(({ revision }) => revision), [1, 2]);
    await until(() => !!f.child(id, "summary").turnId);
  } finally { await f.close(); }
});

test("summary retries keep revisions but only post when the report changes", async () => {
  const f = await setup();
  try {
    const id = await f.start();
    const design = await f.design(id);
    await f.approve(design);
    await Promise.all([f.finish(f.child(id, "frontend"), "Implementation reports 60 passes"), f.finish(f.child(id, "backend"))]);
    await f.finish(f.child(id, "verify"), "Reviewer ran 35 passes, 5 import errors; checkbox and Retry defects; browser unverified");
    const task = f.child(id, "summary");
    await until(() => !!f.child(id, "summary").turnId);
    const firstContext = f.calls.findLast(({ method }) => method === "turn/start")!.params.input[0].text;
    assert.match(firstContext, /Implementation reports 60 passes/);
    assert.match(firstContext, /Reviewer ran 35 passes, 5 import errors/);
    assert.match(firstContext, /"targetBranch":"main","status":"noMergeRecorded"/);
    const active = f.runtime.active.get(task.id)!.task;
    f.runtime.codex.onNotification("item/completed", { threadId: active.threadId, item: {
      id: "summary-progress", type: "agentMessage", phase: "commentary", text: "[activity] ผมจะตรวจสถานะที่ยืนยันได้",
    } });
    assert.equal(f.child(id, "summary").activityHistory?.at(-1)?.text, "ผมจะตรวจสถานะที่ยืนยันได้");
    const incomplete = "Need to finish the summary";
    const first = await f.finish(task, incomplete, "unverified");
    await f.runtime.resumeTask({ id: task.id });
    await until(() => !!f.child(id, "summary").turnId && f.child(id, "summary").turnId !== first.turnId);
    const second = await f.finish(task, incomplete, "unverified");
    assert.deepEqual(second.deliveries?.map(({ revision }) => revision), [1, 2]);
    const posted = () => f.store.list("messages").filter((m) => m.taskId === task.id && m.from === task.agentId).map((m) => m.deliveryRevision);
    assert.deepEqual(posted(), [1]);
    await f.runtime.resumeTask({ id: task.id });
    await until(() => !!f.child(id, "summary").turnId && f.child(id, "summary").turnId !== second.turnId);
    const done = await f.finish(task, "Implementation reports 60 passes. Reviewer ran 35 passes with 5 import errors. Checkbox and Retry defects remain, and browser behavior is unverified.");
    assert.equal(done.status, "completed");
    assert.deepEqual(posted(), [1, 3]);
    assert.ok(latestDelivery(done)?.prerequisites.some((source) => source.taskId === design.id && source.revision === 1));
  } finally { await f.close(); }
});

test("a queued summary reuses the complete report until source evidence changes", async () => {
  const f = await setup();
  try {
    const id = await f.start(); await f.throughDesign(id);
    await Promise.all([f.finish(f.child(id, "frontend")), f.finish(f.child(id, "backend"))]);
    const review = await f.finish(f.child(id, "verify"));
    const report = await f.finish(f.child(id, "summary"), "Boss report");
    const parent = f.store.get("tasks", id)!;
    const starts = () => f.calls.filter(({ method }) => method === "turn/start").length;
    const queueSummary = async () => {
      f.store.put("tasks", { ...parent, workflow: { ...parent.workflow!, phase: "active" } });
      f.store.put("tasks", { ...report, status: "queued" });
      f.runtime.tick();
    };
    const before = starts();
    await queueSummary();
    await until(() => f.child(id, "summary").status === "completed");
    assert.equal(starts(), before);
    assert.equal(f.child(id, "summary").deliveries?.length, 1);
    assert.equal(f.store.list("messages").filter((m) => m.body === "Boss report").length, 1);
    const source = latestDelivery(review)!;
    f.store.put("tasks", { ...review, deliveries: [{ ...source, fingerprint: "changed evidence" }] });
    await queueSummary();
    await until(() => starts() === before + 1);
  } finally { await f.close(); }
});

test("summary evidence distinguishes merge, missing repo, and human decisions while ignoring copy paths", () => {
  const tree = { id: "one", name: "One", path: "/one", workspace: "/work/one", branch: "topic", baseBranch: "uat", baseCommit: "base" };
  const source = { stage: stage("work", "work", ["one", "two", "missing"]), worktrees: [
    { ...tree, mergedAt: "2026-11-04T00:00:00Z" }, { ...tree, id: "two", name: "Two" },
  ] } as Task;
  const merge = summaryMergeStatus(source);
  assert.deepEqual(merge.map(({ status }) => status), ["recordedMerged", "noMergeRecorded", "unknown"]);
  const result = { output: "Report /copy-a/artifacts/report.md", checks: [] };
  const evidence = { revision: 8, merge, outcome: "riskAccepted" };
  const fingerprint = summaryFingerprint(evidence, result, "/copy-a");
  assert.equal(fingerprint, summaryFingerprint(evidence, { ...result, output: result.output.replace("copy-a", "copy-b") }, "/copy-b"));
  assert.notEqual(fingerprint, summaryFingerprint({ ...evidence, outcome: "verified" }, result, "/copy-a"));
  assert.notEqual(fingerprint, summaryFingerprint({ ...evidence, revision: 9 }, result, "/copy-a"));
  assert.notEqual(fingerprint, summaryFingerprint({ ...evidence, merge: merge.slice(1) }, result, "/copy-a"));
});

test("missing structured evidence fails a stage without dispatching descendants", async () => {
  const f = await setup();
  try {
    const id = await f.start();
    const task = f.child(id, "design");
    await until(() => !!f.store.get("tasks", task.id)?.turnId);
    const first = f.store.get("tasks", task.id)!;
    f.runtime.codex.onNotification("turn/completed", { threadId: first.threadId, turn: { id: first.turnId, status: "completed" } });
    await until(() => f.store.get("tasks", task.id)?.turnId !== first.turnId);
    const retry = f.store.get("tasks", task.id)!;
    assert.deepEqual(f.calls.at(-1)?.params.sandboxPolicy, { type: "readOnly" });
    assert.equal(f.calls.at(-1)?.params.approvalPolicy, "never");
    f.runtime.codex.onNotification("turn/completed", { threadId: retry.threadId, turn: { id: retry.turnId, status: "completed" } });
    await until(() => f.store.get("tasks", task.id)!.status === "failed");
    assert.equal(f.calls.filter(({ method, params }) => method === "turn/start" && params.threadId === first.threadId).length, 2);
    assert.match(f.store.get("tasks", task.id)!.error!, /office_submit_result/);
    assert.equal(f.child(id, "frontend").threadId, undefined);
  } finally { await f.close(); }
});

test("rejected workflow evidence names the missing criterion and survives turn completion", async () => {
  const f = await setup();
  try {
    const id = await f.start();
    const task = f.child(id, "design");
    await until(() => !!f.store.get("tasks", task.id)?.turnId);
    const active = f.runtime.active.get(task.id)!.task;
    await f.runtime.tool(active, "office_submit_result", {
      output: "review report", checks: [{ criterion: "paraphrased criterion", status: "passed", evidence: "test ran" }],
    }, 2);
    const turnId = active.turnId;
    f.runtime.codex.onNotification("turn/completed", { threadId: active.threadId, turn: { id: turnId, status: "completed" } });
    await until(() => active.turnId !== turnId);
    assert.match(f.calls.at(-1)?.params.input[0].text, /design criterion/);
    f.runtime.codex.onNotification("turn/completed", { threadId: active.threadId, turn: { id: active.turnId, status: "completed" } });
    await until(() => f.store.get("tasks", task.id)!.status === "failed");
    assert.match(f.store.get("tasks", task.id)!.error!, /design criterion/);
    assert.equal(f.child(id, "frontend").threadId, undefined);
  } finally { await f.close(); }
});

test("automatic submission recovery can deliver the original stage for human approval", async () => {
  const f = await setup();
  try {
    const id = await f.start();
    const task = f.child(id, "design");
    await until(() => !!f.store.get("tasks", task.id)?.turnId);
    const first = f.store.get("tasks", task.id)!;
    f.runtime.codex.onNotification("turn/completed", { threadId: first.threadId, turn: { id: first.turnId, status: "completed" } });
    await until(() => f.store.get("tasks", task.id)?.turnId !== first.turnId);
    const delivery = await f.design(id);
    assert.equal(delivery.status, "completed");
    assert.equal(delivery.threadId, first.threadId);
    assert.equal(latestDelivery(delivery)?.approvedAt, undefined);
    assert.equal(f.child(id, "frontend").threadId, undefined);
  } finally { await f.close(); }
});

test("a corrected review submission is accepted once in the same turn", async () => {
  const f = await setup();
  try {
    const id = await f.start(); await f.throughDesign(id);
    await Promise.all([f.finish(f.child(id, "frontend")), f.finish(f.child(id, "backend"))]);
    const task = f.child(id, "verify");
    await until(() => !!f.store.get("tasks", task.id)?.turnId);
    const active = f.runtime.active.get(task.id)!.task;
    const thread = f.calls.filter(({ method }) => method === "thread/start").at(-1);
    assert.match(thread?.params.developerInstructions, /retry in this turn until it returns received: true/);
    const submit = (criterion: string) => f.runtime.tool(active, "office_submit_result", {
      output: "review report", checks: [{ criterion, status: "passed", evidence: "test ran" }],
    }, 2);
    assert.equal(await submit("paraphrased criterion"), undefined);
    assert.deepEqual(await submit(active.stage!.criteria[0]), { received: true, acceptanceRequired: true });
    assert.equal(await submit(active.stage!.criteria[0]), undefined);
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
