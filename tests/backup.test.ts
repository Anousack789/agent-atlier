import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { OfficeRuntime } from "../server/runtime";
import { Store } from "../server/store";
import { parseBackup, serializeBackup } from "../server/backup";
import { backupKinds, maxBackupBytes, type OfficeBackup } from "../shared/backup";
import type { Approval, Task } from "../shared/types";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "atelier-backup-"));
  const store = new Store(dir);
  const runtime = new OfficeRuntime(store, "http://127.0.0.1:3210");
  return { dir, store, runtime, async close() {
    await runtime.close(); rmSync(dir, { recursive: true, force: true });
  } };
}
async function fixture(f: ReturnType<typeof setup>) {
  const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: "red" } }).png().toBuffer();
  await f.runtime.sendMessage({ projectId: "default", channel: "team", body: "ข้อความส่วนตัว", images: [
    { name: "test.png", mime: "image/png", base64: bytes.toString("base64") },
  ] });
  const timestamp = new Date().toISOString();
  f.store.put("agents", { ...f.store.get("agents", "atlas")!, googleAccess: true,
    avatarParts: { hairStyle: "curly", skinTone: "tan", glasses: true } });
  f.store.put("memories", { id: "memory", projectId: "default", agentId: "atlas", text: "private", updatedAt: timestamp });
  f.store.put("schedules", { id: "schedule", name: "Daily", projectId: "default", agentId: "atlas", prompt: "test",
    kind: "general", frequency: "daily", time: "10:00", date: "2026-11-02", weekday: 1,
    timezone: "Asia/Vientiane", enabled: true, nextRun: "2000-01-01T00:00:00Z" });
  const task: Task = { id: "task", projectId: "default", agentId: "atlas", title: "Test", prompt: "test", kind: "code",
    status: "completed", output: "done", rootId: "task", round: 0, channel: "team", activity: "done",
    createdAt: timestamp, updatedAt: timestamp, threadId: "old-thread", turnId: "old-turn", workspace: "/do-not-touch",
    branch: "old-branch", baseBranch: "main", baseCommit: "abc", sourceMessageId: f.store.list("messages")[0].id };
  f.store.put("tasks", task);
  const approval: Approval = { id: "approval", type: "external", status: "unknown", title: "send", details: "check first",
    projectId: "default", agentId: "atlas", taskId: "task", payload: { body: "test", accountEmail: "a@example.com" },
    createdAt: timestamp };
  f.store.put("approvals", approval);
  return JSON.parse(await f.runtime.backups.export()) as OfficeBackup;
}

test("backup round trip includes every data category and images but excludes credentials", async () => {
  const source = setup(), target = setup();
  let reopened: OfficeRuntime | undefined;
  try {
    source.store.put("settings", { id: "settings", googleClientId: "source-id", googleClientSecret: "source-secret" });
    writeFileSync(join(source.dir, "google-tokens.json"), '{"refresh_token":"source-token"}');
    const backup = await fixture(source);
    const json = JSON.stringify(backup);
    for (const secret of ["source-secret", "source-token", "source-id", "settings"]) assert.ok(!json.includes(secret));
    assert.deepEqual(parseBackup(backup), backup);
    target.store.put("settings", { id: "settings", googleClientId: "target-id", googleClientSecret: "target-secret" });
    writeFileSync(join(target.dir, "google-tokens.json"), "target-token-file");
    const preview = await target.runtime.backups.inspect(backup);
    assert.equal(preview.counts.messages, 1); assert.equal(preview.imageCount, 1);
    const result = await target.runtime.backups.restore(backup, preview.token);
    assert.deepEqual(parseBackup(JSON.parse(readFileSync(result.backupPath, "utf8"))).data.agents.length, 4);
    assert.equal(statSync(result.backupPath).mode & 0o777, 0o600);
    assert.equal(statSync(join(target.dir, "backups")).mode & 0o777, 0o700);
    for (const kind of backupKinds) assert.equal(target.store.list(kind).length, backup.data[kind].length);
    assert.deepEqual(target.store.get("layout", "office"), backup.data.layout);
    assert.deepEqual(target.store.get("agents", "atlas")?.avatarParts, backup.data.agents[0].avatarParts);
    assert.equal(target.store.get("agents", "atlas")?.googleAccess, false);
    assert.equal(target.store.get("settings", "settings")?.googleClientSecret, "target-secret");
    assert.equal(readFileSync(join(target.dir, "google-tokens.json"), "utf8"), "target-token-file");
    assert.equal(target.store.get("schedules", "schedule")?.enabled, false);
    assert.equal(target.store.get("approvals", "approval")?.status, "unknown");
    const task = target.store.get("tasks", "task")!;
    for (const field of ["workspace", "branch", "baseBranch", "baseCommit", "threadId", "turnId"])
      assert.equal(Object.hasOwn(task, field), false);
    await assert.rejects(() => target.runtime.merge("task"), /ไม่มี branch/);
    const image = target.store.list("messages")[0].images![0];
    assert.notEqual(image.id, backup.images[0].id);
    assert.deepEqual(await target.runtime.images.read(image), Buffer.from(backup.images[0].base64, "base64"));
    assert.equal(target.runtime.paused, true);
    await target.runtime.close();
    reopened = new OfficeRuntime(new Store(target.dir), "http://127.0.0.1:3210");
    assert.equal(reopened.paused, true);
    reopened.google.configure("another.apps.googleusercontent.com", "another-secret");
    assert.equal(reopened.store.get("settings", "settings")?.paused, true);
    reopened.tick(new Date("2030-01-01T00:00:00Z"));
    assert.equal(reopened.store.list("tasks").length, 1);
    assert.ok((await reopened.images.read(image)).length);
    reopened.setPaused(false);
    assert.equal(reopened.store.get("settings", "settings")?.paused, false);
  } finally {
    await source.close();
    if (reopened) { await reopened.close(); rmSync(target.dir, { recursive: true, force: true }); }
    else await target.close();
  }
});

