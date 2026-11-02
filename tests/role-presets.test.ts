import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadRolePresets, rolePresets, rolePresetsError } from "../server/role-presets";
import { rolePresetIds } from "../shared/role-presets";
import { agentInput } from "../shared/validation";
import { OfficeRuntime } from "../server/runtime";
import { Store } from "../server/store";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "atelier-presets-"));
  const runtime = new OfficeRuntime(new Store(dir), "http://127.0.0.1:3210");
  return { dir, runtime, async close() {
    await runtime.close();
    rmSync(dir, { recursive: true, force: true });
  } };
}

test("the explicit catalog covers all 15 Markdown files and validates prompt content", () => {
  assert.equal(rolePresetsError, "");
  assert.equal(rolePresets.length, 15);
  assert.equal(new Set(rolePresets.map((p) => p.id)).size, 15);
  assert.deepEqual(rolePresets.map((p) => p.id), [...rolePresetIds]);
  assert.deepEqual(readdirSync(new URL("../prompts/roles/", import.meta.url)).sort(), rolePresetIds.map((id) => `${id}.md`).sort());
  for (const preset of rolePresets) {
    assert.ok(preset.instructions.length <= 16000);
    assert.ok(preset.label && preset.role);
    assert.match(preset.instructions, /human approval/);
    assert.match(preset.instructions, /Reply in Thai/);
  }
  const dir = mkdtempSync(join(tmpdir(), "atelier-prompt-files-"));
  const root = pathToFileURL(`${dir}/`);
  try {
    assert.throws(() => loadRolePresets(root), /Cannot read role preset: frontend.md/);
    cpSync(new URL("../prompts/roles/", import.meta.url), dir, { recursive: true });
    for (const text of ["", "x".repeat(16001)]) {
      writeFileSync(join(dir, "frontend.md"), text);
      assert.throws(() => loadRolePresets(root), /frontend.md must contain 1–16000/);
    }
    writeFileSync(join(dir, "frontend.md"), "# Missing sections");
    assert.throws(() => loadRolePresets(root), /frontend.md is missing section: Role/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("seed defaults, customized presets, legacy members, and backups survive restart", async () => {
  const source = setup(), target = setup();
  let reopened: OfficeRuntime | undefined;
  try {
    assert.deepEqual(source.runtime.store.list("agents").map((a) => a.promptPresetId),
      ["planner", "full-stack-developer", "researcher", "ux-ui-designer"]);
    const original = source.runtime.store.get("agents", "atlas")!;
    const preset = rolePresets.find((p) => p.id === "backend")!;
    const customized = source.runtime.saveAgent({ ...original, role: "Custom backend", promptPresetId: preset.id,
      instructions: `${preset.instructions}\n\n## Member preference\n\nUse existing project patterns.` });
    const nova = source.runtime.store.get("agents", "nova")!;
    const { promptPresetId: _unused, ...legacy } = nova;
    legacy.instructions = "Legacy custom instructions";
    source.runtime.saveAgent(legacy);
    assert.throws(() => source.runtime.saveAgent({ ...customized, promptPresetId: "unknown" }));
    assert.throws(() => source.runtime.saveAgent({ ...customized, instructions: "x".repeat(16001) }));
    assert.equal(agentInput.parse({ ...customized, instructions: "x".repeat(16000) }).instructions.length, 16000);
    const backup = JSON.parse(await source.runtime.backups.export());
    const preview = await target.runtime.backups.inspect(backup);
    await target.runtime.backups.restore(backup, preview.token);
    assert.deepEqual(target.runtime.store.get("agents", "atlas"), customized);
    assert.deepEqual(target.runtime.store.get("agents", "nova"), legacy);
    await source.runtime.close();
    reopened = new OfficeRuntime(new Store(source.dir), "http://127.0.0.1:3210");
    assert.deepEqual(reopened.store.get("agents", "atlas"), customized);
    assert.deepEqual(reopened.store.get("agents", "nova"), legacy);
    assert.equal(reopened.store.list("agents").length, 4);
  } finally {
    if (reopened) {
      await reopened.close();
      rmSync(source.dir, { recursive: true, force: true });
    } else await source.close();
    await target.close();
  }
});

test("fake Codex receives the saved customized Markdown and office safeguards", async () => {
  const f = setup();
  try {
    const original = f.runtime.store.get("agents", "atlas")!;
    const preset = rolePresets.find((p) => p.id === "frontend")!;
    const agent = f.runtime.saveAgent({ ...original, promptPresetId: preset.id, role: preset.role,
      instructions: `${preset.instructions}\n\n## Custom\n\nCUSTOM_MARKDOWN_CHECK` });
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    f.runtime.codex.request = async (method: string, params: Record<string, unknown>): Promise<any> => {
      calls.push({ method, params });
      return method === "thread/start" ? { thread: { id: "fake-thread" } }
        : { turn: { id: "fake-turn", status: "inProgress" } };
    };
    f.runtime.connection = { state: "ready" };
    f.runtime.createTask({ title: "Preset check", prompt: "Review the UI", agentId: agent.id, projectId: "default", kind: "general" });
    for (let i = 0; i < 20 && !calls.some((c) => c.method === "turn/start"); i++)
      await new Promise((resolve) => setImmediate(resolve));
    const params = calls.find((c) => c.method === "thread/start")?.params;
    assert.ok(params);
    assert.ok((params.developerInstructions as string).startsWith(agent.instructions));
    assert.match(params.developerInstructions as string, /CUSTOM_MARKDOWN_CHECK/);
    assert.match(params.developerInstructions as string, /office_request_task/);
    assert.match(params.developerInstructions as string, /Gmail\/Calendar writes MUST/);
    assert.match(params.developerInstructions as string, /Do not access other projects/);
    assert.equal(params.sandbox, "read-only");
    assert.equal(params.approvalsReviewer, "user");
    assert.throws(() => f.runtime.saveAgent(agent), /หยุดงาน/);
  } finally {
    await f.close();
  }
});
