import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, realpath, readFile, lstat, readlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import type { Project, Task } from "../shared/types";

const exec = promisify(execFile);
async function git(cwd: string, ...args: string[]) {
  const result = await exec("git", args, {
    cwd,
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return args.includes("-z") ? result.stdout : result.stdout.trim();
}
export async function gitStatus(path: string) {
  try {
    const root = await git(path, "rev-parse", "--show-toplevel");
    const branch = await git(path, "symbolic-ref", "--short", "HEAD");
    const head = await git(path, "rev-parse", "HEAD");
    return { ready: true, root, branch, head };
  } catch {
    return { ready: false, root: "", branch: "", head: "" };
  }
}
export async function worktreeFingerprint(workspace: string) {
  const root = await git(workspace, "rev-parse", "--show-toplevel");
  const hash = createHash("sha256");
  const changed = (await git(root, "diff", "--name-only", "HEAD", "-z")).split("\0").filter(Boolean);
  const untracked = (await git(root, "ls-files", "--others", "--exclude-standard", "-z")).split("\0").filter(Boolean);
  if ([...changed, ...untracked].some(privateRepositoryPath))
    throw new Error("พบไฟล์ข้อมูลลับในรายการเปลี่ยนแปลง กรุณานำออกก่อนส่งตรวจ");
  hash.update(await git(root, "rev-parse", "HEAD"));
  hash.update(await git(root, "diff", "--binary", "HEAD"));
  for (const file of untracked.sort()) {
    const path = join(root, file), info = await lstat(path);
    if (!info.isFile() && !info.isSymbolicLink()) throw new Error("ไฟล์ผลงานต้องเป็น regular file หรือ symbolic link");
    hash.update(JSON.stringify([file, info.mode]));
    hash.update(info.isSymbolicLink() ? await readlink(path) : await readFile(path));
  }
  return hash.digest("hex");
}
export function privateRepositoryPath(path: string) {
  return path.split("/").some((name) => /^\.env|^(?:\.ssh|\.aws|\.config|id_rsa|id_ed25519|credentials(?:\.json)?|secrets(?:\.json)?|tokens?\.json|passwords?\.json)$|\.(?:pem|key|p12|pfx|crt|cer|csr)$/i.test(name));
}
export async function repositoryFiles(workspace: string) {
  return [...new Set((await git(workspace, "ls-files", "--cached", "--others", "--exclude-standard", "-z")).split("\0").filter(Boolean))];
}
export async function createWorktree(
  project: Pick<Project, "path">,
  task: Task,
  dataDir: string,
  repositoryId?: string,
) {
  const status = await gitStatus(project.path);
  if (!status.ready)
    throw new Error(
      "โปรเจกต์ต้องมี Git repository และ initial commit ก่อนเริ่มงานโค้ด",
    );
  if (await git(status.root, "status", "--porcelain"))
    throw new Error(
      "โปรเจกต์มีไฟล์ที่ยังไม่ commit กรุณาบันทึกหรือ stash ก่อนสร้างงานโค้ด เพื่อให้ agent เห็นโค้ดล่าสุดครบถ้วน",
    );
  const root = await realpath(status.root);
  const projectPath = await realpath(project.path);
  const suffix = relative(root, projectPath);
  await mkdir(join(dataDir, "worktrees"), { recursive: true });
  const worktree = join(dataDir, "worktrees", task.id, ...(repositoryId ? [repositoryId] : []));
  const branch = `codex/office-${task.id.slice(0, 12)}${repositoryId ? `-${repositoryId}` : ""}`;
  await mkdir(join(worktree, ".."), { recursive: true });
  await git(root, "worktree", "add", "-b", branch, worktree, status.head);
  return {
    workspace: join(worktree, suffix),
    branch,
    baseBranch: status.branch,
    baseCommit: status.head,
  };
}
export async function taskDiff(task: Pick<Task, "workspace" | "baseCommit">) {
  if (!task.workspace || !task.baseCommit) return "งานนี้ไม่มี worktree";
  const tracked = await git(task.workspace, "diff", task.baseCommit);
  const root = await git(task.workspace, "rev-parse", "--show-toplevel");
  const untracked = (
    await git(root, "ls-files", "--others", "--exclude-standard", "-z")
  )
    .split("\0")
    .filter(Boolean);
  const files: string[] = [];
  for (const file of untracked) {
    const path = join(root, file);
    const info = await lstat(path);
    const content = info.isSymbolicLink()
      ? `[symlink → ${await readlink(path)}]`
      : info.size > 128000
        ? `[ไฟล์ขนาด ${info.size} bytes — กรุณาตรวจไฟล์ใน worktree]`
        : await readFile(path).then((b) =>
            b.includes(0) ? "[binary file]" : b.toString("utf8"),
          );
    files.push(`+++ ${file} (ไฟล์ใหม่)\n${content}`);
  }
  return (
    (tracked || "ไม่มีการเปลี่ยนแปลงไฟล์ที่ติดตาม") +
    (files.length ? `\n\n${files.join("\n\n")}` : "")
  );
}
export async function mergeTask(project: Pick<Project, "path">, task: Pick<Task, "workspace" | "branch" | "baseBranch" | "baseCommit" | "mergedAt" | "title">) {
  if (!task.workspace || !task.branch || !task.baseBranch)
    throw new Error("งานนี้ไม่มี branch สำหรับรวม");
  if (task.mergedAt) throw new Error("งานนี้รวมแล้ว");
  const status = await gitStatus(project.path);
  if (!status.ready || status.branch !== task.baseBranch)
    throw new Error(`โปรดกลับไป branch ${task.baseBranch} ก่อนรวมงาน`);
  if (await git(status.root, "status", "--porcelain"))
    throw new Error(
      "โปรเจกต์หลักมีการแก้ไขที่ยังไม่ commit กรุณาบันทึกหรือ stash ก่อน",
    );
  if (await git(task.workspace, "symbolic-ref", "--short", "HEAD") !== task.branch)
    throw new Error("branch ใน worktree เปลี่ยนไป กรุณาตรวจสอบก่อนรวม");
  const sourceGit = await realpath(await git(status.root, "rev-parse", "--path-format=absolute", "--git-common-dir"));
  const worktreeGit = await realpath(await git(task.workspace, "rev-parse", "--path-format=absolute", "--git-common-dir"));
  if (sourceGit !== worktreeGit) throw new Error("worktree ไม่ตรงกับ repository ต้นทาง");
  await git(task.workspace, "add", "--all");
  if (await git(task.workspace, "diff", "--cached", "--name-only")) {
    await git(
      task.workspace,
      "-c",
      "user.name=Agent Atelier",
      "-c",
      "user.email=agent-atelier@localhost",
      "commit",
      "-m",
      `feat: ${task.title.slice(0, 120)}`,
    );
  }
  try {
    await git(
      status.root,
      "-c",
      "user.name=Agent Atelier",
      "-c",
      "user.email=agent-atelier@localhost",
      "merge",
      "--no-ff",
      task.branch,
      "-m",
      `feat: merge ${task.title.slice(0, 100)}`,
    );
  } catch (error) {
    try {
      await git(status.root, "merge", "--abort");
    } catch {
      /* Merge can fail before a merge state exists. */
    }
    throw new Error(
      `รวมงานไม่สำเร็จ โปรเจกต์หลักยังอยู่ที่เดิม: ${error instanceof Error ? error.message : "merge failed"}`,
    );
  }
}
export async function initializeGit(project: Project) {
  await git(project.path, "init");
}