test("restore interrupts unfinished tasks, expires pending approvals, and preserves unknown external outcomes", async () => {
  const f = setup();
  try {
    const backup = await fixture(f);
    backup.data.tasks[0].status = "queued";
    backup.data.approvals = ["pending", "executing", "unknown"].map((status) => ({
      ...backup.data.approvals[0], id: status, status: status as Approval["status"], rpcId: "old-rpc",
    }));
    const preview = await f.runtime.backups.inspect(backup);
    await f.runtime.backups.restore(backup, preview.token);
    assert.equal(f.store.get("tasks", "task")?.status, "interrupted");
    assert.equal(f.store.get("approvals", "pending")?.status, "expired");
    for (const key of ["executing", "unknown"]) assert.equal(f.store.get("approvals", key)?.status, "unknown");
    for (const approval of f.store.list("approvals")) {
      assert.equal(Object.hasOwn(approval, "rpcId"), false);
      await assert.rejects(() => f.runtime.decide({ id: approval.id, approve: true }), /จัดการแล้ว/);
    }
    f.runtime.tick(new Date("2030-01-01T00:00:00Z"));
    assert.equal(f.store.list("tasks").length, 1);
  } finally { await f.close(); }
});

test("backup validation rejects malformed versions, records, references, layout, and images without writes", async () => {
  const f = setup();
  try {
    const backup = await fixture(f);
    const before = JSON.stringify(f.runtime.snapshot());
    const invalid: ((b: any) => void)[] = [
      (b) => { b.version = 2; }, (b) => { delete b.data.memories; },
      (b) => { b.data.settings = { googleClientSecret: "no" }; },
      (b) => { b.data.agents.push(b.data.agents[0]); },
      (b) => { b.data.tasks[0].agentId = "missing"; }, (b) => { b.data.tasks[0].rootId = "missing"; },
      (b) => { b.data.memories[0].projectId = "missing"; },
      (b) => { b.data.messages[0].from = "missing"; },
      (b) => { b.data.agents[0].seat = b.data.agents[1].seat; },
      (b) => { b.data.layout.furniture[0].x = 99; },
      (b) => { b.images = []; }, (b) => { b.images.push(b.images[0]); },
      (b) => { b.images[0].id = "../../file"; }, (b) => { b.images[0].base64 = "!!!!"; },
      (b) => { b.data.messages[0].images[0].mime = "image/jpeg"; },
      (b) => { b.data.messages[0].images[0].width = 999; },
      (b) => { b.data.projects[0].path = "relative/path"; },
    ];
    for (const change of invalid) {
      const copy = structuredClone(backup); change(copy);
      await assert.rejects(() => f.runtime.backups.inspect(copy));
      assert.equal(JSON.stringify(f.runtime.snapshot()), before);
    }
    assert.throws(() => serializeBackup({ ...backup, images: [], data: { ...backup.data,
      tasks: [{ ...backup.data.tasks[0], output: "x".repeat(maxBackupBytes) }] } }), /100 MiB/);
    assert.equal(readdirSync(f.dir).includes("backups"), false);
  } finally { await f.close(); }
});

