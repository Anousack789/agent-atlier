import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createWorktree, mergeTask, taskDiff } from "../server/git";
import type { Task } from "../shared/types";
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "office-git-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@localhost", ...args],
      { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
  git("init", "-b", "main");
  writeFileSync(join(dir, "hello.txt"), "before\n");
  git("add", ".");
  git("commit", "-m", "initial");
  const project = { id: "p", name: "P", path: dir };
  const task = {
    id: randomUUID(),
    title: "update greeting",
    status: "completed",
  } as Task;
  return {
    dir,
    git,
    project,
    task,
    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("worktree isolates changes, shows diff and merges only after requested", async () => {
  const f = setup();
  try {
    Object.assign(
      f.task,
      await createWorktree(f.project, f.task, join(f.dir, ".office-test")),
    );
    writeFileSync(join(f.task.workspace!, "hello.txt"), "after\n");
    writeFileSync(join(f.task.workspace!, "new.txt"), "new file contents\n");
    assert.equal(readFileSync(join(f.dir, "hello.txt"), "utf8"), "before\n");
    assert.match(await taskDiff(f.task), /\+after/);
    assert.match(await taskDiff(f.task), /new file contents/);
    // The data directory is outside production projects; ignore this test's nested directory.
    f.git("config", "core.excludesFile", "/dev/null");
    writeFileSync(join(f.dir, ".git/info/exclude"), ".office-test/\n");
    await mergeTask(f.project, f.task);
    assert.equal(f.git("log", "-1", "--format=%an <%ae>"), "Agent Atelier <agent-atelier@localhost>");
    assert.equal(f.git("log", "-1", "--format=%an <%ae>", f.task.branch!), "Agent Atelier <agent-atelier@localhost>");
    assert.equal(readFileSync(join(f.dir, "hello.txt"), "utf8"), "after\n");
    assert.equal(f.git("branch", "--show-current"), "main");
    assert.equal(f.git("status", "--porcelain"), "");
  } finally {
    f.close();
  }
});
test("merge conflict aborts cleanly and preserves main branch work", async () => {
  const f = setup();
  try {
    Object.assign(
      f.task,
      await createWorktree(f.project, f.task, join(f.dir, ".office-test")),
    );
    writeFileSync(join(f.dir, ".git/info/exclude"), ".office-test/\n");
    writeFileSync(join(f.task.workspace!, "hello.txt"), "agent\n");
    writeFileSync(join(f.dir, "hello.txt"), "human\n");
    f.git("add", "hello.txt");
    f.git("commit", "-m", "human change");
    await assert.rejects(mergeTask(f.project, f.task), /รวมงานไม่สำเร็จ/);
    assert.equal(readFileSync(join(f.dir, "hello.txt"), "utf8"), "human\n");
    assert.equal(f.git("status", "--porcelain"), "");
  } finally {
    f.close();
  }
});

test("merge rejects a worktree checked out to another branch or belonging to another repository", async () => {
  const f = setup(), other = setup();
  try {
    Object.assign(f.task, await createWorktree(f.project, f.task, join(f.dir, ".office-test")));
    writeFileSync(join(f.dir, ".git/info/exclude"), ".office-test/\n");
    await assert.rejects(mergeTask(f.project, { ...f.task, branch: "different-branch" }), /branch ใน worktree เปลี่ยน/);
    await assert.rejects(mergeTask(other.project, f.task), /ไม่ตรงกับ repository/);
    assert.equal(f.git("status", "--porcelain"), "");
    assert.equal(other.git("status", "--porcelain"), "");
  } finally { f.close(); other.close(); }
});
