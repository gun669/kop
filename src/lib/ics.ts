import crypto from "crypto";

export function generateIcsToken() {
  return crypto.randomBytes(24).toString("hex");
}

// RFC 5545 §3.3.11 TEXT escaping — backslash, semicolon, comma, and
// newlines all need escaping inside a TEXT value (SUMMARY/LOCATION/
// DESCRIPTION), or a calendar app can misparse a class name/room that
// happens to contain a comma.
function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// UTC "YYYYMMDDTHHMMSSZ" — deliberately UTC rather than a local TZID, so
// the feed is correct on any calendar app without also having to ship a
// VTIMEZONE block.
function icsDateTime(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

// Lines longer than 75 octets must be "folded" (continued on the next
// line with a leading space) per RFC 5545 §3.1 — most calendar apps are
// lenient about this, but Outlook in particular can choke on long
// unfolded lines, so it's worth doing properly rather than skipping it.
function foldLine(line: string) {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = " " + rest.slice(75);
  }
  parts.push(rest);
  return parts.join("\r\n");
}

export type IcsEvent = {
  uid: string;
  startsAt: Date;
  endsAt: Date;
  summary: string;
  location?: string | null;
  description?: string | null;
};

// Builds a full VCALENDAR document (a teacher's private subscription
// feed — see Launch Path b15). One VEVENT per class session, keyed by a
// stable UID (the session's own id), so a calendar app that re-fetches
// this URL updates an already-added event in place rather than
// duplicating it when a class time changes.
export function buildIcsCalendar(calendarName: string, events: IcsEvent[]) {
  const now = icsDateTime(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KOP//Teacher Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldLine(`X-WR-CALNAME:${escapeIcsText(calendarName)}`),
  ];

  for (const ev of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.uid}`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART:${icsDateTime(ev.startsAt)}`);
    lines.push(`DTEND:${icsDateTime(ev.endsAt)}`);
    lines.push(foldLine(`SUMMARY:${escapeIcsText(ev.summary)}`));
    if (ev.location) lines.push(foldLine(`LOCATION:${escapeIcsText(ev.location)}`));
    if (ev.description) lines.push(foldLine(`DESCRIPTION:${escapeIcsText(ev.description)}`));
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
