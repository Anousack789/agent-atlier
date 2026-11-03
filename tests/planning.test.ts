import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store";
import { OfficeRuntime } from "../server/runtime";
import { parseBackup } from "../server/backup";
import { planInput } from "../shared/validation";
import { createApprovedTask } from "./helpers";
import type { Intake, Task, TaskPlan } from "../shared/types";

const input = { title: "สรุปข้อมูล", prompt: "อ่านข้อมูลและสรุป", agentId: "atlas", projectId: "default", kind: "general" as const };
const plan: TaskPlan = { goal: "สรุปข้อมูล", steps: ["อ่านข้อมูลที่เกี่ยวข้อง", "สรุปข้อค้นพบ"], deliverable: "รายงานสรุป", assignments: [] };
const proposal = { intent: "plan", reply: "เสนอแผนให้ตรวจและยืนยันก่อนเริ่ม", title: input.title, kind: "general", plan };
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) { if (check()) return; await settle(); }
  assert.fail("fake runtime did not settle");
}
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "atelier-planning-"));
  const store = new Store(dir);
  const runtime = new OfficeRuntime(store, "http://127.0.0.1:3210");
  const calls: { method: string; params: Record<string, any> }[] = [];
  runtime.codex.request = async (method, params): Promise<any> => {
    calls.push({ method, params });
    return method === "thread/start" ? { thread: { id: randomUUID() } } : { turn: { id: randomUUID(), status: "inProgress" } };
  };
  runtime.codex.reply = () => {};
  runtime.connection = { state: "ready" };
  async function finishIntake(turnId: string, result: unknown) {
    await until(() => !!store.get("intakes", turnId)?.turnId);
    const turn = runtime.active.get(turnId)!.task as Intake;
    await runtime.tool(turn, "office_intake_result", result, randomUUID());
    runtime.codex.onNotification("turn/completed", { threadId: turn.threadId, turn: { status: "completed" } });
    await settle();
    return store.get("intakes", turnId)!;
  }
  return { dir, store, runtime, calls, finishIntake, async close() { await runtime.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("conversation and clarification never create tasks; intake is read-only and cannot request write approval", async () => {
  const f = setup();
  try {
    f.runtime.saveAgent({ ...f.store.get("agents", "atlas")!, permission: "workspace-write", googleAccess: true });
    const turn = await f.runtime.sendMessage({ projectId: "default", channel: "atlas", body: "คุณคิดอย่างไร" }) as Intake;
    await until(() => !!f.store.get("intakes", turn.id)?.turnId);
    const running = f.runtime.active.get(turn.id)!.task;
    const start = f.calls.find((call) => call.method === "thread/start")!.params;
    assert.equal(start.sandbox, "read-only");
    assert.equal(start.approvalPolicy, "on-request");
    assert.equal(start.approvalsReviewer, "auto_review");
    assert.doesNotMatch(start.developerInstructions, /Boss — team-room/);
    assert.deepEqual(start.dynamicTools.map((tool: { name: string }) => tool.name), ["office_intake_result", "gmail_search", "gmail_read", "calendar_list"]);
    let externalCalls = 0;
    f.runtime.google.execute = async () => { externalCalls++; return { id: "fake", message: "fake" }; };
    for (const tool of ["gmail_send", "calendar_write", "office_remember", "office_request_task", "office_message"])
      await f.runtime.tool(running, tool, {}, tool);
    const replies: unknown[] = [];
    f.runtime.codex.reply = (_id, result) => replies.push(result);
    await f.runtime.codex.onRequest({ id: 42, method: "item/fileChange/requestApproval", params: { threadId: running.threadId } });
    assert.deepEqual(replies, [{ decision: "decline" }]);
    assert.equal(externalCalls, 0);
    assert.equal(f.store.list("approvals").length, 0);
    assert.equal(f.store.list("memories").length, 0);
    f.runtime.codex.onNotification("item/autoApprovalReview/completed", {
      threadId: running.threadId, reviewId: "intake-rejected", action: { type: "applyPatch" }, review: { status: "denied", rationale: "Intake is read-only" },
    });
    await f.finishIntake(turn.id, { intent: "reply", reply: "คำตอบสั้นสำหรับการสนทนา" });
    assert.equal(f.store.list("tasks").length, 0);
    const next = await f.runtime.sendMessage({ projectId: "default", channel: "atlas", body: "ทำอันนั้น" }) as Intake;
    await f.finishIntake(next.id, { intent: "clarify", reply: "หมายถึงงานไหนและต้องการผลลัพธ์อะไร?" });
    assert.equal(f.store.list("tasks").length, 0);
    assert.match(f.store.list("messages").at(-1)!.body, /หมายถึงงานไหน/);
    const backup = parseBackup(JSON.parse(await f.runtime.backups.export()));
    assert.equal(backup.data.approvals[0].status, "declined");
    assert.equal(backup.data.approvals[0].taskId, undefined);
  } finally { await f.close(); }
});

test("plan revisions block stale and repeated confirmation; acknowledgements cannot start a draft", async () => {
  const f = setup();
  try {
    const turn = await f.runtime.sendMessage({ projectId: "default", channel: "atlas", body: input.prompt }) as Intake;
    await f.finishIntake(turn.id, proposal);
    const draft = f.store.list("tasks")[0];
    assert.equal(draft.status, "draft");
    assert.equal(draft.planRevision, 1);
    assert.equal(f.runtime.active.size, 0);
    assert.equal(existsSync(join(f.dir, "worktrees")), false);
    const ack = await f.runtime.sendMessage({ projectId: "default", channel: "atlas", body: "โอเค" }) as Intake;
    await f.finishIntake(ack.id, { intent: "reply", reply: "กดยืนยันและเริ่มงานเมื่อพร้อม" });
    assert.equal(f.store.get("tasks", draft.id)!.status, "draft");
    const revision = f.runtime.preparePlan(draft.id, "เพิ่มตารางสรุปในรายงาน");
    assert.throws(() => f.runtime.confirmPlan({ id: draft.id, revision: 1 }), /แผนเปลี่ยน/);
    await f.finishIntake(revision.id, { intent: "clarify", reply: "ต้องการคอลัมน์อะไร?" });
    assert.equal(f.store.get("tasks", draft.id)!.planReady, false);
    assert.throws(() => f.runtime.confirmPlan({ id: draft.id, revision: 1 }), /แผนเปลี่ยน/);
    const resolved = f.runtime.preparePlan(draft.id, "เพิ่มคอลัมน์ผลลัพธ์");
    const revisedPlan = { ...plan, deliverable: "รายงานพร้อมตาราง" };
    await f.finishIntake(resolved.id, { ...proposal, plan: revisedPlan });
    assert.equal(f.store.get("tasks", draft.id)!.planRevision, 2);
    assert.throws(() => f.runtime.confirmPlan({ id: draft.id, revision: 1 }), /แผนเปลี่ยน/);
    const confirmed = f.runtime.confirmPlan({ id: draft.id, revision: 2 });
    assert.equal(confirmed.status, "queued");
    assert.equal(confirmed.approvedRevision, 2);
    assert.throws(() => f.runtime.confirmPlan({ id: draft.id, revision: 2 }), /ยืนยันแล้ว/);
    assert.equal(f.store.list("tasks").length, 1);
    await until(() => !!f.store.get("tasks", draft.id)?.turnId);
    const execution = f.calls.filter((call) => call.method === "turn/start").at(-1)!;
    assert.match(JSON.stringify(execution.params), /รายงานพร้อมตาราง/);
  } finally { await f.close(); }
});

test("manual task creation plans first; clarification, cancellation and invalid model results stay safe", async () => {
  const f = setup();
  try {
    const draft = f.runtime.createTask(input);
    assert.equal(draft.status, "draft");
    const turnId = f.store.get("tasks", draft.id)!.planningIntakeId!;
    await f.finishIntake(turnId, { intent: "clarify", reply: "ต้องการช่วงเวลาใด?" });
    assert.equal(f.store.get("tasks", draft.id)!.plan, undefined);
    assert.match(f.store.get("tasks", draft.id)!.activity, /รอข้อมูล/);
    assert.throws(() => f.runtime.confirmPlan({ id: draft.id, revision: 1 }));
    const retry = f.runtime.preparePlan(draft.id, "ข้อมูลสัปดาห์นี้");
    await f.runtime.stopTask(draft.id);
    assert.equal(f.store.get("intakes", retry.id)!.status, "cancelled");
    assert.equal(f.store.get("tasks", draft.id)!.status, "cancelled");
    const bad = await f.runtime.sendMessage({ projectId: "default", channel: "atlas", body: "ทำรายงาน" }) as Intake;
    const failed = await f.finishIntake(bad.id, { ...proposal, plan: { ...plan, steps: [] } });
    assert.equal(failed.status, "failed");
    assert.equal(f.store.list("tasks").length, 1);
  } finally { await f.close(); }
});

test("Boss is unique, handles only the team room and dispatches exactly the approved assignments with dependencies", async () => {
  const f = setup();
  try {
    await f.runtime.sendMessage({ projectId: "default", channel: "team", body: "สวัสดี" });
    assert.equal(f.store.list("intakes").length, 0);
    f.runtime.saveAgent({ ...f.store.get("agents", "nova")!, boss: true });
    f.runtime.saveAgent({ ...f.store.get("agents", "atlas")!, boss: true });
    assert.equal(f.store.list("agents").filter((agent) => agent.boss).length, 1);
    const turn = await f.runtime.sendMessage({ projectId: "default", channel: "team", to: "pixel", body: "ค้นข้อมูลแล้วทำรายงาน" }) as Intake;
    assert.equal(turn.agentId, "atlas");
    const assigned: TaskPlan = { ...plan, assignments: [
      { agentId: "nova", title: "ค้นข้อมูล", prompt: "อ่านข้อมูล", kind: "general", deliverable: "ข้อค้นพบ" },
      { agentId: "sage", title: "ทำรายงาน", prompt: "สรุปข้อค้นพบที่ได้รับ", kind: "general", deliverable: "รายงาน", dependsOn: [0] },
    ] };
    await f.finishIntake(turn.id, { ...proposal, plan: assigned });
    assert.match(f.calls[0].params.developerInstructions, /Boss — team-room/);
    assert.equal(f.store.list("tasks").length, 1);
    const parent = f.store.list("tasks")[0];
    f.runtime.confirmPlan({ id: parent.id, revision: 1 });
    assert.throws(() => f.runtime.confirmPlan({ id: parent.id, revision: 1 }));
    const children = f.store.list("tasks").filter((task) => task.parentTaskId === parent.id);
    assert.equal(children.length, 2);
    await until(() => !!f.store.get("tasks", children[0].id)?.turnId);
    assert.equal(f.store.get("tasks", children[1].id)!.status, "queued");
    const first = f.store.get("tasks", children[0].id)!;
    f.runtime.codex.onNotification("item/completed", { threadId: first.threadId, item: { id: "result", type: "agentMessage", text: "ข้อค้นพบจาก Nova" } });
    f.runtime.codex.onNotification("turn/completed", { threadId: first.threadId, turn: { status: "completed" } });
    await until(() => !!f.store.get("tasks", children[1].id)?.turnId);
    assert.match(JSON.stringify(f.calls.filter((call) => call.method === "turn/start").at(-1)!.params), /ข้อค้นพบจาก Nova/);
    const second = f.store.get("tasks", children[1].id)!;
    f.runtime.codex.onNotification("turn/completed", { threadId: second.threadId, turn: { status: "completed" } });
    assert.equal(f.store.get("tasks", parent.id)!.status, "completed");
    f.runtime.saveAgent({ ...f.store.get("agents", "pixel")!, boss: true });
    assert.deepEqual(f.store.list("tasks").filter((task) => task.parentTaskId === parent.id).map((task) => task.agentId), ["nova", "sage"]);
    const privateTurn = await f.runtime.sendMessage({ projectId: "default", channel: "nova", body: "ขอบคุณ" }) as Intake;
    await f.finishIntake(privateTurn.id, { intent: "reply", reply: "ยินดีครับ" });
    assert.doesNotMatch(f.calls.filter((call) => call.method === "thread/start").at(-1)!.params.developerInstructions, /Boss — team-room/);
    assert.equal(planInput.safeParse({ ...assigned, assignments: [{ ...assigned.assignments[0], dependsOn: [0] }] }).success, false);
    f.runtime.paused = true;
    for (let i = 0; i < 6; i++) await f.runtime.tool(children[i % 2], "office_message", { agentId: "pixel", body: `consultation ${i}` }, i);
    const budget = await f.runtime.tool(children[1], "office_message", { agentId: "pixel", body: "one more" }, 99);
    assert.equal((budget as { paused: boolean }).paused, true);
    assert.equal(f.store.list("tasks").filter((task) => task.rootId !== task.id).length, 6);
  } finally { await f.close(); }
});

test("linked in-scope followups reuse the task; scope additions stay drafts and cross-context links fail", async () => {
  const f = setup();
  try {
    const original = createApprovedTask(f.runtime, input);
    f.store.put("tasks", { ...original, status: "completed", workspace: f.dir, output: "[รายงานเดิม](report.md)" });
    const turn = await f.runtime.sendMessage({ projectId: "default", channel: "team", body: "ปรับภาษา", taskId: original.id }).catch((error) => error);
    assert.ok(turn instanceof Error);
    await assert.rejects(f.runtime.sendMessage({ projectId: "default", channel: "nova", body: "ปรับภาษา", taskId: original.id }), /เดียวกัน/);
    f.runtime.saveAgent({ ...f.store.get("agents", "atlas")!, boss: true });
    const followup = await f.runtime.sendMessage({ projectId: "default", channel: "team", body: "ใช้ภาษาไทย", taskId: original.id }) as Intake;
    await f.finishIntake(followup.id, { intent: "continue", reply: "จะใช้ภาษาไทยภายในขอบเขตเดิม", instruction: "ใช้ภาษาไทยในรายงาน" });
    assert.equal(f.store.list("tasks").length, 1);
    assert.deepEqual(f.store.get("tasks", original.id)!.followups, ["ใช้ภาษาไทยในรายงาน"]);
    assert.equal(f.store.get("tasks", original.id)!.workspace, f.dir);
    await until(() => !!f.store.get("tasks", original.id)?.turnId);
    const running = f.store.get("tasks", original.id)!;
    f.runtime.codex.onNotification("item/completed", { threadId: running.threadId, item: { id: "followup-result", type: "agentMessage", text: "รายงานภาษาไทย" } });
    f.runtime.codex.onNotification("turn/completed", { threadId: running.threadId, turn: { status: "completed" } });
    assert.match(f.store.get("tasks", original.id)!.output, /report.md/);
    assert.match(f.store.get("tasks", original.id)!.output, /รายงานภาษาไทย/);
    const addition = await f.runtime.sendMessage({ projectId: "default", channel: "team", body: "เพิ่มรายงานอีกชุด", taskId: original.id }) as Intake;
    await f.finishIntake(addition.id, proposal);
    assert.equal(f.store.list("tasks").length, 2);
    assert.equal(f.store.list("tasks").at(-1)!.status, "draft");
    assert.equal(f.store.list("tasks").at(-1)!.relatedTaskId, original.id);
  } finally { await f.close(); }
});

test("schedule approval covers the recurrence, coalesces missed runs, and scope edits invalidate it", async () => {
  const f = setup();
  try {
    const scheduleInput = { ...input, name: "รายงานประจำวัน", frequency: "daily", time: "09:00", date: "2030-01-01", weekday: 1, timezone: "Asia/Vientiane", enabled: true };
    f.runtime.saveAgent({ ...f.store.get("agents", "atlas")!, boss: true });
    const schedule = f.runtime.saveSchedule(scheduleInput);
    assert.equal(schedule.enabled, false);
    f.runtime.tick(new Date("2030-01-02T05:00:00Z"));
    assert.equal(f.store.list("tasks").length, 1);
    const draft = f.store.get("tasks", schedule.planTaskId!)!;
    assert.equal(f.store.get("intakes", draft.planningIntakeId!)!.intake.boss, false);
    await f.finishIntake(draft.planningIntakeId!, proposal);
    f.runtime.confirmPlan({ id: draft.id, revision: 1 });
    assert.equal(f.store.get("tasks", draft.id)!.status, "completed");
    assert.equal(f.store.get("schedules", schedule.id)!.enabled, true);
    const paused = f.runtime.saveSchedule({ ...scheduleInput, id: schedule.id, enabled: false });
    assert.deepEqual(paused.approvedPlan, plan);
    const enabled = f.runtime.saveSchedule({ ...scheduleInput, id: schedule.id, enabled: true });
    assert.equal(enabled.planTaskId, draft.id);
    f.runtime.paused = true;
    f.store.put("schedules", { ...f.store.get("schedules", schedule.id)!, nextRun: "2020-01-01T00:00:00Z" });
    f.runtime.paused = false;
    f.runtime.tick(new Date("2030-01-02T05:00:00Z"));
    f.runtime.tick(new Date("2030-01-04T05:00:00Z"));
    assert.equal(f.store.list("tasks").length, 2);
    const edited = f.runtime.saveSchedule({ ...scheduleInput, id: schedule.id, prompt: "เพิ่มเป้าหมายใหม่" });
    assert.equal(edited.enabled, false);
    assert.equal(edited.approvedPlan, undefined);
    assert.notEqual(edited.planTaskId, draft.id);
    assert.throws(() => f.runtime.confirmPlan({ id: draft.id, revision: 1 }));
  } finally { await f.close(); }
});

test("coding can be planned read-only, but cannot execute without write permission; private intake cannot dispatch", async () => {
  const f = setup();
  try {
    f.runtime.saveAgent({ ...f.store.get("agents", "atlas")!, boss: true });
    const draft = f.runtime.createTask({ ...input, kind: "code" });
    assert.equal(f.store.get("intakes", f.store.get("tasks", draft.id)!.planningIntakeId!)!.intake.boss, false);
    await f.finishIntake(f.store.get("tasks", draft.id)!.planningIntakeId!, { ...proposal, kind: "code" });
    assert.equal(f.store.get("tasks", draft.id)!.status, "draft");
    assert.equal(existsSync(join(f.dir, "worktrees")), false);
    assert.throws(() => f.runtime.confirmPlan({ id: draft.id, revision: 1 }), /สิทธิ์แก้ไฟล์/);
    const turn = await f.runtime.sendMessage({ projectId: "default", channel: "atlas", body: "เพิ่มคนช่วย" }) as Intake;
    const failed = await f.finishIntake(turn.id, { ...proposal, plan: { ...plan, assignments: [{ agentId: "nova", title: "ช่วย", prompt: "อ่านข้อมูล", kind: "general", deliverable: "สรุป" }] } });
    assert.equal(failed.status, "failed");
    assert.equal(f.store.list("tasks").length, 1);
  } finally { await f.close(); }
});

test("cancelling a queued child settles its parent and restart never dispatches children of interrupted batches", async () => {
  const f = setup();
  try {
    const parent = createApprovedTask(f.runtime, input);
    f.store.put("tasks", { ...parent, status: "waiting" });
    const child = createApprovedTask(f.runtime, { ...input, agentId: "nova" }, { parentTaskId: parent.id });
    await f.runtime.stopTask(child.id);
    assert.equal(f.store.get("tasks", parent.id)!.status, "failed");
    const restartedParent = createApprovedTask(f.runtime, input);
    f.store.put("tasks", { ...restartedParent, status: "waiting" });
    const pending = createApprovedTask(f.runtime, { ...input, agentId: "sage" }, { parentTaskId: restartedParent.id });
    f.runtime.paused = true;
    await f.runtime.close();
    const store = new Store(f.dir);
    const runtime = new OfficeRuntime(store, "http://127.0.0.1:3210");
    assert.equal(store.get("tasks", restartedParent.id)!.status, "interrupted");
    assert.equal(store.get("tasks", pending.id)!.status, "interrupted");
    await runtime.close();
    rmSync(f.dir, { recursive: true, force: true });
  } catch (error) { await f.close(); throw error; }
});

test("restart preserves drafts, interrupts intake, holds legacy queued tasks and pauses unapproved schedules", async () => {
  const f = setup();
  const draft = f.runtime.createTask(input);
  const old: Task = { ...draft, id: "legacy", rootId: "legacy", status: "queued", planningIntakeId: undefined };
  f.store.put("tasks", old);
  f.store.put("schedules", { id: "legacy-schedule", name: "Legacy", ...input, frequency: "daily", time: "09:00", date: "2030-01-01", weekday: 1, timezone: "Asia/Vientiane", enabled: true, nextRun: "2020-01-01T00:00:00Z" });
  await f.runtime.close();
  const store = new Store(f.dir);
  const runtime = new OfficeRuntime(store, "http://127.0.0.1:3210");
  try {
    assert.equal(store.get("tasks", draft.id)!.status, "draft");
    assert.equal(store.get("tasks", "legacy")!.status, "draft");
    assert.equal(store.list("intakes")[0].status, "interrupted");
    assert.equal(store.get("schedules", "legacy-schedule")!.enabled, false);
    const backup = JSON.parse(await runtime.backups.export());
    assert.equal(backup.data.tasks.length, 2);
    assert.equal(backup.data.tasks[0].status, "draft");
  } finally { await runtime.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("member tool settings apply to the next round and isolate Codex replies", async () => {
  const f = setup();
  try {
    const { runtime, store } = f;
    const alternate = runtime.codexWithoutSerena;
    alternate.start = async () => {};
    alternate.request = runtime.codex.request;
    const first = await runtime.sendMessage({ projectId: "default", channel: "atlas", body: "first" });
    await until(() => !!store.get("intakes", first.id)?.turnId);
    const initial = runtime.active.get(first.id)!;
    runtime.saveAgent({ ...store.get("agents", "atlas")!, serena: false, ponytail: false });
    assert.equal(initial.client, runtime.codex);
    await f.finishIntake(first.id, { intent: "reply", reply: "เรียบร้อย" });
    const second = await runtime.sendMessage({ projectId: "default", channel: "atlas", body: "second" });
    await until(() => !!store.get("intakes", second.id)?.turnId);
    const current = runtime.active.get(second.id)!;
    assert.equal(current.client, alternate);
    const starts = f.calls.filter((call) => call.method === "thread/start");
    assert.match(starts[0].params.developerInstructions, /Use ponytail full/);
    assert.doesNotMatch(starts[1].params.developerInstructions, /Use ponytail full|use Serena first/);

    const replies: string[] = [];
    runtime.codex.replyError = () => replies.push("wrong process rejected");
    alternate.reply = () => replies.push("correct process replied");
    const request = { id: 42, method: "item/fileChange/requestApproval", params: { threadId: current.task.threadId } };
    await runtime.codex.onRequest(request);
    await alternate.onRequest(request);
    assert.deepEqual(replies, ["wrong process rejected", "correct process replied"]);
  } finally {
    await f.close();
  }
});
