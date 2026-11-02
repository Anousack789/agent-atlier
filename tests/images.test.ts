import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { crc32 } from "node:zlib";
import sharp from "sharp";
import { Images } from "../server/images";
import { Store } from "../server/store";
import { OfficeRuntime } from "../server/runtime";
import { messageInput } from "../shared/validation";
import { maxImageBytes, type ImageUpload } from "../shared/images";
import type { Task } from "../shared/types";

async function upload(
  format: "png" | "jpeg" | "webp" = "png",
): Promise<ImageUpload> {
  const bytes = await sharp({
    create: { width: 12, height: 8, channels: 3, background: "red" },
  })
    .toFormat(format)
    .toBuffer();
  return {
    name: `test.${format}`,
    mime: `image/${format}`,
    base64: bytes.toString("base64"),
  };
}
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "atelier-images-"));
  const store = new Store(dir);
  const runtime = new OfficeRuntime(store, "http://127.0.0.1:3210");
  return {
    dir,
    store,
    runtime,
    async close() {
      await runtime.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const base = { projectId: "default", channel: "team", body: "" };
const waitUntil = async (check: () => boolean) => {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail("runtime did not settle");
};

test("message validation accepts text or up to four images, rejects empty and oversized inputs", async () => {
  const image = await upload();
  assert.equal(
    messageInput.safeParse({ ...base, body: "hello" }).success,
    true,
  );
  assert.equal(
    messageInput.safeParse({ ...base, images: [image] }).success,
    true,
  );
  assert.equal(messageInput.safeParse(base).success, false);
  assert.equal(
    messageInput.safeParse({ ...base, images: Array(4).fill(image) }).success,
    true,
  );
  assert.equal(
    messageInput.safeParse({ ...base, images: Array(5).fill(image) }).success,
    false,
  );
  for (const invalid of [
    { ...image, mime: "image/svg+xml" },
    { ...image, base64: "a".repeat(Math.ceil(maxImageBytes / 3) * 4 + 1) },
    { ...image, name: "x".repeat(201) },
    { ...image, path: "/etc/passwd" },
  ])
    assert.equal(
      messageInput.safeParse({ ...base, images: [invalid] }).success,
      false,
    );
});

test("images are decoded, normalized, private, durable and cleaned only when unreferenced", async () => {
  const f = setup();
  try {
    for (const format of ["png", "jpeg", "webp"] as const) {
      const message = await f.runtime.sendMessage({
        ...base,
        images: [await upload(format)],
      });
      assert.ok(message && "images" in message && message.images?.length);
      const image = message.images[0];
      assert.equal(image.width, 12);
      assert.equal(image.height, 8);
      assert.equal(statSync(f.runtime.images.path(image)).mode & 0o777, 0o600);
      assert.equal(statSync(f.runtime.images.dir).mode & 0o777, 0o700);
      assert.equal(
        (await sharp(await f.runtime.images.read(image)).metadata()).format,
        format,
      );
    }
    assert.equal(
      f.store.list("tasks").length,
      0,
      "team room without recipient does not call model",
    );
    const reopened = new Store(f.dir);
    assert.equal(reopened.list("messages").length, 3);
    reopened.close();
    const snapshot = JSON.stringify(f.runtime.snapshot());
    assert.ok(
      !snapshot.includes("base64") && !snapshot.includes(f.runtime.images.dir),
    );
    const orphan = await f.runtime.images.save(await upload());
    writeFileSync(join(f.runtime.images.dir, "user-file.txt"), "keep");
    new Images(f.dir, f.store.list("messages"));
    assert.throws(() => readFileSync(f.runtime.images.path(orphan)), /ENOENT/);
    assert.equal(readdirSync(f.runtime.images.dir).length, 4);
    assert.equal(
      readFileSync(join(f.runtime.images.dir, "user-file.txt"), "utf8"),
      "keep",
    );
    const first = f.store.list("messages")[0].images![0];
    await unlink(f.runtime.images.path(first));
    symlinkSync(
      join(f.runtime.images.dir, "user-file.txt"),
      f.runtime.images.path(first),
    );
    await assert.rejects(() => f.runtime.images.read(first));
    assert.throws(() =>
      f.runtime.images.path({ ...first, id: "../../office.sqlite" }),
    );
  } finally {
    await f.close();
  }
});

test("rejects MIME spoofing, corrupt, animated and excessive-pixel images; rolls back files and message/task", async () => {
  const f = setup();
  try {
    const image = await upload();
    const oversized = await sharp({
      create: { width: 5000, height: 4001, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const png = Buffer.from(image.base64, "base64");
    const control = Buffer.alloc(20);
    control.writeUInt32BE(8, 0);
    control.write("acTL", 4);
    control.writeUInt32BE(2, 8);
    control.writeUInt32BE(crc32(control.subarray(4, 16)), 16);
    const apng = Buffer.concat([
      png.subarray(0, 33),
      control,
      png.subarray(33),
    ]);
    const frames = Buffer.concat([
      Buffer.alloc(12 * 8 * 3, 0),
      Buffer.alloc(12 * 8 * 3, 255),
    ]);
    const animated = await sharp(frames, {
      raw: { width: 12, height: 16, channels: 3, pageHeight: 8 },
    })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    assert.equal(
      (await sharp(animated, { animated: true }).metadata()).pages,
      2,
    );
    for (const invalid of [
      { ...image, mime: "image/jpeg" as const },
      { ...image, base64: "YWJj" },
      { ...image, base64: "!!!!" },
      { ...image, base64: oversized.toString("base64") },
      { ...image, base64: apng.toString("base64") },
      {
        ...image,
        mime: "image/webp" as const,
        base64: animated.toString("base64"),
      },
      { ...image, base64: Buffer.alloc(maxImageBytes + 1).toString("base64") },
    ])
      await assert.rejects(() =>
        f.runtime.sendMessage({
          ...base,
          channel: "atlas",
          images: [image, invalid],
        }),
      );
    assert.equal(f.store.list("messages").length, 0);
    assert.equal(f.store.list("tasks").length, 0);
    assert.deepEqual(readdirSync(f.runtime.images.dir), []);
    const put = f.store.put.bind(f.store);
    f.store.put = ((kind: string, value: any) => {
      if (kind === "tasks") throw new Error("simulated database failure");
      return put(kind as any, value);
    }) as typeof f.store.put;
    await assert.rejects(
      () =>
        f.runtime.sendMessage({ ...base, channel: "atlas", images: [image] }),
      /database failure/,
    );
    assert.equal(f.store.list("messages").length, 0);
    assert.deepEqual(readdirSync(f.runtime.images.dir), []);
  } finally {
    await f.close();
  }
});

test("normalization applies EXIF orientation and strips metadata", async () => {
  const f = setup();
  try {
    const bytes = await sharp({
      create: { width: 12, height: 8, channels: 3, background: "blue" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const image = await f.runtime.images.save({
      name: "rotated.jpg",
      mime: "image/jpeg",
      base64: bytes.toString("base64"),
    });
    assert.equal(image.width, 8);
    assert.equal(image.height, 12);
    const metadata = await sharp(await f.runtime.images.read(image)).metadata();
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.orientation, undefined);
  } finally {
    await f.close();
  }
});

test("Codex receives source images outside recent history, caps followups, and isolates projects and private chats", async () => {
  const f = setup();
  try {
    f.runtime.paused = true;
    const calls: { method: string; params: any }[] = [];
    f.runtime.codex.request = async (method, params): Promise<any> => {
      calls.push({ method, params });
      return method === "thread/start"
        ? { thread: { id: randomUUID() } }
        : { turn: { id: randomUUID() } };
    };
    const image = await upload();
    const sourceTask = (await f.runtime.sendMessage({
      ...base,
      channel: "atlas",
      images: [image],
    })) as Task;
    assert.equal(sourceTask.prompt, "ช่วยอธิบายภาพที่แนบมา");
    const source = f.store.get("messages", sourceTask.sourceMessageId!)!;
    for (let i = 0; i < 18; i++)
      await f.runtime.sendMessage({ ...base, body: `message ${i}` });
    const team = await f.runtime.sendMessage({
      ...base,
      images: Array(4).fill(image),
    });
    const hidden = (await f.runtime.sendMessage({
      ...base,
      channel: "nova",
      body: "PRIVATE",
      images: [image],
    })) as Task;
    f.store.put("tasks", { ...hidden, status: "cancelled" });
    f.store.put("projects", { id: "other", name: "Other", path: f.dir });
    await f.runtime.sendMessage({
      ...base,
      projectId: "other",
      images: [image],
    });
    f.runtime.connection = { state: "ready" };
    f.runtime.paused = false;
    f.runtime.tick();
    await waitUntil(() => calls.some((c) => c.method === "turn/start"));
    const input = calls.find((c) => c.method === "turn/start")!.params.input;
    const paths = input
      .filter((i: any) => i.type === "localImage")
      .map((i: any) => i.path);
    assert.equal(paths.length, 4);
    assert.equal(paths[0], f.runtime.images.path(source.images![0]));
    assert.ok(!JSON.stringify(input).includes("PRIVATE"));
    const permitted = new Set(
      [source, ...(team && "images" in team ? [team] : [])].flatMap((m) =>
        m.images!.map((i) => f.runtime.images.path(i)),
      ),
    );
    assert.ok(paths.every((p: string) => permitted.has(p)));
    f.runtime.codex.onNotification("turn/completed", {
      threadId: f.store.get("tasks", sourceTask.id)!.threadId,
      turn: { status: "completed" },
    });
    await f.runtime.sendMessage({
      ...base,
      channel: "atlas",
      body: "ถามต่อเกี่ยวกับรูป",
    });
    await waitUntil(
      () => calls.filter((c) => c.method === "turn/start").length === 2,
    );
    const followup = calls.filter((c) => c.method === "turn/start")[1].params
      .input;
    assert.equal(
      followup.filter((i: any) => i.type === "localImage").length,
      4,
    );
    const final = f.store.list("tasks").at(-1)!;
    f.runtime.codex.onNotification("turn/completed", {
      threadId: f.store.get("tasks", final.id)!.threadId,
      turn: { status: "completed" },
    });
    await unlink(
      f.runtime.images.path(
        team && "images" in team ? team.images![0] : source.images![0],
      ),
    );
    const missing = (await f.runtime.sendMessage({
      ...base,
      channel: "atlas",
      body: "ภาพหาย",
    })) as Task;
    await waitUntil(
      () => f.store.get("tasks", missing.id)?.status === "failed",
    );
    assert.match(f.store.get("tasks", missing.id)!.error!, /อ่านรูป/);
    assert.equal(calls.filter((c) => c.method === "turn/start").length, 2);
  } finally {
    await f.close();
  }
});

test("model image rejection is visible and never retried without images", async () => {
  const f = setup();
  try {
    let turns = 0;
    f.runtime.codex.request = async (method, params): Promise<any> => {
      if (method === "thread/start") return { thread: { id: randomUUID() } };
      if (method === "turn/start") {
        turns++;
        assert.equal(
          (params.input as any[]).filter((item) => item.type === "localImage")
            .length,
          1,
        );
        throw new Error("model does not support image input");
      }
      return {};
    };
    f.runtime.connection = { state: "ready" };
    const task = (await f.runtime.sendMessage({
      ...base,
      channel: "atlas",
      images: [await upload()],
    })) as Task;
    await waitUntil(() => f.store.get("tasks", task.id)?.status === "failed");
    assert.equal(turns, 1);
    assert.match(
      f.store.get("tasks", task.id)!.error!,
      /does not support image/,
    );
    assert.ok(
      f.store
        .list("messages")
        .some(
          (m) =>
            m.from === "system" && m.body.includes("does not support image"),
        ),
    );
    const source = f.store.get("messages", task.sourceMessageId!)!;
    assert.ok((await f.runtime.images.read(source.images![0])).length);
  } finally {
    await f.close();
  }
});
