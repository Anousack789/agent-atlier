import { test } from "node:test";
import assert from "node:assert/strict";
import { nextRun } from "../server/scheduler";
const daily = {
  frequency: "daily" as const,
  time: "09:00",
  date: "2026-11-02",
  weekday: 1,
  timezone: "Asia/Vientiane",
};
test("daily/weekly schedules use the configured timezone", () => {
  assert.equal(
    nextRun(daily, new Date("2026-11-02T01:00:00Z")),
    "2026-11-02T02:00:00.000Z",
  );
  assert.equal(
    nextRun(daily, new Date("2026-11-02T03:00:00Z")),
    "2026-11-03T02:00:00.000Z",
  );
  assert.equal(
    nextRun(
      { ...daily, frequency: "weekly", weekday: 3 },
      new Date("2026-11-02T03:00:00Z"),
    ),
    "2026-11-04T02:00:00.000Z",
  );
});
test("one-off supports future dates and does not repeat past dates", () => {
  assert.equal(
    nextRun(
      { ...daily, frequency: "once", date: "2027-02-01" },
      new Date("2026-11-02T03:00:00Z"),
    ),
    "2027-02-01T02:00:00.000Z",
  );
  assert.equal(
    nextRun({ ...daily, frequency: "once" }, new Date("2026-11-03T03:00:00Z")),
    null,
  );
});
test("DST missing hour is skipped and repeated hour does not run twice", () => {
  assert.equal(
    nextRun(
      { ...daily, timezone: "America/New_York", time: "02:30" },
      new Date("2026-03-08T05:00:00Z"),
    ),
    "2026-03-09T06:30:00.000Z",
  );
  assert.equal(
    nextRun(
      { ...daily, timezone: "America/New_York", time: "01:30" },
      new Date("2026-11-01T05:31:00Z"),
    ),
    "2026-11-02T06:30:00.000Z",
  );
});
