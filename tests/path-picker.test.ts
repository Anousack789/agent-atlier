import { test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import os from "node:os";
import { choosePath } from "../server/path-picker";

type Callback = (error: Error | null, stdout: string, stderr: string) => void;

test("folder selection uses a fixed native script and preserves spaces and Unicode in the chosen path", async (t) => {
  t.mock.method(os, "platform", () => "darwin");
  const run = t.mock.method(childProcess, "execFile", (...args: unknown[]) => {
    const callback = args.at(-1) as Callback;
    callback(null, "/tmp/โปรเจกต์ 'web'/\n", "");
  });
  assert.deepEqual(await choosePath(), { path: "/tmp/โปรเจกต์ 'web'/" });
  const [file, args, options] = run.mock.calls[0].arguments;
  assert.equal(file, "/usr/bin/osascript");
  assert.equal((args as string[])[0], "-e");
  assert.match((args as string[])[1], /choose folder/);
  assert.match((args as string[])[1], /on error number -128/);
  assert.ok(!(args as string[])[1].includes("โปรเจกต์ 'web'"));
  assert.equal((options as { encoding: string }).encoding, "utf8");
});

test("native cancellation returns null without an error", async (t) => {
  t.mock.method(os, "platform", () => "darwin");
  t.mock.method(childProcess, "execFile", (...args: unknown[]) => (args.at(-1) as Callback)(null, "\n", ""));
  assert.deepEqual(await choosePath(), { path: null });
});

test("only one picker runs at a time and cancellation releases the lock", async (t) => {
  t.mock.method(os, "platform", () => "darwin");
  let complete!: Callback;
  const run = t.mock.method(childProcess, "execFile", (...args: unknown[]) => { complete = args.at(-1) as Callback; });
  const first = choosePath();
  await assert.rejects(choosePath(), /เปิดอยู่/);
  assert.equal(run.mock.callCount(), 1);
  complete(null, "\n", "");
  await first;
  const next = choosePath();
  complete(null, "/tmp/next/\n", "");
  assert.deepEqual(await next, { path: "/tmp/next/" });
});

test("native failures and invalid output report a useful error and release the lock", async (t) => {
  t.mock.method(os, "platform", () => "darwin");
  let attempts = 0;
  t.mock.method(childProcess, "execFile", (...args: unknown[]) => {
    const callback = args.at(-1) as Callback;
    attempts++;
    if (attempts === 1) callback(new Error("native failure"), "", "");
    else callback(null, attempts === 2 ? "relative-path\n" : "/tmp/recovered/\n", "");
  });
  await assert.rejects(choosePath(), /พิมพ์ path เอง/);
  await assert.rejects(choosePath(), /พิมพ์ path เอง/);
  assert.deepEqual(await choosePath(), { path: "/tmp/recovered/" });
});

test("unsupported systems retain manual path entry and never launch a process", async (t) => {
  t.mock.method(os, "platform", () => "linux");
  const run = t.mock.method(childProcess, "execFile", () => { throw new Error("must not run"); });
  await assert.rejects(choosePath(), /เฉพาะ macOS.*พิมพ์ path เอง/);
  assert.equal(run.mock.callCount(), 0);
});
