import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { readDeliveryFile } from "../server/workflow";
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
    if (method === "thread/resume") return { thread: { id: params.threadId } };
    return method === "thread/start" ? { thread: { id: randomUUID() } } : { turn: { id: randomUUID(), status: "inProgress" } };
  };
  runtime.codex.reply = () => {};
  runtime.connection = { state: "ready" };
  async function finishIntake(turnId: string, result: unknown) {
    await until(() => !!store.get("intakes", turnId)?.turnId);
    const turn = runtime.active.get(turnId)!.task as Intake;
    if (result !== undefined) await runtime.tool(turn, "office_intake_result", result, randomUUID());
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
    const answer = await f.runtime.sendMessage({ projectId: "default", channel: "atlas", body: "สรุปข้อมูลสัปดาห์นี้" }) as Intake;
    await until(() => !!f.store.get("intakes", answer.id)?.turnId);
    const followup = f.calls.filter(({ method }) => method === "turn/start").at(-1)!;
    assert.match(JSON.stringify(followup.params), /หมายถึงงานไหน/);
    await f.finishIntake(answer.id, proposal);
    assert.equal(f.store.list("tasks")[0].status, "draft");
    assert.equal(f.store.list("tasks")[0].approvedRevision, undefined);
    const backup = parseBackup(JSON.parse(await f.runtime.backups.export()));
    assert.equal(backup.data.approvals[0].status, "declined");
    assert.equal(backup.data.approvals[0].taskId, undefined);
  } finally { await f.close(); }
});

test("intake accepts plans without a reply and names invalid fields when no valid result arrives", async () => {
  const f = setup();
  try {
    const send = () => f.runtime.sendMessage({ projectId: "default", channel: "atlas", body: "test kfp-erp-backend แล้วทำสรุปมา" }) as Promise<Intake>;
    const { reply: _reply, ...withoutReply } = proposal;
    const valid = await send();
    assert.equal((await f.finishIntake(valid.id, withoutReply)).status, "completed");
    const [draft] = f.store.list("tasks");
    assert.equal(draft.status, "draft");
    assert.equal(draft.planReady, true);
    assert.equal(draft.approvedRevision, undefined);
    assert.equal(f.store.list("messages").at(-1)?.body, "เสนอแผนแล้ว กรุณาตรวจและยืนยันก่อนเริ่มงาน");
    assert.equal(f.calls.filter(({ method }) => method === "turn/start").length, 1);
    for (const [result, error] of [
      [{ ...withoutReply, plan: { ...plan, steps: undefined } }, /ฟิลด์: plan\.steps/],
      [{ intent: "reply" }, /ฟิลด์: reply/],
      [undefined, /ไม่ได้เรียกเครื่องมือ/],
    ] as const) {
      const turn = await send();
      const failed = await f.finishIntake(turn.id, result);
      assert.equal(failed.status, "failed");
      assert.match(failed.error!, error);
      assert.equal(f.store.list("tasks").length, 1);
    }
  } finally { await f.close(); }
});

