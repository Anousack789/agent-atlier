import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { relocatePaths } from "../scripts/relocate-data";
import type { Task } from "../shared/types";

test("relocation updates only project/task paths inside the old root and is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "atelier-relocate-"));
  const store = new Store(dir);
  const from = join(dir, "old");
  const to = join(dir, "new");
  const paths = [from, join(from, ".data/workspace"), join(dir, "outside"), from + "-other"];
  try {
    paths.forEach((path, i) => {
      store.put("projects", { id: String(i), name: from, path });
      store.put("tasks", { id: String(i), workspace: path, prompt: from } as Task);
    });
    store.put("tasks", { id: "no-workspace", prompt: from } as Task);
    const expected = [to, join(to, ".data/workspace"), paths[2], paths[3]];
    assert.equal(relocatePaths(store, from, to), 4);
    assert.deepEqual(store.list("projects").map((p) => p.path), expected);
    assert.deepEqual(store.list("tasks").map((t) => t.workspace), [...expected, undefined]);
    assert.ok(store.list("projects").every((p) => p.name === from));
    assert.ok(store.list("tasks").every((t) => t.prompt === from));
    assert.equal(relocatePaths(store, from, to), 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
