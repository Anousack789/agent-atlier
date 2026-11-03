import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskDetail } from "../components/Details";
import { ChatPanel } from "../components/ChatPanel";
import { mkdtemp, mkdir, writeFile, symlink, rm, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskFileLinks } from "../shared/task-files";
import { readTaskFile } from "../server/task-files";
import type { Snapshot, Task } from "../shared/types";

const task = {
  id: "result-task", status: "completed", projectId: "project", agentId: "pixel",
  output: "![Desktop และ Mobile](design-output/transaction-detail.png)\n[ไฟล์ FigCraft](design-output/transaction-detail.figcraft) · [สเปก](design-output/spec.md)",
} as Task;

test("task results expose local image previews and downloadable generated files", () => {
  const html = renderToStaticMarkup(React.createElement(TaskDetail, {
    task, state: { agents: [], projects: [], tasks: [], intakes: [] } as unknown as Snapshot,
    action: async <T,>() => undefined as T,
  }));
  assert.match(html, /<img[^>]+src="\/api\/task-file\?/);
  assert.match(html, /download="transaction-detail.figcraft"/);
  assert.match(html, /download="spec.md"/);
});

test("agent chat results expose the same files, user messages cannot expose task files", () => {
  const message = { id: "message", projectId: "project", channel: "team", from: "pixel", body: task.output, taskId: task.id, createdAt: new Date().toISOString() };
  const state = { agents: [], projects: [], tasks: [], intakes: [], messages: [message] } as unknown as Snapshot;
  const render = () => renderToStaticMarkup(React.createElement(ChatPanel, {
    state, projectId: "project", initialChannel: "team", action: async () => undefined,
  }));
  assert.match(render(), /download="transaction-detail.figcraft"/);
  message.from = "user";
  assert.doesNotMatch(render(), /\/api\/task-file/);
});

test("cancelled draft plans are not presented as approved", () => {
  const html = renderToStaticMarkup(React.createElement(TaskDetail, {
    task: { ...task, status: "cancelled", plan: { goal: "สรุป", steps: ["อ่านข้อมูล"], deliverable: "รายงาน", assignments: [] } },
    state: { agents: [], projects: [], tasks: [] } as unknown as Snapshot,
    action: async <T,>() => undefined as T,
  }));
  assert.match(html, /แผนที่ยังไม่ได้ยืนยัน/);
  assert.doesNotMatch(html, /แผนที่ยืนยันแล้ว/);
});

test("extracts local Markdown paths, including encoded spaces and absolute paths, without remote schemes", () => {
  assert.deepEqual(taskFileLinks("![x](design/a.png) [x](design/a.png) [spec](<design/my spec.md>) [fig](/tmp/a%20b.figcraft) [x](a(b).png) [web](https://example.com/x.png) [bad](javascript:alert) [bad](//host/a.png) [bad](file:///tmp/x.png) [bad](a%00.png)"),
    ["design/a.png", "design/my spec.md", "/tmp/a b.figcraft", "a(b).png"]);
});

test("reads only referenced regular artifact files in the saved task workspace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atelier-task-files-"));
  try {
    const workspace = join(dir, "worktree");
    await mkdir(join(workspace, "design-output"), { recursive: true });
    const files = ["transaction-detail.png", "transaction-detail.figcraft", "spec.md", "my spec.md", "unsafe.html", "unsafe.svg"];
    for (const name of files) await writeFile(join(workspace, "design-output", name), name);
    const output = files.map((name) => `[file](<design-output/${name}>)`).join("\n");
    const saved = { ...task, workspace, output };
    for (const name of files) {
      const result = await readTaskFile(saved, `design-output/${name}`);
      assert.equal(result.bytes.toString(), name);
      assert.equal(result.name, name);
      assert.equal(result.preview, !/unsafe/.test(name) && !name.endsWith(".figcraft"));
    }
    assert.equal((await readTaskFile(saved, "design-output/spec.md")).mime, "text/plain; charset=utf-8");
    const absolute = join(workspace, "design-output", "spec.md");
    assert.equal((await readTaskFile({ ...saved, output: `[spec](${absolute})` }, absolute)).bytes.toString(), "spec.md");
    await assert.rejects(readTaskFile(saved, "unreferenced.txt"));
    await assert.rejects(readTaskFile({ ...saved, workspace: undefined }, "design-output/spec.md"));
    await assert.rejects(readTaskFile(undefined, "design-output/spec.md"));
    await rm(join(workspace, "design-output", "spec.md"));
    await assert.rejects(readTaskFile(saved, "design-output/spec.md"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("rejects traversal, sensitive files, symlink escapes, directories and oversized files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atelier-task-files-"));
  try {
    const workspace = join(dir, "worktree");
    await mkdir(workspace);
    // All fixtures are synthetic; no user configuration is accessed.
    await writeFile(join(dir, "outside.txt"), "outside fixture");
    await symlink(join(dir, "outside.txt"), join(workspace, "linked.txt"));
    await symlink(dir, join(workspace, "linked-dir"));
    await mkdir(join(workspace, "folder.txt"));
    await writeFile(join(workspace, "large.txt"), "");
    await truncate(join(workspace, "large.txt"), 50 * 1024 * 1024 + 1);
    for (const path of ["../outside.txt", join(dir, "outside.txt"), ".env", ".env.local", ".git/config", ".data/office.sqlite", "credentials.txt", "token.txt", "private.key", "en.json", "linked.txt", "linked-dir/outside.txt", "folder.txt", "large.txt"]) {
      await assert.rejects(readTaskFile({ ...task, workspace, output: `[file](${path})` }, path), path);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
