import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { GoogleConnection, encodeSubject } from "../server/google";

test("Google OAuth uses PKCE, a loopback redirect and state without exposing the client secret", async () => {
  const dir = mkdtempSync(join(tmpdir(), "office-google-"));
  const store = new Store(dir);
  try {
    const connection = new GoogleConnection(store, "http://127.0.0.1:3210");
    connection.configure(
      "test.apps.googleusercontent.com",
      "not-a-real-secret",
    );
    const url = new URL(await connection.authorizationUrl());
    assert.equal(
      url.searchParams.get("redirect_uri"),
      "http://127.0.0.1:3210/api/google/callback",
    );
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("code_challenge"));
    assert.ok(url.searchParams.get("state"));
    assert.ok(!url.toString().includes("not-a-real-secret"));
    assert.ok(
      !JSON.stringify(connection.status()).includes("not-a-real-secret"),
    );
    await assert.rejects(
      connection.callback("invalid", "wrong-state"),
      /state/,
    );
    assert.equal(connection.status().connected, false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("long Thai email subjects preserve Unicode and fold within MIME encoded-word limits", () => {
  const input = "สรุปการประชุมทีมและแผนงาน 🏡 ".repeat(15);
  const words = encodeSubject(input).split("\r\n ");
  assert.ok(words.every((word) => word.length <= 75));
  const decoded = words
    .map((word) => Buffer.from(word.slice(10, -2), "base64").toString("utf8"))
    .join("");
  assert.equal(decoded, input);
});
