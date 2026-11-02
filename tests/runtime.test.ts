import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { OfficeRuntime } from "../server/runtime";
import type { Task } from "../shared/types";

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
    const task = f.runtime.createTask(taskInput);
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
    const task = f.runtime.createTask(taskInput);
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
    const task = f.runtime.createTask(taskInput);
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
    const task = f.runtime.createTask(taskInput);
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
    const task = f.runtime.createTask(taskInput, { round: 6 });
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
    const task = f.runtime.createTask(taskInput);
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
    f.runtime.createTask({ ...taskInput, agentId: agent.id });
    await settle();
    await settle();
    assert.equal(calls[0].params.model, "test-model");
    assert.match(
      String(calls[0].params.developerInstructions),
      /CUSTOM_INSTRUCTIONS/,
    );
    assert.equal(calls[0].params.approvalsReviewer, "user");
    assert.equal(agent.avatar, 2);
  } finally {
    await f.close();
  }
});

test("stopping the team cancels queued and running work and keeps the queue paused", async () => {
  const f = setup();
  try {
    const task = f.runtime.createTask(taskInput);
    f.runtime.createTask({ ...taskInput, agentId: "nova" });
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
    const first = f.runtime.createTask(taskInput);
    f.runtime.createTask(taskInput);
    f.runtime.createTask({ ...taskInput, agentId: "nova" });
    f.runtime.createTask({ ...taskInput, agentId: "sage" });
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
  const task = f.runtime.createTask(taskInput);
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
    const root = f.runtime.createTask({ ...taskInput, kind: "code" });
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
    await assert.rejects(f.runtime.merge(root.id), /ยังปรึกษา/);
  } finally {
    await f.close();
  }
});