test("preview reports missing project folders and binds a single-use token to the exact file", async () => {
  const f = setup();
  try {
    const backup = await fixture(f);
    backup.data.projects[0].path = join(f.dir, "missing");
    let preview = await f.runtime.backups.inspect(backup);
    assert.deepEqual(preview.missingPaths, [{ name: backup.data.projects[0].name, path: backup.data.projects[0].path }]);
    const changed = structuredClone(backup); changed.data.agents[0].name = "different";
    await assert.rejects(() => f.runtime.backups.restore(changed, preview.token), /ตรวจไฟล์สำรองใหม่/);
    await assert.rejects(() => f.runtime.backups.restore(backup, preview.token), /ตรวจไฟล์สำรองใหม่/);
    preview = await f.runtime.backups.inspect(backup);
    await f.runtime.backups.restore(backup, preview.token);
    await assert.rejects(() => f.runtime.backups.restore(backup, preview.token), /ตรวจไฟล์สำรองใหม่/);
    assert.equal(readdirSync(join(f.dir, "backups")).length, 1);
  } finally { await f.close(); }
});

test("backup lock blocks mutations, repeated import, and scheduler; in-flight mutations block export", async () => {
  const f = setup();
  try {
    const backup = await fixture(f);
    const preview = await f.runtime.backups.inspect(backup);
    const restore = f.runtime.backups.restore(backup, preview.token);
    await assert.rejects(() => f.runtime.backups.restore(backup, preview.token), /รอให้งาน/);
    await assert.rejects(() => f.runtime.withMutation(() => f.runtime.saveMemory({
      projectId: "default", agentId: null, text: "must not save",
    })), /กำลังสำรอง/);
    f.runtime.tick(new Date("2030-01-01T00:00:00Z"));
    assert.equal(f.store.list("tasks").length, 1);
    await restore;
    let finish!: () => void;
    const mutation = f.runtime.withMutation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await assert.rejects(() => f.runtime.backups.export(), /รอให้งาน/);
    finish(); await mutation;
    for (const status of ["queued", "running", "waiting"] as const) {
      f.store.put("tasks", { ...f.store.get("tasks", "task")!, status });
      await assert.rejects(() => f.runtime.backups.export(), /รอให้งาน/);
    }
    f.store.put("tasks", { ...f.store.get("tasks", "task")!, status: "completed" });
    f.store.put("approvals", { ...f.store.get("approvals", "approval")!, status: "executing" });
    await assert.rejects(() => f.runtime.backups.export(), /รอให้งาน/);
  } finally { await f.close(); }
});

test("failed image writes or database replacement preserve current office and original attachments", async () => {
  const f = setup();
  try {
    const backup = await fixture(f);
    const original = serializeBackup(JSON.parse(await f.runtime.backups.export()));
    const files = readdirSync(f.runtime.images.dir);
    const save = f.runtime.images.save.bind(f.runtime.images);
    const put = f.store.put.bind(f.store);
    for (const failure of ["image", "database"] as const) {
      const preview = await f.runtime.backups.inspect(backup);
      if (failure === "image") f.runtime.images.save = async () => { throw new Error("image write failed"); };
      else f.store.put = ((kind: any, value: any) => {
        if (kind === "memories") throw new Error("database write failed");
        return put(kind, value);
      }) as typeof f.store.put;
      await assert.rejects(() => f.runtime.backups.restore(backup, preview.token), /write failed/);
      f.runtime.images.save = save; f.store.put = put;
      const current = JSON.parse(await f.runtime.backups.export());
      const previous = JSON.parse(original); current.exportedAt = previous.exportedAt;
      assert.deepEqual(current, previous);
      assert.deepEqual(readdirSync(f.runtime.images.dir), files);
      assert.equal(f.runtime.paused, false);
    }
  } finally { await f.close(); }
});

test("failure to create the safety backup prevents any replacement", async () => {
  const f = setup();
  try {
    const backup = await fixture(f);
    const preview = await f.runtime.backups.inspect(backup);
    const original = JSON.stringify(f.store.list("agents"));
    writeFileSync(join(f.dir, "backups"), "not a directory");
    await assert.rejects(() => f.runtime.backups.restore(backup, preview.token));
    assert.equal(JSON.stringify(f.store.list("agents")), original);
    assert.equal(f.runtime.paused, false);
  } finally { await f.close(); }
});
