// "See you tomorrow" reminder emails (Gün, Oct 5 2026) — fired by a Vercel
// Cron hitting this route hourly (see vercel.json). A class reminder can't
// use this app's usual lazy "run it when someone happens to load a page"
// pattern (reconcileNoShows, the old ensureWeekGenerated): nobody is
// guaranteed to load any page at exactly the right moment for every class,
// every studio, every day — this genuinely needs a real schedule.
//
// Finds every still-"booked" reservation whose class starts 23–25 hours
// from now (a 2-hour window so an hourly cron can't miss one to drift),
// hasn't been reminded yet, and belongs to a guest with an email on file —
// emails each, then stamps reminderSentAt so the next hourly run (or a
// manual retry) doesn't double-send. Entirely inert if RESEND_API_KEY/
// EMAIL_FROM aren't set (see src/lib/email.ts) or CRON_SECRET is unset —
// see below.
import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { sendClassReminderEmail } from "@/lib/email";

export async function GET(req: NextRequest) {
  // Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically
  // once CRON_SECRET is set as an env var — this just stops anyone else
  // from triggering (or spamming) the route. If CRON_SECRET isn't set yet,
  // the route no-ops entirely rather than running unguarded.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ ok: true, skipped: "CRON_SECRET not configured" });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 401 });
  }

  const now = Date.now();
  const windowStart = new Date(now + 23 * 60 * 60_000);
  const windowEnd = new Date(now + 25 * 60 * 60_000);

  const due = await db
    .select({
      bookingId: schema.bookings.id,
      guestName: schema.guests.name,
      guestEmail: schema.guests.email,
      studioName: schema.studios.name,
      timezone: schema.studios.timezone,
      startsAt: schema.classSessions.startsAt,
      room: schema.classSessions.room,
      classTypeName: schema.classTypes.name,
      teacherName: schema.teachers.name,
    })
    .from(schema.bookings)
    .innerJoin(schema.classSessions, eq(schema.bookings.classSessionId, schema.classSessions.id))
    .innerJoin(schema.studios, eq(schema.bookings.studioId, schema.studios.id))
    .innerJoin(schema.guests, eq(schema.bookings.guestId, schema.guests.id))
    .leftJoin(schema.classTypes, eq(schema.classSessions.classTypeId, schema.classTypes.id))
    .leftJoin(schema.teachers, eq(schema.classSessions.teacherId, schema.teachers.id))
    .where(
      and(
        eq(schema.bookings.status, "booked"),
        isNull(schema.bookings.reminderSentAt),
        gte(schema.classSessions.startsAt, windowStart),
        lt(schema.classSessions.startsAt, windowEnd)
      )
    );

  let sent = 0;
  let skippedNoEmail = 0;
  let failed = 0;

  for (const row of due) {
    if (!row.guestEmail) {
      skippedNoEmail++;
      continue;
    }
    const result = await sendClassReminderEmail({
      to: row.guestEmail,
      guestName: row.guestName,
      class: {
        studioName: row.studioName,
        classTypeName: row.classTypeName,
        teacherName: row.teacherName,
        room: row.room,
        startsAt: row.startsAt,
        timezone: row.timezone,
      },
    });
    if (result.sent) {
      sent++;
      // Stamped regardless of guest email presence would be wrong — only
      // mark it reminded once an email actually went out, so a guest who
      // adds an email later this same day could still be reminded by a
      // later run... except the window would have likely passed by then.
      // Good enough for now; worth revisiting if that edge case matters.
      await db
        .update(schema.bookings)
        .set({ reminderSentAt: new Date() })
        .where(eq(schema.bookings.id, row.bookingId));
    } else {
      failed++;
    }
  }

  return NextResponse.json({ ok: true, found: due.length, sent, skippedNoEmail, failed });
}
