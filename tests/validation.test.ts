import { test } from "node:test";
import assert from "node:assert/strict";
import { emailProposal, eventProposal } from "../server/google";
import { walkPath, canPlace, occupiedCells } from "../shared/room";
test("email headers cannot inject recipients and calendar timestamps must be ordered", () => {
  assert.equal(
    emailProposal.safeParse({
      to: ["a@example.com"],
      subject: "hello\r\nBcc: attacker@example.com",
      body: "test",
    }).success,
    false,
  );
  assert.equal(
    emailProposal.safeParse({
      to: ["a@example.com\r\nBcc:b@example.com"],
      subject: "hello",
      body: "test",
    }).success,
    false,
  );
  assert.equal(
    eventProposal.safeParse({
      summary: "meeting",
      start: "2026-11-02T10:00:00+07:00",
      end: "2026-11-02T09:00:00+07:00",
      timezone: "Asia/Vientiane",
      attendees: [],
    }).success,
    false,
  );
});
test("walking routes around furniture and unreachable positions stay still", () => {
  const furniture = [{ id: "desk", type: "desk" as const, x: 5, y: 5 }];
  const path = walkPath({ x: 3, y: 5 }, { x: 8, y: 5 }, furniture);
  const blocked = new Set(
    furniture.flatMap(occupiedCells).map((p) => `${p.x},${p.y}`),
  );
  assert.ok(path.length > 0);
  assert.deepEqual(path.at(-1), { x: 8, y: 5 });
  assert.ok(path.every((p) => !blocked.has(`${p.x},${p.y}`)));
  assert.deepEqual(walkPath({ x: 3, y: 5 }, { x: 5, y: 5 }, furniture), []);
  assert.equal(
    canPlace({ id: "other", type: "desk", x: 5, y: 5 }, furniture),
    false,
  );
});