test("failed private intake retries the original message and can save a manual draft after retry failure", async () => {
  const f = setup();
  try {
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
    const turn = await f.runtime.sendMessage({ projectId: "default", channel: "atlas", body: input.prompt,
      images: [{ name: "test.png", mime: "image/png", base64: image.toString("base64") }] }) as Intake;
    const manual = { id: turn.id, kind: "general", goal: input.prompt, steps: plan.steps, deliverable: plan.deliverable };
    assert.throws(() => f.runtime.retryIntake({ id: turn.id, retries: 0 }));
    assert.equal((await f.finishIntake(turn.id, {})).status, "failed");
    assert.throws(() => f.runtime.saveManualPlan(manual), /ลองตีความอีกครั้ง/);
    f.runtime.retryIntake({ id: turn.id, retries: 0 });
    assert.throws(() => f.runtime.retryIntake({ id: turn.id, retries: 0 }));
    assert.throws(() => f.runtime.saveManualPlan(manual));
    const retried = await f.finishIntake(turn.id, {});
    assert.equal(retried.status, "failed");
    assert.equal(retried.sourceMessageId, turn.sourceMessageId);
    assert.equal(retried.prompt, turn.prompt);
    const imageInputs = f.calls.filter(({ method }) => method === "turn/start")
      .map(({ params }) => params.input.filter(({ type }: { type: string }) => type === "localImage"));
    assert.equal(imageInputs[0].length, 1);
    assert.deepEqual(imageInputs[1], imageInputs[0]);
    assert.throws(() => f.runtime.retryIntake({ id: turn.id, retries: 0 }), /เปลี่ยนแล้ว/);
    assert.throws(() => f.runtime.saveManualPlan({ ...manual, steps: [] }));
    f.runtime.saveManualPlan(manual);
    const [draft] = f.store.list("tasks");
    assert.equal(draft.status, "draft");
    assert.equal(draft.planReady, true);
    assert.equal(draft.sourceMessageId, turn.sourceMessageId);
    assert.equal(draft.prompt, turn.prompt);
    assert.equal(f.store.list("messages").filter((message) => message.from === "user").length, 1);
    assert.equal(f.runtime.active.size, 0);
    assert.throws(() => f.runtime.saveManualPlan(manual));
    assert.equal(f.runtime.confirmPlan({ id: draft.id, revision: draft.planRevision }).status, "queued");
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
    assert.match(f.calls[0].params.developerInstructions, /active.*queued/);
    assert.equal(f.store.list("tasks").length, 1);
    const parent = f.store.list("tasks")[0];
    assert.equal(parent.plan?.teamAvailability?.find((entry) => entry.agentId === "atlas")?.active, false);
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
    const review = f.store.get("tasks", parent.id)!;
    assert.equal(review.status, "reviewing");
    assert.ok(children.every((child) => f.store.get("tasks", child.id)?.status === "completed"));
    assert.equal(f.runtime.reviewTask({ id: parent.id, decision: "accept", version: review.reviewVersion }).status, "completed");
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

test("single-agent code approval binds only selected repositories to their original paths", async () => {
  const f = setup();
  try {
    f.runtime.saveAgent({ ...f.store.get("agents", "atlas")!, permission: "workspace-write" });
    const repos = Array.from({ length: 5 }, (_, index) => {
      const path = join(f.dir, `repo-${index}`);
      mkdirSync(path);
      const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@localhost", ...args], { cwd: path, stdio: "ignore" });
      git("init", "-b", "main");
      writeFileSync(join(path, "file"), "base");
      git("add", "file");
      git("commit", "-m", "base");
      return { id: `repo-${index}`, name: `Repo ${index}`, path };
    });
    await f.runtime.saveProject({ ...f.store.get("projects", "default")!, repositories: repos });
    const savedRepos = f.store.get("projects", "default")!.repositories!;
    const draft = f.runtime.createTask({ ...input, kind: "code" });
    await f.finishIntake(f.store.get("tasks", draft.id)!.planningIntakeId!, { ...proposal, kind: "code", plan: { ...plan, repositories: ["repo-1"] } });
    f.runtime.paused = true;
    for (const repositories of [[], ["repo-1", "repo-1"], ["missing"]])
      assert.throws(() => f.runtime.confirmPlan({ id: draft.id, revision: 1, repositories }), /repository/);
    assert.throws(() => f.runtime.confirmPlan({ id: draft.id, revision: 2, repositories: ["repo-1"] }), /แผนเปลี่ยน/);
    const repositoryPaths = [savedRepos[1], savedRepos[3]].map(({ id, path }) => ({ id, path }));
    assert.throws(() => f.runtime.confirmPlan({ id: draft.id, revision: 1, repositories: ["repo-1"], repositoryPaths: [{ id: "repo-1", path: "/changed" }] }), /path เปลี่ยน/);
    const approved = f.runtime.confirmPlan({ id: draft.id, revision: 1, repositories: ["repo-1", "repo-3"], repositoryPaths });
    assert.deepEqual(approved.approvedRepositories, [savedRepos[1], savedRepos[3]]);
    f.store.put("projects", { ...f.store.get("projects", "default")!, repositories: [repos[0]] });
    f.runtime.paused = false;
    f.runtime.tick();
    for (let i = 0; i < 100 && !f.store.get("tasks", draft.id)?.turnId && f.store.get("tasks", draft.id)?.status !== "failed"; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    const task = f.store.get("tasks", draft.id)!;
    assert.equal(task.status, "running", task.error);
    assert.deepEqual(task.worktrees?.map(({ id, path }) => ({ id, path })), repositoryPaths);
  } finally { await f.close(); }
});

test("scheduled code keeps approved repository paths and pauses if preparation fails", async () => {
  const f = setup();
  try {
    f.runtime.saveAgent({ ...f.store.get("agents", "atlas")!, permission: "workspace-write" });
    const repo = { id: "kds", name: "KDS", path: join(f.dir, "missing") };
    f.store.put("projects", { ...f.store.get("projects", "default")!, repositories: [repo] });
    const schedule = f.runtime.saveSchedule({ ...input, kind: "code", name: "งานโค้ด", frequency: "daily", time: "09:00", date: "2030-01-01", weekday: 1, timezone: "Asia/Vientiane", enabled: true });
    const draft = f.store.get("tasks", schedule.planTaskId!)!;
    await f.finishIntake(draft.planningIntakeId!, { ...proposal, kind: "code", plan: { ...plan, repositories: [repo.id] } });
    f.runtime.confirmPlan({ id: draft.id, revision: 1, repositories: [repo.id], repositoryPaths: [{ id: repo.id, path: repo.path }] });
    assert.deepEqual(f.store.get("schedules", schedule.id)!.approvedRepositories, [repo]);
    f.store.put("projects", { ...f.store.get("projects", "default")!, repositories: [] });
    f.runtime.tick(new Date("2030-01-02T05:00:00Z"));
    for (let i = 0; i < 100 && !f.store.get("schedules", schedule.id)?.lastError; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    const saved = f.store.get("schedules", schedule.id)!;
    assert.equal(saved.enabled, false);
    assert.match(saved.lastError!, /repository "KDS"/);
    assert.deepEqual(f.store.get("tasks", saved.lastTaskId!)?.approvedRepositories, [repo]);
  } finally { await f.close(); }
});

test("manually entered code plans require repository selection at confirmation", async () => {
  const f = setup();
  try {
    f.runtime.saveAgent({ ...f.store.get("agents", "atlas")!, permission: "workspace-write" });
    const repo = { id: "kds", name: "KDS", path: join(f.dir, "kds") };
    f.store.put("projects", { ...f.store.get("projects", "default")!, repositories: [repo] });
    const turn = await f.runtime.sendMessage({ projectId: "default", channel: "atlas", body: "แก้ KDS" }) as Intake;
    await f.finishIntake(turn.id, {});
    f.runtime.retryIntake({ id: turn.id, retries: 0 });
    await f.finishIntake(turn.id, {});
    f.runtime.saveManualPlan({ id: turn.id, kind: "code", goal: "แก้ KDS", steps: ["แก้โค้ด"], deliverable: "โค้ด" });
    const draft = f.store.list("tasks")[0];
    assert.throws(() => f.runtime.confirmPlan({ id: draft.id, revision: 1 }), /repository/);
    f.runtime.paused = true;
    const confirmed = f.runtime.confirmPlan({ id: draft.id, revision: 1, repositories: [repo.id], repositoryPaths: [{ id: repo.id, path: repo.path }] });
    assert.deepEqual(confirmed.approvedRepositories, [repo]);
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

test("task sessions answer through the original owner without reopening merged work", async () => {
  const f = setup();
  try {
    const original = createApprovedTask(f.runtime, input);
    const merged = { ...original, status: "completed" as const, output: "ผลเดิม", mergedAt: new Date().toISOString() };
    f.store.put("tasks", merged);
    f.runtime.saveAgent({ ...f.store.get("agents", "nova")!, boss: true });
    const message = { projectId: "default", channel: original.channel, taskId: original.id, taskSession: true };
    await assert.rejects(f.runtime.sendMessage({ ...message, channel: "nova", body: "ข้ามห้อง" }), /คนละโปรเจกต์หรือห้อง/);

    const question = await f.runtime.sendMessage({ ...message, body: "ทำไมถึงเลือกแบบนี้" }) as Intake;
    assert.equal(question.agentId, original.agentId);
    assert.equal(f.store.get("messages", question.sourceMessageId!)!.taskId, original.id);
    await until(() => !!f.store.get("intakes", question.id)?.turnId);
    const running = f.store.get("intakes", question.id)!;
    const start = f.calls.find((call) => call.method === "thread/start")!.params;
    assert.equal(start.sandbox, "read-only");
    assert.deepEqual(start.dynamicTools, []);
    f.runtime.codex.onNotification("item/completed", {
      threadId: running.threadId, item: { type: "agentMessage", id: "answer", text: "เหตุผลจากผลเดิม" },
    });
    f.runtime.codex.onNotification("turn/completed", { threadId: running.threadId, turn: { status: "completed" } });
    const reply = f.store.list("messages").at(-1)!;
    assert.equal(reply.body, "เหตุผลจากผลเดิม");
    assert.equal(reply.taskId, original.id);
    assert.equal(reply.from, original.agentId);
    assert.equal(f.store.list("tasks").length, 1);
    assert.deepEqual(f.store.get("tasks", original.id), JSON.parse(JSON.stringify(merged)));
  } finally { await f.close(); }
});

test("task session sends a message to the owner's active Codex turn", async () => {
  const f = setup();
  try {
    const task = createApprovedTask(f.runtime, input);
    await until(() => !!f.store.get("tasks", task.id)?.turnId);
    const active = f.store.get("tasks", task.id)!;
    await f.runtime.sendMessage({ projectId: "default", channel: task.channel, taskId: task.id, taskSession: true, body: "ใช้ภาษาไทย" });
    const steer = f.calls.find((call) => call.method === "turn/steer")?.params;
    assert.equal(steer?.threadId, active.threadId);
    assert.equal(steer?.expectedTurnId, active.turnId);
    assert.equal(f.store.get("messages", steer?.clientUserMessageId)?.taskId, task.id);
    assert.equal(f.store.list("intakes").length, 0);
    f.runtime.codex.onNotification("turn/completed", { threadId: active.threadId, turn: { status: "completed" } });
    const initialReview = f.store.get("tasks", task.id)!;
    assert.equal(initialReview.status, "reviewing");
    await f.runtime.sendMessage({ projectId: "default", channel: task.channel, taskId: task.id, taskSession: true, body: "สรุปอีกครั้งในขอบเขตเดิม" });
    assert.equal(f.store.list("intakes").length, 0);
    await until(() => !!f.store.get("tasks", task.id)?.turnId);
    assert.equal(f.calls.find((call) => call.method === "thread/resume")?.params.threadId, active.threadId);
    assert.match(f.calls.filter((call) => call.method === "turn/start").at(-1)!.params.input[0].text, /สรุปอีกครั้งในขอบเขตเดิม/);
    assert.equal(f.store.get("tasks", task.id)?.threadId, active.threadId);
    f.runtime.codex.onNotification("turn/completed", { threadId: active.threadId, turn: { status: "completed" } });
    const revised = f.store.get("tasks", task.id)!;
    assert.equal(revised.status, "reviewing");
    assert.notEqual(revised.reviewVersion, initialReview.reviewVersion);
    assert.throws(() => f.runtime.reviewTask({ id: task.id, decision: "accept", version: initialReview.reviewVersion }), /ฉบับล่าสุด/);
    assert.equal(f.runtime.reviewTask({ id: task.id, decision: "accept", version: revised.reviewVersion }).status, "completed");
  } finally { await f.close(); }
});

test("separate conversations in one room isolate intake context and survive backup export", async () => {
  const f = setup();
  try {
    const room = { projectId: "default", channel: "atlas" };
    const first = f.runtime.createConversation(room);
    const second = f.runtime.createConversation(room);
    const a = await f.runtime.sendMessage({ ...room, conversationId: first.id, body: "private-first-topic" }) as Intake;
    await f.finishIntake(a.id, { intent: "reply", reply: "first-answer" });
    const b = await f.runtime.sendMessage({ ...room, conversationId: second.id, body: "second-topic" }) as Intake;
    await until(() => !!f.store.get("intakes", b.id)?.turnId);
    const request = f.calls.filter((call) => call.method === "turn/start").at(-1)!;
    assert.doesNotMatch(JSON.stringify(request.params), /private-first-topic|first-answer/);
    await f.finishIntake(b.id, { intent: "reply", reply: "second-answer" });
    await assert.rejects(f.runtime.sendMessage({ ...room, channel: "team", conversationId: first.id, body: "wrong room" }));
    const backup = parseBackup(JSON.parse(await f.runtime.backups.export()));
    assert.deepEqual(backup.data.conversations.map((item) => item.title), ["private-first-topic", "second-topic"]);
    assert.deepEqual(backup.data.messages.filter((message) => message.conversationId === first.id).map((message) => message.body),
      ["private-first-topic", "first-answer"]);
    f.runtime.updateConversation({ id: first.id, title: "Renamed", archived: true });
    await assert.rejects(f.runtime.sendMessage({ ...room, conversationId: first.id, body: "archived write" }));
    assert.equal(f.runtime.snapshot().conversations.find((item) => item.id === first.id)?.title, "Renamed");
    assert.equal(f.runtime.snapshot().messages.filter((message) => message.conversationId === first.id).length, 2);
    f.runtime.updateConversation({ id: first.id, archived: false });
    const reopened = await f.runtime.sendMessage({ ...room, conversationId: first.id, body: "reopened" }) as Intake;
    await f.finishIntake(reopened.id, { intent: "reply", reply: "welcome back" });
  } finally { await f.close(); }
});

test("chat mode answers without a task and assign mode requires a draft for approval", async () => {
  const f = setup();
  try {
    const room = { projectId: "default", channel: "atlas" };
    const conversation = f.runtime.createConversation(room);
    const send = (mode: "chat" | "assign") =>
      f.runtime.sendMessage({ ...room, conversationId: conversation.id, mode, body: "Review the project" }) as Promise<Intake>;
    const chat = await send("chat");
    await f.finishIntake(chat.id, { intent: "reply", reply: "Here is my assessment" });
    assert.equal(f.store.list("tasks").length, 0);
    const invalid = await send("assign");
    const failure = await f.finishIntake(invalid.id, { intent: "reply", reply: "Already done" });
    assert.equal(failure.status, "failed");
    assert.equal(f.store.list("tasks").length, 0);
    const assign = await send("assign");
    await f.finishIntake(assign.id, proposal);
    const [draft] = f.store.list("tasks");
    assert.equal(draft.status, "draft");
    assert.equal(draft.approvedRevision, undefined);
  } finally { await f.close(); }
});

test("recording completed conversation work keeps its source and does not queue Codex", async () => {
  const f = setup();
  try {
    const room = { projectId: "default", channel: "atlas" };
    const conversation = f.runtime.createConversation(room);
    const record = () => f.runtime.recordCompletedConversationTask({ id: conversation.id, title: "Reviewed notes", output: "Recorded by the user." });
    assert.throws(record, /ข้อความต้นทาง/);
    const turn = await f.runtime.sendMessage({ ...room, conversationId: conversation.id, body: "Review these notes" }) as Intake;
    await f.finishIntake(turn.id, { intent: "reply", reply: "Review complete" });
    const callCount = f.calls.length;
    const task = record();
    await settle();
    assert.equal(f.calls.length, callCount);
    assert.equal(task.status, "completed");
    assert.equal(task.sourceMessageId, turn.sourceMessageId);
    assert.equal(task.worktrees, undefined);
    const backup = parseBackup(JSON.parse(await f.runtime.backups.export()));
    assert.equal(backup.data.tasks.find((item) => item.id === task.id)?.sourceMessageId, turn.sourceMessageId);
    f.runtime.updateConversation({ id: conversation.id, archived: true });
    assert.throws(record, /คลัง/);
  } finally { await f.close(); }
});

test("saved conversations resume only their compatible Codex session and exclude session IDs from backup", async () => {
  const f = setup();
  try {
    const room = { projectId: "default", channel: "atlas" };
    const first = f.runtime.createConversation(room);
    const second = f.runtime.createConversation(room);
    const send = async (conversationId: string, mode: "chat" | "auto" = "chat") => {
      const turn = await f.runtime.sendMessage({ ...room, conversationId, mode, body: "Explain this" }) as Intake;
      return f.finishIntake(turn.id, { intent: "reply", reply: "Answer" });
    };
    const initial = await send(first.id);
    await send(second.id);
    assert.equal(f.calls.filter((call) => call.method === "thread/resume").length, 0);
    await send(first.id);
    const [resume] = f.calls.filter((call) => call.method === "thread/resume");
    assert.equal(resume.params.threadId, initial.threadId);
    await send(first.id, "auto");
    assert.equal(f.calls.filter((call) => call.method === "thread/resume").length, 1);
    assert.equal(f.runtime.snapshot().conversations[0].session, undefined);
    assert.equal(parseBackup(JSON.parse(await f.runtime.backups.export())).data.conversations[0].session, undefined);
    const archive = f.runtime.archiveHistory(room.projectId, "chats");
    f.runtime.archiveHistory(room.projectId, "chats", archive.token);
    assert.equal(f.store.get("conversations", first.id)?.session, undefined);
  } finally { await f.close(); }
});

test("handoff copies message text and keeps a validated source reference in backup", async () => {
  const f = setup();
  try {
    const room = { projectId: "default", channel: "atlas" };
    const source = f.runtime.createConversation(room);
    const target = f.runtime.createConversation(room);
    const input = { ...room, conversationId: target.id, body: "Selected excerpt", handoff: { kind: "conversation", id: source.id } };
    const other = { ...source, id: randomUUID(), projectId: "another-project" };
    f.store.put("conversations", other);
    await assert.rejects(f.runtime.sendMessage({ ...input, handoff: { ...input.handoff, id: other.id } }), /โปรเจกต์เดียว/);
    f.store.remove("conversations", other.id);
    const turn = await f.runtime.sendMessage(input) as Intake;
    await f.finishIntake(turn.id, { intent: "reply", reply: "Received" });
    const message = parseBackup(JSON.parse(await f.runtime.backups.export())).data.messages.find((item) => item.id === turn.sourceMessageId);
    assert.deepEqual(message?.handoff, input.handoff);
    assert.equal(message?.body, input.body);
  } finally { await f.close(); }
});

test("handoff preserves PDF bytes after the source changes without exposing bytes in snapshots", async () => {
  const f = setup();
  try {
    const room = { projectId: "default", channel: "atlas" };
    const target = f.runtime.createConversation(room);
    const turn = await f.runtime.sendMessage({ ...room, conversationId: target.id, body: "Prepare notes" }) as Intake;
    await f.finishIntake(turn.id, { intent: "reply", reply: "Done" });
    const task = f.runtime.recordCompletedConversationTask({ id: target.id, title: "Report", output: "[Report](report.pdf)" });
    f.store.put("tasks", { ...task, workspace: f.dir });
    const report = join(f.dir, "report.pdf");
    writeFileSync(report, "%PDF-original");
    const input = { ...room, conversationId: target.id, body: "Report attached", handoff: { kind: "task", id: task.id } };
    await assert.rejects(f.runtime.sendMessage({ ...input, handoffFiles: [{ path: "unlisted.pdf" }] }));
    const sent = await f.runtime.sendMessage({ ...input, handoffFiles: [{ path: "report.pdf" }] }) as Intake;
    await until(() => !!f.store.get("intakes", sent.id)?.turnId);
    const path = join(f.dir, "turn-attachments", sent.id, "0.pdf");
    assert.equal(readFileSync(path, "utf8"), "%PDF-original");
    assert.ok(JSON.stringify(f.calls.filter((call) => call.method === "turn/start").at(-1)?.params).includes(path));
    await f.finishIntake(sent.id, { intent: "reply", reply: "Received" });
    assert.equal(existsSync(path), false);
    writeFileSync(report, "%PDF-changed");
    const message = f.runtime.snapshot().messages.find((item) => item.id === sent.sourceMessageId);
    assert.deepEqual(message?.handoffFiles, [{ name: "report.pdf" }]);
    const backup = parseBackup(JSON.parse(await f.runtime.backups.export()));
    const file = backup.data.messages.find((item) => item.id === sent.sourceMessageId)?.handoffFiles?.[0];
    assert.equal(Buffer.from(file!.base64!, "base64").toString(), "%PDF-original");
  } finally { await f.close(); }
});

test("explicit chat edits reuse an isolated worktree without creating a task", async () => {
  const f = setup();
  try {
    const path = join(f.dir, "source-repo");
    mkdirSync(path);
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@localhost", ...args], { cwd: path, stdio: "ignore" });
    git("init", "-b", "main");
    writeFileSync(join(path, "notes.txt"), "original");
    git("add", ".");
    git("commit", "-m", "initial");
    const project = f.store.get("projects", "default")!;
    f.store.put("projects", { ...project, path, repositories: [{ id: "main", name: "Main", path }] });
    f.runtime.saveAgent({ ...f.store.get("agents", "atlas")!, permission: "workspace-write" });
    const room = { projectId: project.id, channel: "atlas" };
    const conversation = f.runtime.createConversation(room);
    const input = { ...room, conversationId: conversation.id, mode: "chat", body: "Edit notes", editRepository: { id: "main", path } };
    await assert.rejects(f.runtime.sendMessage({ ...input, editRepository: { id: "main", path: f.dir } }), /repo/);
    for (let round = 0; round < 2; round++) {
      const turn = await f.runtime.sendMessage(input) as Intake;
      for (let attempt = 0; attempt < 100; attempt++) {
        const current = f.store.get("intakes", turn.id)!;
        if (current.turnId || current.status === "failed") break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const started = f.store.get("intakes", turn.id)!;
      assert.ok(started.turnId, started.error);
      const active = f.runtime.active.get(turn.id)!.task;
      const request = f.calls.filter((call) => call.method === "turn/start").at(-1)!;
      const tree = f.store.get("conversations", conversation.id)?.worktrees?.[0];
      assert.ok(tree);
      assert.notEqual(tree.workspace, path);
      assert.deepEqual(request.params.sandboxPolicy.writableRoots, [tree.workspace]);
      assert.equal(active.workspace, tree.workspace);
      f.runtime.codex.onNotification("item/agentMessage/delta", { threadId: active.threadId, itemId: "reply", delta: "Done" });
      await f.finishIntake(turn.id, undefined);
      assert.equal(f.store.get("intakes", turn.id)?.status, "completed");
    }
    assert.equal(f.calls.filter((call) => call.method === "thread/resume").length, 1);
    assert.equal(f.store.list("tasks").length, 0);
    assert.equal(parseBackup(JSON.parse(await f.runtime.backups.export())).data.conversations[0].worktree, undefined);
    const tree = f.store.get("conversations", conversation.id)!.worktrees![0];
    const edited = join(tree.workspace, "notes.txt");
    writeFileSync(edited, "first change");
    const recorded = f.runtime.recordCompletedConversationTask({ id: conversation.id, title: "Notes edit", output: "Recorded change" });
    assert.equal(recorded.conversationCode?.mergedAt, undefined);
    const secondPath = join(f.dir, "second-repo");
    mkdirSync(secondPath);
    const secondGit = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@localhost", ...args], { cwd: secondPath });
    secondGit("init", "-b", "main");
    secondGit("commit", "--allow-empty", "-m", "initial");
    const updatedProject = f.store.get("projects", project.id)!;
    f.store.put("projects", { ...updatedProject, repositories: [...updatedProject.repositories!, { id: "second", name: "Second", path: secondPath }] });
    const secondTurn = await f.runtime.sendMessage({ ...input, editRepository: { id: "second", path: secondPath } }) as Intake;
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = f.store.get("intakes", secondTurn.id)!;
      if (current.turnId || current.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(f.store.get("intakes", secondTurn.id)?.turnId, f.store.get("intakes", secondTurn.id)?.error);
    const secondActive = f.runtime.active.get(secondTurn.id)!.task;
    f.runtime.codex.onNotification("item/agentMessage/delta", { threadId: secondActive.threadId, itemId: "reply", delta: "Done" });
    await f.finishIntake(secondTurn.id, undefined);
    assert.equal(f.store.get("conversations", conversation.id)?.worktrees?.length, 2);
    await assert.rejects(f.runtime.conversationDiff(conversation.id), /worktree/);
    const secondDiff = await f.runtime.conversationDiff(conversation.id, "second");
    await f.runtime.abandonConversationRound(conversation.id, secondDiff.version, "second");
    const assign = await f.runtime.sendMessage({ ...room, conversationId: conversation.id, mode: "assign", body: "Finish notes" }) as Intake;
    await f.finishIntake(assign.id, { ...proposal, kind: "code", plan: { ...plan, repositories: ["main", "second"] } });
    const draft = f.store.list("tasks").find((task) => task.status === "draft")!;
    f.runtime.confirmPlan({ id: draft.id, revision: draft.planRevision, repositories: ["main", "second"], repositoryPaths: [{ id: "main", path }, { id: "second", path: secondPath }] });
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = f.store.get("tasks", draft.id)!;
      if (current.turnId || current.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const assigned = f.store.get("tasks", draft.id)!;
    assert.ok(assigned.turnId, assigned.error);
    assert.equal(assigned.workspace, tree.workspace);
    assert.equal(assigned.worktrees?.length, 2);
    const start = f.calls.filter((call) => call.method === "turn/start").at(-1)!;
    assert.deepEqual(start.params.sandboxPolicy.writableRoots, assigned.worktrees!.map((item) => item.workspace));
    await assert.rejects(f.runtime.conversationDiff(conversation.id, "main"), /รอให้งาน/);
    writeFileSync(join(assigned.workspace!, "report.txt"), "original delivery");
    f.runtime.codex.onNotification("item/agentMessage/delta", { threadId: assigned.threadId, itemId: "result", delta: "[Report](report.txt)" });
    f.runtime.codex.onNotification("turn/completed", { threadId: assigned.threadId, turn: { status: "completed" } });
    for (let attempt = 0; attempt < 100 && f.store.get("tasks", draft.id)?.status === "running"; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(f.store.get("tasks", draft.id)?.status, "reviewing", f.store.get("tasks", draft.id)?.error);
    writeFileSync(join(assigned.workspace!, "report.txt"), "later changes");
    const delivered = f.store.get("tasks", draft.id)!;
    assert.equal((await readDeliveryFile(f.dir, delivered, 1, "report.txt")).bytes.toString(), "original delivery");
    const unaccepted = await f.runtime.conversationDiff(conversation.id, "main");
    await assert.rejects(f.runtime.mergeConversation(conversation.id, unaccepted.version, "main"), /ตรวจรับงาน/);
    const review = f.store.get("tasks", draft.id)!;
    f.runtime.reviewTask({ id: review.id, decision: "accept", version: review.reviewVersion });
    const reviewed = await f.runtime.conversationDiff(conversation.id, "main");
    assert.match(reviewed.patch, /first change/);
    writeFileSync(edited, "second change");
    await assert.rejects(f.runtime.mergeConversation(conversation.id, reviewed.version, "main"), /diff ล่าสุด/);
    const latest = await f.runtime.conversationDiff(conversation.id, "main");
    await f.runtime.mergeConversation(conversation.id, latest.version, "main");
    assert.equal(execFileSync("git", ["show", "HEAD:notes.txt"], { cwd: path, encoding: "utf8" }), "second change");
    assert.ok(f.store.get("conversations", conversation.id)?.worktrees?.[0]?.mergedAt);
    assert.equal(f.store.get("tasks", draft.id)?.mergedAt, undefined);
    const secondTree = assigned.worktrees!.find((item) => item.id === "second")!;
    writeFileSync(join(secondTree.workspace, "second.txt"), "second repo change");
    const reviewSecond = await f.runtime.conversationDiff(conversation.id, "second");
    await f.runtime.mergeConversation(conversation.id, reviewSecond.version, "second");
    assert.ok(f.store.get("tasks", draft.id)?.mergedAt);
    const saved = f.store.get("tasks", recorded.id)!;
    assert.equal(saved.status, "completed");
    assert.ok(saved.conversationCode?.mergedAt);
    assert.equal(saved.conversationCode?.branch, tree.branch);
    await assert.rejects(f.runtime.mergeConversation(conversation.id, latest.version, "main"), /รวมแล้ว/);
    const next = await f.runtime.sendMessage(input) as Intake;
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = f.store.get("intakes", next.id)!;
      if (current.turnId || current.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(f.store.get("intakes", next.id)?.turnId, f.store.get("intakes", next.id)?.error);
    const restarted = f.store.get("conversations", conversation.id)!.worktrees!.find((item) => item.id === "main")!;
    assert.equal(f.calls.filter((call) => call.method === "thread/resume").length, 1);
    assert.equal(restarted.workspace, tree.workspace);
    assert.notEqual(restarted.branch, tree.branch);
    assert.equal(restarted.mergedAt, undefined);
    assert.equal(restarted.baseCommit, execFileSync("git", ["rev-parse", "HEAD"], { cwd: path, encoding: "utf8" }).trim());
    git("show-ref", "--verify", "refs/heads/" + tree.branch);
    const active = f.runtime.active.get(next.id)!.task;
    f.runtime.codex.onNotification("item/agentMessage/delta", { threadId: active.threadId, itemId: "reply", delta: "Done" });
    await f.finishIntake(next.id, undefined);
    const keptFile = join(restarted.workspace, "notes.txt");
    writeFileSync(keptFile, "keep this experiment");
    const abandonedDiff = await f.runtime.conversationDiff(conversation.id, "main");
    await assert.rejects(f.runtime.abandonConversationRound(conversation.id, latest.version, "main"), /diff ล่าสุด/);
    await f.runtime.abandonConversationRound(conversation.id, abandonedDiff.version, "main");
    const abandoned = f.store.get("conversations", conversation.id)!;
    assert.deepEqual(abandoned.worktrees?.map((item) => item.id), ["second"]);
    assert.equal(abandoned.abandonedWorktrees?.at(-1)?.workspace, restarted.workspace);
    assert.match(execFileSync("git", ["diff", "HEAD"], { cwd: restarted.workspace, encoding: "utf8" }), /keep this experiment/);
    git("show-ref", "--verify", "refs/heads/" + restarted.branch);
    assert.equal(parseBackup(JSON.parse(await f.runtime.backups.export())).data.conversations[0].abandonedWorktrees, undefined);
  } finally { await f.close(); }
});

test("handoff summary drafts use selected text only and do not post a message", async () => {
  const f = setup();
  try {
    const room = { projectId: "default", channel: "atlas" };
    const conversation = f.runtime.createConversation(room);
    const previous = await f.runtime.sendMessage({ ...room, body: "unrelated-private-context" }) as Intake;
    await f.finishIntake(previous.id, { intent: "reply", reply: "Old reply" });
    const count = f.store.list("messages").length;
    const draft = f.runtime.draftHandoff({ id: conversation.id, text: "Selected reference" });
    await until(() => !!f.store.get("intakes", draft.id)?.turnId);
    const start = f.calls.filter((call) => call.method === "turn/start").at(-1)!;
    assert.match(JSON.stringify(start.params.input), /Selected reference/);
    assert.doesNotMatch(JSON.stringify(start.params.input), /unrelated-private-context/);
    const turn = f.runtime.active.get(draft.id)!.task;
    f.runtime.codex.onNotification("item/agentMessage/delta", { threadId: turn.threadId, itemId: "draft", delta: "Editable summary" });
    const result = await f.finishIntake(draft.id, undefined);
    assert.equal(result.output, "Editable summary");
    assert.equal(f.store.list("messages").length, count);
    assert.equal(f.store.list("tasks").length, 0);
  } finally { await f.close(); }
});
