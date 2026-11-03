import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, basename, relative } from "node:path";
import sharp from "sharp";
import type { Task, TaskPlan } from "../shared/types";
import type { Delivery } from "../shared/workflow";
import { taskFileLinks } from "../shared/task-files";
import { readTaskFile } from "./task-files";
import { gitStatus, privateRepositoryPath, repositoryFiles, worktreeFingerprint } from "./git";

export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const latestDelivery = (task: Task) => task.deliveries?.at(-1);
export const deliveryReady = (task: Task) => task.status === "completed" && !!latestDelivery(task) &&
  (!task.stage?.reviewRequired || !!latestDelivery(task)?.approvedAt);
export const workflowFingerprint = (tasks: Task[]) => digest(JSON.stringify(tasks.map((task) => [task.id, latestDelivery(task)?.fingerprint])));

export function validateWorkflow(plan: TaskPlan, bossId: string, repositoryIds: string[]) {
  if (!plan.workflow) {
    if (plan.assignments.some((a) => a.stage)) throw new Error("ขั้นตอน workflow ต้องอยู่ในแผน workflow");
    return;
  }
  const assignments = plan.assignments;
  if (assignments.some((a, i) => a.dependsOn?.some((d) => !Number.isInteger(d) || d < 0 || d >= i))) throw new Error("ขั้นตอนอ้างได้เฉพาะขั้นก่อนหน้า");
  const keys = new Set<string>(), owners = new Set<string>();
  if (!assignments.length || assignments.at(-1)?.stage?.kind !== "summary" || assignments.at(-1)?.agentId !== bossId)
    throw new Error("workflow ต้องจบด้วยขั้นสรุปของ Boss");
  const ancestors = (index: number): number[] => [...new Set((assignments[index].dependsOn || []).flatMap((i) => [i, ...ancestors(i)]))];
  assignments.forEach((a, index) => {
    const stage = a.stage;
    if (!stage || keys.has(stage.key)) throw new Error("ทุกขั้นต้องมี stage และ key ไม่ซ้ำ");
    keys.add(stage.key);
    if (new Set(stage.repositories).size !== stage.repositories.length || stage.repositories.some((id) => !repositoryIds.includes(id)))
      throw new Error("repository ของขั้นตอนไม่ถูกต้อง");
    if (new Set(stage.criteria).size !== stage.criteria.length) throw new Error("เกณฑ์ตรวจรับต้องไม่ซ้ำ");
    if (a.kind === "code") {
      if (stage.kind !== "work" || !stage.repositories.length) throw new Error("งานโค้ดต้องระบุ repo และเป็นขั้น work");
      for (const id of stage.repositories) {
        // shortcut: one implementation owner per repo; add explicit code composition before supporting multiple writers.
        if (owners.has(id)) throw new Error("หนึ่ง repo มีเจ้าของงานโค้ดได้หนึ่งคน ใช้ fullstack สำหรับ repo เดียวกัน");
        owners.add(id);
      }
      const designs = assignments.flatMap((s, i) => s.stage?.kind === "design" ? [i] : []);
      if (designs.some((i) => !ancestors(index).includes(i))) throw new Error("งานโค้ดต้องรอขั้นออกแบบทั้งหมด");
    } else if (stage.repositories.length) throw new Error("ระบุ repo ที่เขียนได้เฉพาะงานโค้ด");
    if (stage.kind === "design" && !stage.reviewRequired) throw new Error("แบบต้องรอผู้ใช้อนุมัติ");
    if (["review", "summary"].includes(stage.kind) && a.kind !== "general") throw new Error("ขั้นตรวจและสรุปต้องไม่แก้โค้ด");
    if (stage.kind === "summary" && (index !== assignments.length - 1 || stage.reviewRequired)) throw new Error("มีขั้นสรุปท้ายแผนเพียงขั้นเดียว");
  });
  const last = assignments.length - 1;
  if (ancestors(last).length !== last) throw new Error("สรุปต้องรอทุกขั้นในแผน");
  const code = assignments.flatMap((a, i) => a.kind === "code" ? [i] : []);
  if (code.length && !assignments.some((a, i) => a.stage?.kind === "review" && code.every((c) => ancestors(i).includes(c))))
    throw new Error("งานโค้ดต้องมีผู้ตรวจรวมหลังงานโค้ดทุก repo");
}

