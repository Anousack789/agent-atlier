import type { Schedule } from "../shared/types";

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

export function nextRun(
  schedule: Pick<
    Schedule,
    "frequency" | "time" | "date" | "weekday" | "timezone"
  >,
  after = new Date(),
): string | null {
  // Scan real minutes so timezone offsets and daylight-saving gaps cannot create invalid timestamps.
  const start = Math.floor(after.getTime() / 60000) * 60000 + 60000;
  const current = localParts(after, schedule.timezone);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: schedule.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let t = start; t <= start + 8 * 86400000; t += 60000) {
    const parts = Object.fromEntries(
      formatter.formatToParts(t).map((p) => [p.type, p.value]),
    );
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    if (`${parts.hour}:${parts.minute}` !== schedule.time) continue;
    if (
      schedule.frequency !== "once" &&
      date === current.date &&
      current.time >= schedule.time
    )
      continue;
    if (schedule.frequency === "once" && date !== schedule.date) continue;
    if (
      schedule.frequency === "weekly" &&
      new Date(`${date}T12:00:00Z`).getUTCDay() !== schedule.weekday
    )
      continue;
    return new Date(t).toISOString();
  }
  if (
    schedule.frequency === "once" &&
    schedule.date > localParts(after, schedule.timezone).date
  ) {
    const anchor = new Date(`${schedule.date}T00:00:00Z`).getTime() - 86400000;
    return nextRun(schedule, new Date(anchor));
  }
  return null;
}

export function scheduleDue(schedule: Schedule, now: Date) {
  return (
    schedule.enabled &&
    schedule.nextRun !== null &&
    Date.parse(schedule.nextRun) <= now.getTime()
  );
}
