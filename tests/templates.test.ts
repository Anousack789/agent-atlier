import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { OfficeRuntime } from "../server/runtime";
import type { Task, TaskPlan } from "../shared/types";

test("templates isolate projects, strip source text and state, survive restart and require current permissions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atelier-template-"));
  let runtime = new OfficeRuntime(new Store(dir), "http://127.0.0.1:3210");
  try {
    const store = runtime.store;
    runtime.setPaused(true);
    for (const agent of store.list("agents")) store.put("agents", { ...agent, permission: "workspace-write" });
    store.put("projects", { ...store.get("projects", "default")!, id: "other", name: "Other" });
    const plan: TaskPlan = { workflow: true, goal: "private goal", steps: ["private step"], deliverable: "private output", assignments: [
      { agentId: "nova", title: "private title", prompt: "private prompt", kind: "general", deliverable: "private file", stage: { key: "private-key", kind: "design", repositories: [], reviewRequired: true, criteria: ["private criterion"] } },
      { agentId: "atlas", title: "private summary", prompt: "private summary prompt", kind: "general", deliverable: "private delivery", dependsOn: [0], stage: { key: "summary", kind: "summary", repositories: [], reviewRequired: false, criteria: ["private review"] } },
    ] };
    const time = new Date().toISOString();
    const source: Task = { id: "source", rootId: "source", projectId: "default", agentId: "atlas", title: "private task", prompt: "private prompt", kind: "general", status: "completed", output: "private output", round: 0, channel: "team", activity: "done", createdAt: time, updatedAt: time, plan, approvedRevision: 1, workflow: { phase: "acceptance", revision: 1, taskIds: [], repositories: [] } };
    store.put("tasks", source);
    const texts = [{ description: "Design", criteria: ["Reusable design criterion"] }, { description: "Summarize", criteria: ["Reusable summary criterion"] }];
    const input = { projectId: "default", taskId: source.id, name: "Reusable", texts };
    assert.throws(() => runtime.saveTemplate(input), /ตรวจรับ/);
    store.put("tasks", { ...source, workflow: { ...source.workflow!, phase: "closed", acceptedAt: time, acceptedFingerprint: "fingerprint" } });
    store.put("approvals", { id: "old-approval", projectId: "default", agentId: "atlas", taskId: source.id, type: "delegate", status: "approved", title: "old", details: "old", payload: {}, createdAt: time });
    const template = runtime.saveTemplate(input);
    assert.doesNotMatch(JSON.stringify(template), /private|fingerprint/);
    assert.equal(runtime.listTemplates({ projectId: "other" }).length, 0);
    for (const action of [() => runtime.createTemplateDraft({ projectId: "other", id: template.id, prompt: "new" }), () => runtime.renameTemplate({ projectId: "other", id: template.id, name: "x" }), () => runtime.deleteTemplate({ projectId: "other", id: template.id })]) assert.throws(action, /โปรเจกต์/);
    store.remove("tasks", "source");
    await runtime.close();
    runtime = new OfficeRuntime(new Store(dir), "http://127.0.0.1:3210");
    const draft = runtime.createTemplateDraft({ projectId: "default", id: template.id, prompt: "new assignment" });
    assert.equal(draft.status, "draft");
    assert.equal(draft.approvedRevision, undefined);
    assert.equal(draft.workflow, undefined);
    assert.equal(draft.worktrees, undefined);
    assert.equal(runtime.store.list("approvals").filter((approval) => approval.taskId === draft.id).length, 0);
    assert.doesNotMatch(JSON.stringify(draft), /private|fingerprint/);
    assert.deepEqual(draft.plan!.assignments.map((a) => a.stage!.reviewRequired), [true, false]);
    assert.deepEqual(draft.plan!.assignments[1].dependsOn, [0]);
    assert.deepEqual(draft.plan!.assignments[0].stage!.criteria, texts[0].criteria);
    const nova = runtime.store.get("agents", "nova")!;
    runtime.store.put("agents", { ...nova, permission: "read-only" });
    assert.throws(() => runtime.confirmPlan({ id: draft.id, revision: draft.planRevision }), /สิทธิ์/);
    const assignments = draft.plan!.assignments.map((a) => ({ agentId: a.agentId === "nova" ? "pixel" : a.agentId, description: a.title, criteria: a.stage!.criteria, repositories: a.stage!.repositories }));
    const revised = runtime.editTemplateDraft({ id: draft.id, revision: draft.planRevision, assignments });
    const pixel = runtime.store.get("agents", "pixel")!;
    runtime.store.put("agents", { ...pixel, permission: "read-only" });
    assert.throws(() => runtime.confirmPlan({ id: draft.id, revision: revised.planRevision }), /สิทธิ์/);
    runtime.store.put("agents", pixel);
    runtime.renameTemplate({ projectId: "default", id: template.id, name: "Renamed" });
    runtime.deleteTemplate({ projectId: "default", id: template.id });
    assert.equal(runtime.store.get("tasks", draft.id)!.plan!.assignments[0].title, "Design");
    runtime.confirmPlan({ id: draft.id, revision: revised.planRevision });
    assert.equal(runtime.store.get("tasks", draft.id)!.status, "waiting");
    assert.equal(runtime.store.get("tasks", draft.id)!.workflow!.phase, "active");
    assert.equal(runtime.store.get("tasks", draft.id)!.templateDraft, undefined);
  } finally { await runtime.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("backup restores templates and accepts old backups without templates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atelier-template-backup-"));
  const runtime = new OfficeRuntime(new Store(dir), "http://127.0.0.1:3210");
  try {
    runtime.store.put("templates", { id: "template", projectId: "default", sourceTaskId: "deleted", name: "Reusable", stages: [{ agentId: "atlas", kind: "general", stageKind: "summary", reviewRequired: false, dependsOn: [], description: "Summary", criteria: ["Reviewed"] }] });
    const backup = JSON.parse(await runtime.backups.export());
    runtime.store.remove("templates", "template");
    let preview = await runtime.backups.inspect(backup);
    await runtime.backups.restore(backup, preview.token);
    assert.equal(runtime.store.get("templates", "template")?.sourceTaskId, "deleted");
    const old = structuredClone(backup); delete old.data.templates;
    preview = await runtime.backups.inspect(old);
    await runtime.backups.restore(old, preview.token);
    assert.equal(runtime.store.list("templates").length, 0);
  } finally { await runtime.close(); rmSync(dir, { recursive: true, force: true }); }
});