export async function repositoryFingerprint(tree: NonNullable<Task["worktrees"]>[number]) {
  const status = await gitStatus(tree.workspace);
  if (!status.ready || status.branch !== tree.branch) throw new Error("branch ของผลงานเปลี่ยนแล้ว");
  return worktreeFingerprint(tree.workspace);
}

export async function captureDelivery(dir: string, task: Task, dependencies: Task[], result: Pick<Delivery, "output" | "checks" | "incomplete">): Promise<Delivery> {
  const revision = (latestDelivery(task)?.revision || 0) + 1;
  const files: Delivery["files"] = [];
  const destination = join(dir, "deliveries", task.id, String(revision));
  await mkdir(destination, { recursive: true, mode: 0o700 });
  for (const path of taskFileLinks(result.output)) {
    const file = await readTaskFile({ ...task, output: result.output }, path);
    if (/\.(png|jpe?g|webp)$/i.test(file.name)) {
      const metadata = await sharp(file.bytes, { limitInputPixels: 20000000 }).metadata();
      if (!["png", "jpeg", "webp"].includes(metadata.format || "") || (metadata.pages || 1) > 1) throw new Error("ต้องเป็นภาพ PNG/JPEG/WebP แบบภาพนิ่ง");
    }
    const name = `${randomUUID()}${extname(file.name)}`;
    await writeFile(join(destination, name), file.bytes, { mode: 0o600, flag: "wx" });
    files.push({ path, name, digest: digest(file.bytes) });
  }
  if (task.stage?.kind === "design" && result.checks.every((check) => check.status === "passed") && !files.some((f) => /\.(png|jpe?g|webp)$/i.test(f.name)))
    throw new Error("ขั้นออกแบบต้องแนบภาพ PNG/JPEG/WebP ที่เปิดได้ พร้อมสเปกในผลลัพธ์");
  const repositories: Delivery["repositories"] = [];
  for (const tree of task.worktrees || []) repositories.push({ id: tree.id, fingerprint: await repositoryFingerprint(tree) });
  const prerequisites = dependencies.map((dependency) => {
    const delivery = latestDelivery(dependency);
    if (!delivery || !deliveryReady(dependency)) throw new Error("ผลงานต้นทางยังไม่พร้อมส่งต่อ");
    return { taskId: dependency.id, revision: delivery.revision, fingerprint: delivery.fingerprint };
  });
  const value = { revision, createdAt: new Date().toISOString(), output: result.output, files, repositories, prerequisites, checks: result.checks, ...(result.incomplete ? { incomplete: result.incomplete } : {}) };
  return { ...value, fingerprint: digest(JSON.stringify(value)) };
}

export async function assertDeliveryCurrent(dir: string, task: Task) {
  const delivery = latestDelivery(task);
  if (!delivery) throw new Error("ยังไม่มีผลงานฉบับที่ตรวจได้");
  for (const file of delivery.files) {
    const bytes = await readFile(join(dir, "deliveries", task.id, String(delivery.revision), file.name));
    if (digest(bytes) !== file.digest) throw new Error("ไฟล์ฉบับตรวจรับเปลี่ยนหรือหาย กรุณาตรวจใหม่");
  }
  for (const tree of task.worktrees || []) {
    // A successful merge commits the exact accepted contents; its recorded identity remains authoritative.
    if (!tree.mergedAt && delivery.repositories.find((r) => r.id === tree.id)?.fingerprint !== await repositoryFingerprint(tree))
      throw new Error("โค้ดเปลี่ยนหลังส่งตรวจ กรุณาส่งตรวจและรับงานใหม่");
  }
}

