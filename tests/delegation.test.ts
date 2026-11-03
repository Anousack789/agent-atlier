import { test } from "node:test";
import assert from "node:assert/strict";
import { delegationWarnings } from "../shared/delegation";
import type { TaskPlan } from "../shared/types";

test("delegation warnings apply to new plans and identify self-review", () => {
  const work = { agentId: "boss", title: "work", prompt: "work", kind: "code" as const, deliverable: "code" };
  const review = { ...work, kind: "general" as const, stage: { key: "review", kind: "review" as const, repositories: [], reviewRequired: true, criteria: ["check"] } };
  const plan: TaskPlan = { goal: "goal", steps: ["step"], deliverable: "result", assignments: [work, review] };
  assert.deepEqual(delegationWarnings(plan, "boss"), []);
  plan.teamAvailability = [];
  assert.equal(delegationWarnings(plan, "boss").length, 2);
  plan.assignments[1].agentId = "reviewer";
  assert.deepEqual(delegationWarnings(plan, "boss"), []);
  plan.assignments[0].agentId = "reviewer";
  assert.deepEqual(delegationWarnings(plan, "boss"), ["ผู้พัฒนาตรวจงานตัวเอง"]);
});
