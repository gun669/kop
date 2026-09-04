// Small helper to compute "today" (midnight-to-midnight) as a UTC instant
// range, for a given IANA timezone — so "today's classes" means today in
// the studio's own timezone, not the server's.
export function todayRangeInTimeZone(timeZone: string, now = new Date()) {
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const offsetFmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  });

  const parts = dateFmt.formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value);
  const d = Number(parts.find((p) => p.type === "day")!.value);

  const offsetPart = offsetFmt
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")!.value; // e.g. "GMT+03:00"
  const match = offsetPart.match(/GMT([+-])(\d{2}):(\d{2})/);
  const sign = match?.[1] === "-" ? -1 : 1;
  const offsetMinutes = match
    ? sign * (Number(match[2]) * 60 + Number(match[3]))
    : 0;

  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMinutes * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export function formatTimeInZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

// 24-hour "HH:MM" in a given timezone — suitable as an <input type="time">
// defaultValue, unlike formatTimeInZone's 12-hour display string.
export function formatTimeValue(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

// The local calendar date (YYYY-MM-DD) a UTC instant falls on, in a given
// timezone. Using en-CA gets us that format directly without hand-parsing.
export function localDateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatDayLabel(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

// The UTC instant representing local midnight of the Monday on/before
// `referenceDate`, in the given timezone.
export function mondayOfWeek(timeZone: string, referenceDate = new Date()) {
  const { start: todayStart } = todayRangeInTimeZone(timeZone, referenceDate);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(referenceDate);
  const order: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const daysSinceMonday = order[weekday] ?? 0;
  return new Date(todayStart.getTime() - daysSinceMonday * 86_400_000);
}

// The 7 local-midnight instants (Mon..Sun) for the week starting at `weekStart`.
export function weekDays(weekStart: Date) {
  return Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86_400_000));
}

// Parse a "?week=YYYY-MM-DD" param back into that week's Monday (local
// midnight instant). Falls back to the current week if missing/invalid.
export function parseWeekParam(param: string | undefined, timeZone: string) {
  if (param && /^\d{4}-\d{2}-\d{2}$/.test(param)) {
    // Anchor at UTC noon so realistic studio timezones (roughly UTC-11..+13)
    // can't shift this across a local calendar-day boundary.
    const anchor = new Date(`${param}T12:00:00Z`);
    return mondayOfWeek(timeZone, anchor);
  }
  return mondayOfWeek(timeZone);
}
