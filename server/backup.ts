import { createHash, randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { backupKinds, maxBackupBytes, type OfficeBackup, type BackupPreview } from "../shared/backup";
import { imageMimeTypes, maxImageBytes, maxImages, type MessageImage } from "../shared/images";
import { busyStatuses } from "../shared/types";
import * as validation from "../shared/validation";
import { canPlace, occupiedCells } from "../shared/room";
import type { OfficeRuntime } from "./runtime";

const id = z.string().min(1).max(100);
const date = z.string().datetime({ offset: true });
const imageSchema = z.object({
  id: z.string().uuid(), name: z.string().min(1).max(200), mime: z.enum(imageMimeTypes),
  size: z.number().int().positive().max(maxImageBytes),
  width: z.number().int().positive(), height: z.number().int().positive(),
}).strict();
const optionalText = z.string().optional();
const taskSchema = z.object({
  id, title: z.string(), prompt: z.string(), projectId: id, agentId: id,
  kind: z.enum(["general", "code"]),
  status: z.enum(["queued", "running", "waiting", "completed", "failed", "cancelled", "interrupted"]),
  output: z.string(), error: optionalText, threadId: optionalText, turnId: optionalText,
  workspace: optionalText, branch: optionalText, baseBranch: optionalText, baseCommit: optionalText,
  mergedAt: date.optional(), scheduleId: id.optional(), sourceMessageId: id.optional(),
  rootId: id, round: z.number().int().nonnegative(), channel: id, activity: z.string(),
  createdAt: date, updatedAt: date,
}).strict();
const backupSchema = z.object({
  format: z.literal("agent-atelier-office"), version: z.literal(1), exportedAt: date,
  data: z.object({
    agents: z.array(validation.agentInput.required({ id: true }).strict()).min(1).max(16),
    projects: z.array(validation.projectInput.required({ id: true }).extend({
      path: z.string().refine(isAbsolute, "path ต้องเป็น absolute path"),
    }).strict()).min(1),
    tasks: z.array(taskSchema),
    messages: z.array(z.object({
      id, projectId: id, channel: id, from: id, to: id.optional(), body: z.string(),
      images: z.array(imageSchema).max(maxImages).optional(), taskId: id.optional(), createdAt: date,
    }).strict()),
    memories: z.array(z.object({
      id, projectId: id, agentId: id.nullable(), text: z.string(), updatedAt: date,
    }).strict()),
    schedules: z.array(validation.scheduleInput.required({ id: true }).extend({
      nextRun: date.nullable(), lastRun: date.optional(),
    }).strict()),
    approvals: z.array(z.object({
      id, type: z.enum(["delegate", "command", "file", "external", "conversation", "input", "git_init"]),
      status: z.enum(["pending", "executing", "approved", "declined", "failed", "unknown", "expired"]),
      title: z.string(), details: z.string(), projectId: id, agentId: id, taskId: id.optional(),
      payload: z.record(z.string(), z.unknown()), rpcId: z.union([z.number(), z.string()]).optional(),
      createdAt: date, result: optionalText,
    }).strict()),
    layout: validation.layoutInput.extend({ id: z.literal("office") }).strict(),
  }).strict(),
  images: z.array(z.object({
    id: z.string().uuid(), base64: z.string().min(4).max(Math.ceil(maxImageBytes / 3) * 4),
  }).strict()),
}).strict();

export function parseBackup(input: unknown): OfficeBackup {
  const backup = backupSchema.parse(input);
  const { data } = backup;
  const sets = Object.fromEntries(backupKinds.map((kind) => {
    const ids = new Set(data[kind].map((entry) => entry.id));
    if (ids.size !== data[kind].length) throw new Error(`ID ซ้ำใน ${kind}`);
    return [kind, ids];
  })) as Record<(typeof backupKinds)[number], Set<string>>;
  const reference = (kind: keyof typeof sets, value: string) => {
    if (!sets[kind].has(value)) throw new Error(`ไม่พบ ${kind}: ${value}`);
  };
  const projects = new Map(data.tasks.map((task) => [task.id, task.projectId]));
  const messages = new Map(data.messages.map((message) => [message.id, message.projectId]));
  const taskReference = (value: string, projectId: string) => {
    reference("tasks", value);
    if (projects.get(value) !== projectId) throw new Error("งานอ้างอิงคนละโปรเจกต์");
  };
  for (const task of data.tasks) {
    reference("projects", task.projectId); reference("agents", task.agentId);
    taskReference(task.rootId, task.projectId);
    if (task.sourceMessageId) {
      reference("messages", task.sourceMessageId);
      if (messages.get(task.sourceMessageId) !== task.projectId)
        throw new Error("ข้อความอ้างอิงคนละโปรเจกต์");
    }
    // Deleted schedules can still be referenced by historical tasks.
  }
  for (const memory of data.memories) {
    reference("projects", memory.projectId);
    if (memory.agentId !== null) reference("agents", memory.agentId);
  }
  for (const schedule of data.schedules) {
    reference("projects", schedule.projectId); reference("agents", schedule.agentId);
  }
  const images = new Map<string, MessageImage>();
  for (const message of data.messages) {
    reference("projects", message.projectId);
    if (!["user", "system"].includes(message.from)) reference("agents", message.from);
    if (message.to) reference("agents", message.to);
    if (message.taskId) taskReference(message.taskId, message.projectId);
    for (const image of message.images || []) {
      if (images.has(image.id)) throw new Error("ID รูปซ้ำ");
      images.set(image.id, image);
    }
  }
  for (const approval of data.approvals) {
    reference("projects", approval.projectId);
    if (approval.agentId !== "user") reference("agents", approval.agentId);
    if (approval.taskId) taskReference(approval.taskId, approval.projectId);
  }
  const imageIds = new Set<string>();
  for (const image of backup.images) {
    const meta = images.get(image.id);
    const bytes = Buffer.from(image.base64, "base64");
    if (!meta || imageIds.has(image.id) || bytes.length !== meta.size || bytes.toString("base64") !== image.base64)
      throw new Error("ข้อมูลรูปไม่ครบ ซ้ำ หรือไม่ถูกต้อง");
    imageIds.add(image.id);
  }
  if (images.size !== imageIds.size) throw new Error("ไฟล์สำรองมีรูปไม่ครบ");
  const furniture = data.layout.furniture;
  if (furniture.some((f) => !canPlace(f, furniture))) throw new Error("ผังเฟอร์นิเจอร์ไม่ถูกต้อง");
  const occupied = new Set(furniture.flatMap(occupiedCells).map((p) => `${p.x},${p.y}`));
  for (const agent of data.agents) {
    const seat = `${agent.seat.x},${agent.seat.y}`;
    if (agent.seat.y < 3 || occupied.has(seat)) throw new Error("ที่นั่งสมาชิกซ้ำหรือทับเฟอร์นิเจอร์");
    occupied.add(seat);
  }
  return backup;
}

export function serializeBackup(backup: OfficeBackup) {
  const json = JSON.stringify(backup);
  if (Buffer.byteLength(json) > maxBackupBytes) throw new Error("ไฟล์สำรองเกิน 100 MiB");
  return json;
}

export class Backups {
  private preview?: { token: string; hash: string; expires: number };
  constructor(private runtime: OfficeRuntime) {}

  private async collect() {
    const { store, images } = this.runtime;
    const data = {
      agents: store.list("agents"), projects: store.list("projects"), tasks: store.list("tasks"),
      messages: store.list("messages"), memories: store.list("memories"),
      schedules: store.list("schedules"), approvals: store.list("approvals"), layout: store.get("layout", "office")!,
    };
    let size = Buffer.byteLength(JSON.stringify(data));
    const files: OfficeBackup["images"] = [];
    for (const message of data.messages)
      for (const image of message.images || []) {
        const base64 = (await images.read(image)).toString("base64");
        size += Buffer.byteLength(base64);
        if (size > maxBackupBytes) throw new Error("ไฟล์สำรองเกิน 100 MiB");
        files.push({ id: image.id, base64 });
      }
    return serializeBackup({ format: "agent-atelier-office", version: 1, exportedAt: new Date().toISOString(), data, images: files });
  }

  export() {
    return this.runtime.withBackupLock(() => this.collect());
  }

  inspect(input: unknown): Promise<BackupPreview> {
    return this.runtime.withBackupLock(async () => {
      const json = serializeBackup(input as OfficeBackup);
      const backup = parseBackup(input);
      await this.validateImages(backup);
      const missingPaths: BackupPreview["missingPaths"] = [];
      for (const project of backup.data.projects) {
        try { if (!(await stat(project.path)).isDirectory()) throw new Error(); }
        catch { missingPaths.push({ name: project.name, path: project.path }); }
      }
      const token = randomUUID();
      this.preview = { token, hash: createHash("sha256").update(json).digest("hex"), expires: Date.now() + 10 * 60_000 };
      return {
        token, exportedAt: backup.exportedAt, missingPaths, imageCount: backup.images.length,
        counts: Object.fromEntries(backupKinds.map((kind) => [kind, backup.data[kind].length])) as BackupPreview["counts"],
      };
    });
  }

  private async validateImages(backup: OfficeBackup) {
    const sharp = (await import("sharp")).default;
    const metadata = new Map(backup.data.messages.flatMap((m) => (m.images || []).map((i) => [i.id, i] as const)));
    for (const file of backup.images) {
      const image = metadata.get(file.id)!;
      const decoder = sharp(Buffer.from(file.base64, "base64"), { animated: true, limitInputPixels: 20_000_000, failOn: "warning" });
      const meta = await decoder.metadata();
      const format = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" }[image.mime];
      if (meta.format !== format || (meta.pages || 1) !== 1 || meta.width !== image.width || meta.height !== image.height)
        throw new Error("ชนิดหรือขนาดรูปไม่ตรงกับข้อมูลสำรอง");
      await decoder.stats();
    }
  }

  restore(input: unknown, token: string) {
    return this.runtime.withBackupLock(async () => {
      const preview = this.preview;
      this.preview = undefined;
      const json = serializeBackup(input as OfficeBackup);
      if (!preview || token !== preview.token || preview.expires < Date.now() ||
          createHash("sha256").update(json).digest("hex") !== preview.hash)
        throw new Error("กรุณาตรวจไฟล์สำรองใหม่ก่อนยืนยันนำเข้า");
      const backup = parseBackup(input);
      await this.validateImages(backup);
      const dir = join(this.runtime.store.dir, "backups");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const backupPath = join(dir, `before-import-${Date.now()}-${randomUUID()}.json`);
      await writeFile(backupPath, await this.collect(), { mode: 0o600, flag: "wx" });
      const saved: MessageImage[] = [];
      try {
        const imported = new Map<string, MessageImage>();
        const metadata = new Map(backup.data.messages.flatMap((m) => (m.images || []).map((i) => [i.id, i] as const)));
        for (const file of backup.images) {
          const image = metadata.get(file.id)!;
          const next = await this.runtime.images.save({ name: image.name, mime: image.mime, base64: file.base64 });
          saved.push(next); imported.set(file.id, next);
        }
        const { data } = backup;
        data.agents = data.agents.map((a) => ({ ...a, googleAccess: false }));
        data.messages = data.messages.map((m) => ({ ...m, ...(m.images ? { images: m.images.map((i) => imported.get(i.id)!) } : {}) }));
        data.tasks = data.tasks.map((task) => {
          const { threadId, turnId, workspace, branch, baseBranch, baseCommit, ...rest } = task;
          return busyStatuses.includes(rest.status)
            ? { ...rest, status: "interrupted", activity: "รอตรวจสอบหลังนำเข้า", error: "นำเข้าจากไฟล์สำรอง โปรดตรวจข้อมูลก่อนสร้างงานใหม่", updatedAt: new Date().toISOString() }
            : rest;
        });
        data.schedules = data.schedules.map((s) => ({ ...s, enabled: false, nextRun: null }));
        data.approvals = data.approvals.map((approval) => {
          const { rpcId, ...rest } = approval;
          if (rest.status === "executing") return { ...rest, status: "unknown", result: "นำเข้าระหว่างดำเนินการ กรุณาตรวจบริการปลายทางก่อนทำซ้ำ" };
          if (rest.status === "pending") return { ...rest, status: "expired", result: "คำขอเดิมหมดอายุหลังนำเข้า" };
          return rest;
        });
        this.runtime.store.transaction(() => {
          for (const kind of backupKinds) {
            for (const entry of this.runtime.store.list(kind)) this.runtime.store.remove(kind, entry.id);
            for (const entry of data[kind]) this.runtime.store.put(kind, entry);
          }
          this.runtime.store.put("layout", data.layout);
          const settings = this.runtime.store.get("settings", "settings");
          this.runtime.store.put("settings", { id: "settings", googleClientId: "", googleClientSecret: "", ...settings, paused: true });
        });
        this.runtime.paused = true;
        this.runtime.changed();
        return { backupPath };
      } catch (error) {
        await this.runtime.images.remove(saved);
        throw error;
      }
    });
  }
}