export async function readDeliveryFile(dir: string, task: Task, revision: number, path: string) {
  const delivery = task.deliveries?.find((d) => d.revision === revision);
  const file = delivery?.files.find((f) => f.path === path);
  if (!file) throw new Error("ไม่พบไฟล์ผลงานเวอร์ชันนี้");
  const result = await readTaskFile({ ...task, workspace: join(dir, "deliveries", task.id, String(revision)), output: `[file](${file.name})` }, file.name);
  if (digest(result.bytes) !== file.digest) throw new Error("ไฟล์ผลงานเปลี่ยนหรือเสียหาย");
  return { ...result, name: basename(path) };
}

export async function prepareReviewWorkspace(dir: string, task: Task, sources: Task[]) {
  const revision = (latestDelivery(task)?.revision || 0) + 1;
  const workspace = join(dir, "reviews", task.id, `${revision}-${randomUUID()}`);
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  const repositories = [], artifacts = [];
  for (const source of sources) {
    await assertDeliveryCurrent(dir, source);
    for (const file of latestDelivery(source)!.files) {
      const target = join(workspace, "artifacts", source.id, file.name);
      await mkdir(join(target, ".."), { recursive: true, mode: 0o700 });
      await cp(join(dir, "deliveries", source.id, String(latestDelivery(source)!.revision), file.name), target, { errorOnExist: true, force: false });
      artifacts.push({ taskId: source.id, revision: latestDelivery(source)!.revision, originalPath: file.path, path: target });
    }
    for (const tree of source.worktrees || []) {
      const target = join(workspace, tree.id);
      await mkdir(target, { recursive: true, mode: 0o700 });
      for (const file of await repositoryFiles(tree.workspace)) {
        if (privateRepositoryPath(file) || file.split("/").some((name) => [".git", "node_modules", ".next", ".data"].includes(name))) continue;
        const path = join(tree.workspace, file);
        const info = await lstat(path).catch((error) => { if (error.code === "ENOENT") return undefined; throw error; });
        if (!info?.isFile()) continue;
        const copy = join(target, file);
        await mkdir(join(copy, ".."), { recursive: true, mode: 0o700 });
        await cp(path, copy, { errorOnExist: true, force: false });
      }
      repositories.push({ ...tree, taskId: source.id, revision: latestDelivery(source)!.revision, workspace: target });
    }
    await assertDeliveryCurrent(dir, source);
  }
  await writeFile(join(workspace, "handoff.json"), JSON.stringify({ repositories, artifacts }, null, 2), { mode: 0o600, flag: "wx" });
  const baseline: { path: string; digest: string }[] = [];
  const visit = async (path: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) baseline.push({ path: relative(workspace, file), digest: digest(await readFile(file)) });
    }
  };
  await visit(workspace);
  await mkdir(join(dir, "review-baselines", task.id), { recursive: true, mode: 0o700 });
  await writeFile(join(dir, "review-baselines", task.id, `${basename(workspace)}.json`), JSON.stringify(baseline), { mode: 0o600, flag: "wx" });
  return { workspace, repositories, artifacts };
}

export async function assertReviewUnchanged(dir: string, task: Task) {
  if (!task.reviewWorkspace) return;
  const baseline: { path: string; digest: string }[] = JSON.parse(await readFile(join(dir, "review-baselines", task.id, `${basename(task.reviewWorkspace)}.json`), "utf8"));
  for (const file of baseline) {
    const path = join(task.reviewWorkspace, file.path);
    if (!(await lstat(path)).isFile() || digest(await readFile(path)) !== file.digest)
      throw new Error("ผู้ตรวจแก้ไฟล์ต้นฉบับในชุดทดสอบ ต้องตรวจใหม่จากโค้ดที่ส่งมอบ");
  }
}
