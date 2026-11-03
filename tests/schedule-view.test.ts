import { test } from "node:test";
import assert from "node:assert/strict";
import { latestScheduleTask, scheduleAttention } from "../shared/schedule-view";
import type { Approval, Schedule, Task } from "../shared/types";

const schedule: Schedule = { id: "s", name: "Daily", agentId: "a", projectId: "p", prompt: "", kind: "general", frequency: "daily", time: "09:00", date: "2026-01-01", weekday: 1, timezone: "Asia/Vientiane", enabled: true, nextRun: null, lastRun: "2026-11-03T02:00:00.000Z", lastTaskId: "latest" };
const task = (id: string, status: Task["status"], createdAt: string): Task => ({ id, title: id, prompt: "", projectId: "p", agentId: "a", kind: "general", status, output: "", rootId: id, round: 0, channel: "team", activity: "", createdAt, updatedAt: createdAt, scheduleId: "s" });

test("latest schedule run links only its matching task", () => {
  const old = task("old", "reviewing", "2026-11-02T02:00:00.001Z");
  const latest = task("latest", "running", "2026-11-03T02:00:00.001Z");
  assert.equal(latestScheduleTask(schedule, [old, latest])?.id, "latest");
  assert.equal(latestScheduleTask(schedule, [old]), undefined);
  assert.equal(latestScheduleTask({ ...schedule, lastTaskId: undefined }, [latest]), undefined);
});

test("attention is derived without duplicates and keeps older runs scoped to the project", () => {
  const old = task("old", "reviewing", "2026-11-02T02:00:00Z");
  const latest = task("latest", "running", "2026-11-03T02:00:00Z");
  const approval: Approval = { id: "approval", type: "external", status: "pending", title: "send", details: "", projectId: "p", agentId: "a", taskId: "old", payload: {}, createdAt: old.createdAt };
  const snapshot = [old, latest];
  assert.deepEqual(scheduleAttention("p", snapshot, [approval]), scheduleAttention("p", snapshot, [approval]));
  assert.deepEqual(scheduleAttention("p", snapshot, [approval]).tasks.map((t) => t.id), ["old"]);
  assert.equal(scheduleAttention("p", snapshot, [approval]).approvals.length, 1);
  assert.equal(scheduleAttention("other", snapshot, [approval]).tasks.length, 0);
  assert.equal(scheduleAttention("p", [{ ...old, status: "completed" }, latest], [{ ...approval, status: "approved" }]).tasks.length, 0);
  assert.equal(scheduleAttention("p", snapshot, [{ ...approval, status: "approved" }]).approvals.length, 0);
});
