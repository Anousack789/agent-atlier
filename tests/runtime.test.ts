import { createApprovedTask } from "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { OfficeRuntime } from "../server/runtime";
import type { Task } from "../shared/types";
import { parseBackup } from "../server/backup";
import { createWorktree } from "../server/git";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "office-test-"));
  const store = new Store(dir);
  const runtime = new OfficeRuntime(store, "http://127.0.0.1:3210");
  return {
    store,
    runtime,
    dir,
    async close() {
      await runtime.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const taskInput = {
  title: "ทดสอบงาน",
  prompt: "สรุปข้อมูลในโปรเจกต์นี้",
  agentId: "atlas",
  projectId: "default",
  kind: "general",
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("failed workflow code can be recovered per repository using its current diff", async () => {
  const f = setup();
  const git = (cwd: string, ...args: string[]) => execFileSync("git",
    ["-c", "user.name=Test", "-c", "user.email=test@localhost", ...args],
    { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  try {
    const parent = createApprovedTask(f.runtime, taskInput);
    f.store.put("tasks", { ...parent, status: "waiting" });
    const task = {
      ...parent, id: "failed-code-task", rootId: "failed-code-task", parentTaskId: parent.id,
      kind: "code", status: "failed",
      stage: { key: "implementation", kind: "work", reviewRequired: false, criteria: [], repositories: ["frontend", "backend"] },
    } satisfies Task;
    const worktrees = await Promise.all(["frontend", "backend"].map(async (id) => {
      const path = join(f.dir, id);
      mkdirSync(path);
      git(path, "init", "-b", "main");
      writeFileSync(join(path, "code.txt"), "base\n");
      git(path, "add", ".");
      git(path, "commit", "-m", "base");
      const tree = { id, name: id, path, ...await createWorktree({ path }, task, f.dir, id) };
      writeFileSync(join(tree.workspace, "code.txt"), "agent commit\n");
      git(tree.workspace, "commit", "-am", "agent commit");
      writeFileSync(join(tree.workspace, "pending.txt"), "pending\n");
      return tree;
    }));
    const [front, back] = worktrees;
    f.store.put("tasks", { ...task, worktrees });
    f.store.put("tasks", { ...task, id: "waiting-review", rootId: "waiting-review",
      kind: "general", status: "queued", dependsOn: [task.id] });
    const review = await f.runtime.recoveryDiff(task.id, front.id);
    assert.match(review.diff, /agent commit/);
    assert.match(review.diff, /pending/);
    await assert.rejects(f.runtime.merge(task.id, front.id, review.version), /ตรวจรับ/);
    await assert.rejects(f.runtime.merge(task.id, back.id, review.version, true), /เปิด diff ล่าสุด/);
    await assert.rejects(f.runtime.merge(task.id, front.id, undefined, true), /เปิด diff ล่าสุด/);
    writeFileSync(join(front.workspace, "pending.txt"), "updated\n");
    await assert.rejects(f.runtime.merge(task.id, front.id, review.version, true), /เปิด diff ล่าสุด/);
    const current = await f.runtime.recoveryDiff(task.id, front.id);
    const recover = () => f.runtime.merge(task.id, front.id, current.version, true);
    writeFileSync(join(front.path, "dirty.txt"), "local work\n");
    await assert.rejects(recover(), /ยังไม่ commit/);
    rmSync(join(front.path, "dirty.txt"));
    f.runtime.active.set(task.id, { task, outputs: new Map(), lastProgress: Date.now() });
    await assert.rejects(recover(), /ยังปรึกษา/);
    f.runtime.active.delete(task.id);
    await recover();
    assert.equal(readFileSync(join(front.path, "code.txt"), "utf8"), "agent commit\n");
    assert.equal(readFileSync(join(front.path, "pending.txt"), "utf8"), "updated\n");
    const recovered = f.store.get("tasks", task.id)!;
    assert.equal(recovered.status, "failed");
    assert.ok(recovered.worktrees?.[0].mergedAt);
    assert.equal(recovered.worktrees?.[1].mergedAt, undefined);
    await assert.rejects(recover(), /รวมแล้ว/);

    const workflow = { repositories: [], taskIds: [task.id], revision: 1 };
    f.store.put("tasks", { ...recovered, status: "completed" });
    f.store.put("tasks", { ...parent, status: "waiting",
      workflow: { ...workflow, phase: "active" } });
    await assert.rejects(f.runtime.recoveryDiff(task.id, back.id), /ถูกขัดจังหวะ/);
    f.store.put("tasks", { ...parent, status: "interrupted",
      workflow: { ...workflow, phase: "interrupted" } });
    writeFileSync(join(back.path, "code.txt"), "human commit\n");
    git(back.path, "commit", "-am", "human commit");
    const backReview = await f.runtime.recoveryDiff(task.id, back.id);
    await assert.rejects(f.runtime.merge(task.id, back.id, backReview.version, true), /รวมงานไม่สำเร็จ/);
    assert.equal(git(back.path, "status", "--porcelain"), "");
    assert.equal(readFileSync(join(back.path, "code.txt"), "utf8"), "human commit\n");
    assert.equal(readFileSync(join(back.workspace, "pending.txt"), "utf8"), "pending\n");
    assert.equal(f.store.get("tasks", task.id)?.worktrees?.[1].mergedAt, undefined);
    git(back.path, "revert", "--no-edit", "HEAD");
    const refreshed = await f.runtime.recoveryDiff(task.id, back.id);
    await f.runtime.merge(task.id, back.id, refreshed.version, true);
    assert.equal(readFileSync(join(back.path, "code.txt"), "utf8"), "agent commit\n");
    assert.equal(f.store.get("tasks", task.id)?.status, "completed");
    assert.equal(f.store.get("tasks", parent.id)?.workflow?.phase, "interrupted");
  } finally { await f.close(); }
});

test("routine activity is stored separately while uncertain messages remain visible", async () => {
  const f = setup();
  try {
    const task = { ...createApprovedTask(f.runtime, taskInput), threadId: "activity-thread", status: "running" as const };
    f.runtime.active.set(task.id, { task, outputs: new Map(), lastProgress: Date.now() });
    const notify = f.runtime.codex.onNotification;
    notify("item/started", { threadId: task.threadId, item: { id: "command", type: "commandExecution", command: "private command contents" } });
    notify("item/completed", { threadId: task.threadId, item: { id: "command", type: "commandExecution", status: "failed", exitCode: 1 } });
    notify("item/completed", { threadId: task.threadId, item: { id: "progress", type: "agentMessage", phase: "commentary", text: "[activity] กำลังตรวจ TypeScript" } });
    notify("item/completed", { threadId: task.threadId, item: { id: "question", type: "agentMessage", phase: "commentary", text: "กรุณายืนยันก่อนดำเนินการ" } });
    assert.equal(task.output, "กรุณายืนยันก่อนดำเนินการ");
    assert.deepEqual(task.activityHistory?.map((entry) => entry.text), ["เริ่มรันคำสั่ง", "คำสั่ง · ไม่สำเร็จ", "กำลังตรวจ TypeScript"]);
    assert.deepEqual(f.store.get("tasks", task.id)?.activityHistory, task.activityHistory);
    f.runtime.active.delete(task.id);
    f.store.put("tasks", { ...task, status: "completed" });
    const backup = await f.runtime.backups.export();
    assert.doesNotThrow(() => parseBackup(JSON.parse(backup)));
  } finally { await f.close(); }
});

test("deleting stopped tasks preserves history and rejects active references and approvals", async () => {
  const f = setup();
  try {
    const task = createApprovedTask(f.runtime, taskInput);
    assert.throws(() => f.runtime.deleteTask(task.id), /ลบได้เฉพาะ/);
    f.store.put("tasks", { ...task, status: "failed" });
    const child = { ...task, id: "child", rootId: task.id, parentTaskId: task.id };
    f.store.put("tasks", child);
    assert.throws(() => f.runtime.deleteTask(task.id), /อ้างอิง/);
    f.store.remove("tasks", child.id);
    const approval = { id: "approval", type: "external" as const, status: "unknown" as const, title: "ส่งข้อมูล", details: "", projectId: task.projectId, agentId: task.agentId, taskId: task.id, payload: {}, createdAt: new Date().toISOString() };
    f.store.put("approvals", approval);
    assert.throws(() => f.runtime.deleteTask(task.id), /ยังไม่ทราบผล/);
    f.store.put("approvals", { ...approval, status: "approved" });
    f.store.put("messages", { id: "message", projectId: task.projectId, channel: "team", from: "user", body: "hello", taskId: task.id, createdAt: new Date().toISOString() });
    f.runtime.deleteTask(task.id);
    assert.equal(f.store.get("tasks", task.id), undefined);
    assert.equal(f.store.get("messages", "message")?.taskDeleted, true);
    assert.equal(f.store.get("approvals", "approval")?.taskDeleted, true);
    const backup = JSON.parse(await f.runtime.backups.export());
    assert.doesNotThrow(() => parseBackup(backup));
  } finally { await f.close(); }
});

test("avatar parts survive save and reopen, preserve legacy agents, and can be removed", async () => {
  const f = setup();
  let reopened: Store | undefined;
  try {
    const original = f.store.get("agents", "atlas")!;
    const nova = f.store.get("agents", "nova")!;
    const avatarParts = { hairStyle: "curly" as const, skinTone: "deep" as const, glasses: true };
    const saved = f.runtime.saveAgent({ ...original, avatarParts });
    assert.deepEqual(saved.avatarParts, avatarParts);
    assert.deepEqual(f.store.get("agents", "nova"), nova);
    assert.equal(nova.avatarParts, undefined);
    reopened = new Store(f.dir);
    assert.deepEqual(reopened.get("agents", "atlas")?.avatarParts, avatarParts);
    reopened.close();
    reopened = undefined;
    const task = createApprovedTask(f.runtime, taskInput);
    f.runtime.active.set(task.id, { task, outputs: new Map(), lastProgress: Date.now() });
    assert.throws(() => f.runtime.saveAgent({ ...saved, avatarParts: undefined }), /หยุดงาน/);
    assert.deepEqual(f.store.get("agents", "atlas")?.avatarParts, avatarParts);
    f.runtime.active.delete(task.id);
    f.runtime.saveAgent({ ...saved, avatarParts: undefined });
    assert.deepEqual(f.store.get("agents", "atlas"), original);
    assert.equal(Object.hasOwn(f.store.get("agents", "atlas")!, "avatarParts"), false);
  } finally {
    reopened?.close();
    await f.close();
  }
});

test("SQLite transactions roll back and data survives reopening", () => {
  const dir = mkdtempSync(join(tmpdir(), "office-store-"));
  let store = new Store(dir);
  store.put("projects", { id: "a", name: "A", path: dir });
  assert.throws(() =>
    store.transaction(() => {
      store.remove("projects", "a");
      throw new Error("rollback");
    }),
  );
  assert.equal(store.get("projects", "a")?.name, "A");
  store.close();
  store = new Store(dir);
  assert.equal(store.get("projects", "a")?.path, dir);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("delegation waits for approval and repeated approval cannot create duplicate tasks", async () => {
  const f = setup();
  try {
    const task = createApprovedTask(f.runtime, taskInput);
    f.runtime.active.set(task.id, {
      task,
      outputs: new Map(),
      lastProgress: Date.now(),
    });
    const replies: unknown[] = [];
    f.runtime.codex.reply = (_id, result) => replies.push(result);
    await f.runtime.tool(
      task,
      "office_request_task",
      {
        agentId: "nova",
        title: "ช่วยตรวจสอบ",
        prompt: "วิเคราะห์อย่างเดียว",
        plan: { goal: "ตรวจสอบ", steps: ["อ่านข้อมูล", "สรุปข้อค้นพบ"], deliverable: "ข้อค้นพบ", assignments: [] },
        kind: "general",
      },
      10,
    );
    assert.equal(f.store.list("tasks").length, 1);
    assert.equal(replies.length, 0);
    const approval = f.store.list("approvals")[0];
    await f.runtime.decide({ id: approval.id, approve: true });
    assert.equal(f.store.list("tasks").length, 2);
    assert.equal(replies.length, 1);
    assert.equal(f.store.list("tasks")[1].agentId, "nova");
    await assert.rejects(
      f.runtime.decide({ id: approval.id, approve: true }),
      /จัดการแล้ว/,
    );
    assert.equal(f.store.list("tasks").length, 2);
  } finally {
    await f.close();
  }
});

test("external write is never called before approval and is claimed before awaiting network", async () => {
  const f = setup();
  try {
    f.store.put("agents", {
      ...f.store.get("agents", "atlas")!,
      googleAccess: true,
    });
    f.runtime.google.status = () => ({
      connected: true,
      configured: true,
      clientId: "test",
      email: "test@example.com",
    });
    let calls = 0;
    let complete!: () => void;
    const delay = new Promise<void>((resolve) => {
      complete = resolve;
    });
    f.runtime.google.execute = async () => {
      calls++;
      await delay;
      return { id: "sent", message: "sent" };
    };
    const task = createApprovedTask(f.runtime, taskInput);
    f.runtime.active.set(task.id, {
      task,
      outputs: new Map(),
      lastProgress: Date.now(),
    });
    await f.runtime.tool(
      task,
      "gmail_send",
      { to: ["test@example.com"], subject: "ทดสอบ", body: "hello" },
      11,
    );
    assert.equal(calls, 0);
    const approval = f.store.list("approvals")[0];
    const first = f.runtime.decide({ id: approval.id, approve: true });
    assert.equal(calls, 1);
    assert.equal(f.store.get("approvals", approval.id)?.status, "executing");
    await assert.rejects(
      f.runtime.decide({ id: approval.id, approve: true }),
      /จัดการแล้ว/,
    );
    complete();
    await first;
    assert.equal(f.store.get("approvals", approval.id)?.status, "approved");
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});

test("declining an external action does not call the provider", async () => {
  const f = setup();
  try {
    const task = createApprovedTask(f.runtime, taskInput);
    f.runtime.active.set(task.id, {
      task,
      outputs: new Map(),
      lastProgress: Date.now(),
    });
    f.store.put("approvals", {
      id: "decline",
      type: "external",
      status: "pending",
      title: "send",
      details: "",
      projectId: "default",
      agentId: "atlas",
      taskId: task.id,
      rpcId: 1,
      payload: { action: "gmail_send" },
      createdAt: new Date().toISOString(),
    });
    let calls = 0;
    f.runtime.google.execute = async () => {
      calls++;
      throw new Error("must not happen");
    };
    await f.runtime.decide({ id: "decline", approve: false });
    assert.equal(calls, 0);
  } finally {
    await f.close();
  }
});

test("conversation pauses after six rounds and only approval continues it", async () => {
  const f = setup();
  try {
    const task = createApprovedTask(f.runtime, taskInput, { round: 6 });
    const result = (await f.runtime.tool(
      task,
      "office_message",
      { agentId: "nova", body: "ช่วยตอบเพิ่ม" },
      2,
    )) as { paused: boolean };
    assert.equal(result.paused, true);
    assert.equal(f.store.list("tasks").length, 1);
    await f.runtime.decide({
      id: f.store.list("approvals")[0].id,
      approve: true,
    });
    assert.equal(f.store.list("tasks").length, 2);
    assert.equal(f.store.list("tasks")[1].round, 0);
  } finally {
    await f.close();
  }
});

test("parallel consultation fan-out shares the same six-message budget", async () => {
  const f = setup();
  try {
    const task = createApprovedTask(f.runtime, taskInput);
    for (let i = 0; i < 6; i++)
      await f.runtime.tool(
        task,
        "office_message",
        { agentId: "nova", body: `question ${i}` },
        i,
      );
    assert.equal(f.store.list("tasks").length, 7);
    const result = (await f.runtime.tool(
      task,
      "office_message",
      { agentId: "nova", body: "last" },
      9,
    )) as { paused: boolean };
    assert.equal(result.paused, true);
    assert.equal(f.store.list("tasks").length, 7);
    await f.runtime.tool(
      task,
      "office_message",
      { agentId: "nova", body: "last" },
      10,
    );
    assert.equal(f.store.list("approvals").length, 1);
  } finally {
    await f.close();
  }
});

test("agent settings reach the model and instructions of its own task", async () => {
  const f = setup();
  try {
    f.runtime.models = [{ model: "test-model", displayName: "Test" }];
    const agent = f.runtime.saveAgent({
      ...f.store.get("agents", "atlas")!,
      id: undefined,
      name: "Custom",
      model: "test-model",
      instructions: "CUSTOM_INSTRUCTIONS",
      avatar: 2,
      hairColor: "#123456",
      shirtColor: "#654321",
      seat: { x: 3, y: 15 },
    });
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    f.runtime.codex.request = async (
      method: string,
      params: Record<string, unknown>,
    ): Promise<any> => {
      calls.push({ method, params });
      return method === "thread/start"
        ? { thread: { id: "custom" } }
        : { turn: { id: "t", status: "inProgress" } };
    };
    f.runtime.connection = { state: "ready" };
    createApprovedTask(f.runtime, { ...taskInput, agentId: agent.id });
    await settle();
    await settle();
    assert.equal(calls[0].params.model, "test-model");
    assert.match(
      String(calls[0].params.developerInstructions),
      /CUSTOM_INSTRUCTIONS/,
    );
    assert.equal(calls[0].params.approvalPolicy, "on-request");
    assert.equal(calls[0].params.approvalsReviewer, "auto_review");
    assert.equal(calls[0].params.sandbox, "read-only");
    assert.equal(agent.avatar, 2);
  } finally {
    await f.close();
  }
});

test("reasoning effort is validated, saved per task, and sent only when supported", async () => {
  const f = setup();
  try {
    const model = { model: "test-model", displayName: "Test", isDefault: true, supportedReasoningEfforts: ["low", "high"].map((reasoningEffort) => ({ reasoningEffort, description: "" })) };
    f.runtime.models = [model];
    const original = f.store.get("agents", "atlas")!;
    assert.throws(() => f.runtime.saveAgent({ ...original, reasoningEffort: "medium" }), /ไม่รองรับ/);
    f.runtime.saveAgent({ ...original, reasoningEffort: "high" });
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    let supported = true;
    f.runtime.codex.request = async (method: string, params: Record<string, unknown>): Promise<any> => {
      calls.push({ method, params });
      if (method === "model/list") return { data: [{ ...model, supportedReasoningEfforts: supported ? model.supportedReasoningEfforts : [] }], nextCursor: null };
      return method === "thread/start" ? { thread: { id: "thread" } } : { turn: { id: "turn", status: "inProgress" } };
    };
    f.runtime.connection = { state: "ready" };
    const task = createApprovedTask(f.runtime, taskInput);
    for (let i = 0; i < 10 && !calls.some((call) => call.method === "turn/start"); i++) await settle();
    assert.equal(calls.find((call) => call.method === "turn/start")?.params.effort, "high");
    assert.equal(f.store.get("tasks", task.id)?.reasoningEffort, "high");
    f.runtime.saveAgent({ ...f.store.get("agents", "atlas")!, reasoningEffort: "low" });
    assert.equal(f.store.get("tasks", task.id)?.reasoningEffort, "high");
    f.runtime.active.delete(task.id);
    f.store.put("tasks", { ...f.store.get("tasks", task.id)!, status: "completed" });
    const backup = JSON.parse(await f.runtime.backups.export());
    assert.doesNotThrow(() => parseBackup(backup));
    supported = false;
    const next = createApprovedTask(f.runtime, taskInput);
    for (let i = 0; i < 10 && f.store.get("tasks", next.id)?.status !== "failed"; i++) await settle();
    assert.match(f.store.get("tasks", next.id)?.error || "", /ไม่รองรับ/);
    assert.equal(calls.filter((call) => call.method === "turn/start").length, 1);
  } finally { await f.close(); }
});

test("auto-review rejection remains visible and cannot be approved or replayed", async () => {
  const f = setup();
  try {
    const task = createApprovedTask(f.runtime, taskInput);
    task.threadId = "review-thread";
    f.runtime.active.set(task.id, { task, outputs: new Map(), lastProgress: Date.now() });
    const replies: unknown[] = [];
    f.runtime.codex.reply = (_id, result) => replies.push(result);
    const review = {
      threadId: task.threadId,
      reviewId: "review-1",
      action: { type: "command", command: "example command" },
      review: { status: "denied", rationale: "The action exceeds the authorized scope" },
    };
    f.runtime.codex.onNotification("item/autoApprovalReview/completed", review);
    f.runtime.codex.onNotification("item/autoApprovalReview/completed", review);
    const approvals = f.store.list("approvals");
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].status, "declined");
    assert.match(approvals[0].details, /example command/);
    assert.match(approvals[0].result!, /exceeds the authorized scope/);
    assert.equal(f.store.list("messages").filter((m) => m.body.includes("exceeds the authorized scope")).length, 1);
    await assert.rejects(f.runtime.decide({ id: approvals[0].id, approve: true }), /จัดการแล้ว/);
    assert.deepEqual(replies, []);
    f.runtime.codex.onNotification("item/autoApprovalReview/completed", {
      ...review, reviewId: "review-2", review: { status: "approved" },
    });
    assert.equal(f.store.list("approvals").length, 1);
    for (const status of ["timedOut", "aborted"]) {
      f.runtime.codex.onNotification("item/autoApprovalReview/completed", {
        ...review, reviewId: status, review: { status },
      });
    }
    assert.equal(f.store.list("approvals").length, 3);
    assert.ok(f.store.list("approvals").every((a) => a.status === "declined" && a.result));
    assert.deepEqual(replies, []);
  } finally {
    await f.close();
  }
});

test("stopping the team cancels queued and running work and keeps the queue paused", async () => {
  const f = setup();
  try {
    const task = createApprovedTask(f.runtime, taskInput);
    createApprovedTask(f.runtime, { ...taskInput, agentId: "nova" });
    Object.assign(task, {
      status: "running",
      threadId: "thread",
      turnId: "turn",
    });
    f.runtime.active.set(task.id, {
      task,
      outputs: new Map(),
      lastProgress: Date.now(),
    });
    const interrupted: string[] = [];
    f.runtime.codex.request = async (method: string): Promise<any> => {
      interrupted.push(method);
      return {};
    };
    await f.runtime.stopAll();
    assert.equal(f.runtime.paused, true);
    assert.equal(f.runtime.active.size, 0);
    assert.ok(f.store.list("tasks").every((t) => t.status === "cancelled"));
    assert.deepEqual(interrupted, ["turn/interrupt"]);
  } finally {
    await f.close();
  }
});

test("context contains only current project shared and own private memory; concurrency is bounded", async () => {
  const f = setup();
  try {
    f.store.put("projects", { id: "other", name: "Other", path: f.dir });
    for (const [id, projectId, agentId, text] of [
      ["own", "default", "atlas", "MY_PRIVATE"],
      ["shared", "default", null, "SHARED"],
      ["someone", "default", "nova", "OTHER_PRIVATE"],
      ["cross", "other", "atlas", "OTHER_PROJECT"],
    ] as const)
      f.store.put("memories", {
        id,
        projectId,
        agentId,
        text,
        updatedAt: new Date().toISOString(),
      });
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    let thread = 0;
    f.runtime.codex.request = async (
      method: string,
      params: Record<string, unknown>,
    ): Promise<any> => {
      calls.push({ method, params });
      if (method === "thread/start")
        return { thread: { id: `thread-${++thread}` } };
      return { turn: { id: "turn", status: "inProgress" } };
    };
    f.runtime.connection = { state: "ready" };
    const first = createApprovedTask(f.runtime, taskInput);
    createApprovedTask(f.runtime, taskInput);
    createApprovedTask(f.runtime, { ...taskInput, agentId: "nova" });
    createApprovedTask(f.runtime, { ...taskInput, agentId: "sage" });
    await settle();
    await settle();
    assert.equal(f.runtime.active.size, 2);
    assert.equal(
      f.store.list("tasks").filter((t) => t.status === "queued").length,
      2,
    );
    const context = JSON.stringify(
      calls.filter((c) => c.method === "turn/start")[0].params,
    );
    assert.match(context, /MY_PRIVATE/);
    assert.match(context, /SHARED/);
    assert.doesNotMatch(context, /OTHER_PRIVATE|OTHER_PROJECT/);
    const instructions = calls.find((c) => c.method === "thread/start")!.params
      .developerInstructions as string;
    assert.match(instructions, /Atlas/);
    f.runtime.codex.onNotification("turn/completed", {
      threadId: f.store.get("tasks", first.id)!.threadId,
      turn: { status: "completed" },
    });
    await settle();
    assert.equal(f.runtime.active.size, 2);
  } finally {
    await f.close();
  }
});

test("missed schedule coalesces to one job and cannot overlap itself", async () => {
  const f = setup();
  try {
    f.store.put("schedules", {
      id: "daily",
      approvedPlan: { goal: "สรุป", steps: ["อ่านและสรุป"], deliverable: "สรุป", assignments: [] },
      name: "Daily",
      projectId: "default",
      agentId: "atlas",
      prompt: "สรุป",
      kind: "general",
      frequency: "daily",
      time: "09:00",
      date: "2026-11-01",
      weekday: 1,
      timezone: "Asia/Vientiane",
      enabled: true,
      nextRun: "2026-10-01T02:00:00Z",
    });
    f.runtime.tick(new Date("2026-11-02T05:00:00Z"));
    f.runtime.tick(new Date("2026-11-02T05:00:01Z"));
    assert.equal(f.store.list("tasks").length, 1);
    assert.equal(f.store.get("schedules", "daily")!.lastTaskId, f.store.list("tasks")[0].id);
    assert.equal(
      f.store.get("schedules", "daily")!.nextRun,
      "2026-11-03T02:00:00.000Z",
    );
    f.runtime.tick(new Date("2026-11-04T05:00:00Z"));
    assert.equal(f.store.list("tasks").length, 1);
  } finally {
    await f.close();
  }
});

test("restart marks active tasks interrupted and in-flight external actions unknown", async () => {
  const f = setup();
  const task = createApprovedTask(f.runtime, taskInput);
  f.store.put("tasks", { ...task, status: "running" });
  f.store.put("approvals", {
    id: "in-flight",
    type: "external",
    status: "executing",
    title: "",
    details: "",
    projectId: "default",
    agentId: "atlas",
    payload: {},
    createdAt: new Date().toISOString(),
  });
  await f.runtime.close();
  const store = new Store(f.dir);
  const runtime = new OfficeRuntime(store, "http://127.0.0.1:3210");
  assert.equal(store.get("tasks", task.id)!.status, "interrupted");
  assert.equal(store.get("approvals", "in-flight")!.status, "unknown");
  await runtime.close();
  rmSync(f.dir, { recursive: true, force: true });
});

test("room rejects overlapping furniture without changing persisted layout", async () => {
  const f = setup();
  try {
    const before = f.store.get("layout", "office")!;
    assert.throws(
      () =>
        f.runtime.saveRoom({
          furniture: [
            { id: "one", type: "desk", x: 4, y: 5 },
            { id: "two", type: "desk", x: 4, y: 5 },
          ],
          seats: [],
        }),
      /ทับกัน/,
    );
    assert.deepEqual(f.store.get("layout", "office"), before);
  } finally {
    await f.close();
  }
});

test("consultations stay read-only and code answers return to the original worktree", async () => {
  const f = setup();
  try {
    f.store.put("agents", {
      ...f.store.get("agents", "atlas")!,
      permission: "workspace-write",
    });
    f.store.put("agents", {
      ...f.store.get("agents", "nova")!,
      permission: "workspace-write",
    });
    const root = createApprovedTask(f.runtime, { ...taskInput, kind: "code" });
    f.store.put("tasks", {
      ...root,
      status: "completed",
      workspace: join(f.dir, "original-worktree"),
      branch: "codex/test",
    });
    await f.runtime.tool(
      root,
      "office_message",
      { agentId: "nova", body: "ให้คำปรึกษาเท่านั้น" },
      1,
    );
    const calls: Record<string, unknown>[] = [];
    f.runtime.codex.request = async (
      method: string,
      params: Record<string, unknown>,
    ): Promise<any> => {
      if (method === "thread/start") {
        calls.push(params);
        return { thread: { id: `t-${calls.length}` } };
      }
      return { turn: { id: "turn", status: "inProgress" } };
    };
    f.runtime.connection = { state: "ready" };
    f.runtime.tick();
    await settle();
    await settle();
    assert.equal(calls[0].sandbox, "read-only");
    assert.equal(calls[0].approvalPolicy, "on-request");
    assert.equal(calls[0].approvalsReviewer, "auto_review");
    const consultation = f.store
      .list("tasks")
      .find((t) => t.agentId === "nova")!;
    f.runtime.codex.onNotification("turn/completed", {
      threadId: consultation.threadId,
      turn: { status: "completed" },
    });
    await f.runtime.tool(
      consultation,
      "office_message",
      { agentId: "atlas", body: "คำตอบสำหรับงานเดิม" },
      2,
    );
    await settle();
    await settle();
    assert.equal(calls[1].cwd, join(f.dir, "original-worktree"));
    assert.equal(calls[1].sandbox, "workspace-write");
    assert.equal(calls[1].approvalPolicy, "on-request");
    assert.equal(calls[1].approvalsReviewer, "auto_review");
    await assert.rejects(f.runtime.merge(root.id), /ยังปรึกษา/);
  } finally {
    await f.close();
  }
});

test("pause waits for turn completion and resume gates unknown external results", async () => {
  const f = setup();
  try {
    const task = createApprovedTask(f.runtime, taskInput);
    Object.assign(task, { status: "running", threadId: "thread", turnId: "turn", output: "partial" });
    f.runtime.active.set(task.id, { task, outputs: new Map(), lastProgress: Date.now() });
    const calls: string[] = [];
    f.runtime.codex.request = async <T>(method: string) => { calls.push(method); return {} as T; };
    f.store.put("approvals", {
      id: "external", type: "external", status: "unknown", title: "send", details: "check",
      taskId: task.id, projectId: task.projectId, agentId: task.agentId, payload: {}, createdAt: task.createdAt,
    });
    await f.runtime.pauseTask(task.id);
    assert.deepEqual(calls, ["turn/interrupt"]);
    assert.equal(f.store.get("tasks", task.id)?.status, "pausing");
    assert.throws(() => f.runtime.resumeTask({ id: task.id }), /ยังไม่พร้อม/);
    f.runtime.codex.onNotification("turn/completed", { threadId: "thread", turn: { status: "interrupted" } });
    assert.equal(f.store.get("tasks", task.id)?.status, "paused");
    assert.throws(() => f.runtime.resumeTask({ id: task.id }), /ตรวจบริการ/);
    f.runtime.resumeTask({ id: task.id, checked: true, body: "ปรับเป้าหมาย" });
    const resumed = f.store.get("tasks", task.id)!;
    assert.equal(resumed.status, "queued");
    assert.equal(resumed.output, "partial");
    assert.deepEqual(resumed.resumeNotes, ["ปรับเป้าหมาย"]);
  } finally {
    await f.close();
  }
});


test("calendar writes require approval and retain the displayed payload", async () => {
  const f = setup();
  try {
    f.store.put("agents", { ...f.store.get("agents", "atlas")!, googleAccess: true });
    f.runtime.google.status = () => ({ connected: true, configured: true, clientId: "test", email: "test@example.com" });
    const event = { summary: "นัดหมาย", start: "2030-01-01T09:00:00+07:00", end: "2030-01-01T10:00:00+07:00", attendees: ["test@example.com"] };
    f.runtime.google.prepareEvent = async () => event as never;
    let calls = 0;
    f.runtime.google.execute = async (_action, payload) => { calls++; assert.equal(payload.summary, event.summary); return { id: "event", message: "saved" }; };
    const task = createApprovedTask(f.runtime, taskInput);
    f.runtime.active.set(task.id, { task, outputs: new Map(), lastProgress: Date.now() });
    await f.runtime.tool(task, "calendar_write", event, 12);
    const approval = f.store.list("approvals")[0];
    assert.equal(calls, 0);
    assert.deepEqual(JSON.parse(approval.details), event);
    await f.runtime.decide({ id: approval.id, approve: true });
    assert.equal(calls, 1);
    await assert.rejects(f.runtime.decide({ id: approval.id, approve: true }), /จัดการแล้ว/);
  } finally { await f.close(); }
});

test("schedule preparation failure records its reason and pauses", async () => {
  const f = setup();
  try {
    f.store.put("schedules", { id: "broken", name: "Broken", projectId: "default", agentId: "missing", prompt: "test", kind: "general", frequency: "daily", time: "09:00", date: "2026-01-01", weekday: 1, timezone: "Asia/Vientiane", enabled: true, nextRun: "2026-01-01T02:00:00Z", approvedPlan: { goal: "x", steps: ["x"], deliverable: "x", assignments: [] } });
    f.runtime.tick(new Date("2026-11-02T05:00:00Z"));
    const schedule = f.store.get("schedules", "broken")!;
    assert.equal(schedule.enabled, false);
    assert.ok(schedule.lastError);
    assert.equal(schedule.lastTaskId, undefined);
    assert.equal(f.store.list("tasks").length, 0);
  } finally { await f.close(); }
});

test("project history archives only complete task groups and preserves chat links", async () => {
  const { runtime, store, close } = setup();
  try {
    const parent = createApprovedTask(runtime, taskInput);
    const child = createApprovedTask(runtime, { ...taskInput, title: "งานย่อย" });
    const blocked = createApprovedTask(runtime, { ...taskInput, title: "มีโค้ดให้กู้" });
    store.put("tasks", { ...parent, status: "completed" });
    store.put("tasks", { ...child, parentTaskId: parent.id, status: "completed" });
    store.put("tasks", { ...blocked, status: "failed", kind: "code", branch: "codex/office-test" });
    const message = { id: "message-1", projectId: "default", channel: "team", from: "user",
      body: "ประวัติงาน", taskId: child.id, createdAt: parent.createdAt };
    store.put("messages", message);

    const preview = runtime.archiveHistory("default", "tasks");
    assert.equal(preview.count, 1);
    assert.equal(preview.remaining, 1);
    store.put("tasks", { ...child, parentTaskId: parent.id, status: "running" });
    assert.throws(() => runtime.archiveHistory("default", "tasks", preview.token), /รายการเปลี่ยน/);
    assert.equal(runtime.archiveHistory("default", "chats").blocked, true);
    store.put("tasks", { ...child, parentTaskId: parent.id, status: "completed" });

    runtime.archiveHistory("default", "tasks", preview.token);
    assert.ok(store.get("tasks", parent.id)?.archivedAt);
    assert.ok(store.get("tasks", child.id)?.archivedAt);
    assert.equal(store.get("tasks", blocked.id)?.archivedAt, undefined);
    assert.deepEqual(store.get("messages", message.id), message);
    runtime.restoreTaskHistory("default", parent.id);
    assert.equal(store.get("tasks", parent.id)?.archivedAt, undefined);
    assert.equal(store.get("tasks", child.id)?.archivedAt, undefined);

    const chat = runtime.archiveHistory("default", "chats");
    runtime.archiveHistory("default", "chats", chat.token);
    assert.ok(store.get("messages", message.id)?.archivedAt);
    assert.equal(store.get("messages", message.id)?.taskId, child.id);
    assert.equal(runtime.archiveHistory("default", "chats").count, 0);
  } finally {
    await close();
  }
});
