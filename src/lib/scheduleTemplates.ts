import { and, eq, gte, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { combineLocalDateTime, localDateKey, mondayOfWeek, weekDays } from "./time";

// How many weeks ahead "create a class from template" backfills real
// sessions for a newly-added recurring slot — the next couple of months
// show up right away, same spirit as bills' 60-day recurring-occurrence
// horizon.
//
// Note (Oct 2026): this used to also be topped up by an ensureWeekGenerated()
// that auto-filled any empty week from the studio's default template on
// every /schedule page view. Removed per Gün: studios keep their own
// schedule populated, and the lazy "does this week have zero sessions?"
// check-then-insert had a real race condition — two concurrent page loads
// on a genuinely empty week (two tabs, a prefetch + a real nav, two staff
// opening /schedule at once) could both see zero and both insert the full
// week's template, producing exact duplicate classes. The explicit
// "recurring?" flow below is the one real path left for getting classes
// onto the calendar from a template, and it already guards against
// double-inserting the same slot/time.
const RECURRING_BACKFILL_WEEKS = 8;

// "Create a class from template" (recurring mode): adds a new weekly slot
// to the studio's default template (creating one if it somehow doesn't
// have one yet), then immediately backfills real class_sessions for that
// slot across the next several weeks. Needed because ensureWeekGenerated()
// only ever touches a week with zero sessions — every near-term week
// already has sessions in it by the time a studio is in real use, so a
// brand-new slot would otherwise never show up until some future week
// happened to be completely empty. One-time classes never call this —
// they're a plain single-row insert, no template involved.
export async function addRecurringSlotAndBackfill(
  studio: { id: number; timezone: string },
  slot: {
    weekday: number;
    time: string;
    teacherId: number | null;
    classTypeId: number | null;
    room: string | null;
    capacity: number;
  }
) {
  let [defaultTemplate] = await db
    .select()
    .from(schema.scheduleTemplates)
    .where(
      and(
        eq(schema.scheduleTemplates.studioId, studio.id),
        eq(schema.scheduleTemplates.isDefault, true)
      )
    )
    .limit(1);

  if (!defaultTemplate) {
    [defaultTemplate] = await db
      .insert(schema.scheduleTemplates)
      .values({ studioId: studio.id, name: "Default", isDefault: true })
      .returning();
  }

  const [newSlot] = await db
    .insert(schema.scheduleTemplateSlots)
    .values({
      templateId: defaultTemplate.id,
      weekday: slot.weekday,
      time: slot.time,
      teacherId: slot.teacherId,
      classTypeId: slot.classTypeId,
      room: slot.room,
      capacity: slot.capacity,
    })
    .returning();

  const thisMonday = mondayOfWeek(studio.timezone);
  const startsAtTimes: Date[] = [];
  for (let week = 0; week < RECURRING_BACKFILL_WEEKS; week++) {
    const weekStart = new Date(thisMonday.getTime() + week * 7 * 86_400_000);
    const days = weekDays(weekStart);
    const occurrenceDate = days[slot.weekday] ?? days[0];
    const startsAt = combineLocalDateTime(
      localDateKey(occurrenceDate, studio.timezone),
      slot.time,
      studio.timezone
    );
    // Skip an occurrence that's already in the past (e.g. this week's slot
    // falls on a day earlier this week than today).
    if (startsAt.getTime() <= Date.now()) continue;
    startsAtTimes.push(startsAt);
  }

  if (startsAtTimes.length === 0) return newSlot;

  // Guard against double-inserting into a week that ensureWeekGenerated()
  // (or a manager, or another concurrent request) already populated for
  // this exact slot in the meantime.
  const existing = await db
    .select({ startsAt: schema.classSessions.startsAt })
    .from(schema.classSessions)
    .where(
      and(
        eq(schema.classSessions.studioId, studio.id),
        eq(schema.classSessions.teacherId, slot.teacherId ?? -1),
        eq(schema.classSessions.classTypeId, slot.classTypeId ?? -1),
        gte(schema.classSessions.startsAt, startsAtTimes[0]),
        lt(
          schema.classSessions.startsAt,
          new Date(startsAtTimes[startsAtTimes.length - 1].getTime() + 60_000)
        )
      )
    );
  const existingTimes = new Set(existing.map((e) => e.startsAt.getTime()));

  const toInsert = startsAtTimes.filter((t) => !existingTimes.has(t.getTime()));
  if (toInsert.length === 0) return newSlot;

  await db.insert(schema.classSessions).values(
    toInsert.map((startsAt) => ({
      studioId: studio.id,
      teacherId: slot.teacherId,
      classTypeId: slot.classTypeId,
      room: slot.room,
      startsAt,
      capacity: slot.capacity,
      status: "scheduled" as const,
    }))
  );

  return newSlot;
}
