import { and, count, eq, gte, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { combineLocalDateTime, localDateKey, mondayOfWeek, weekDays } from "./time";

// How many weeks ahead "create a class from template" backfills real
// sessions for a newly-added recurring slot. Weeks further out than this
// still pick up the slot once ensureWeekGenerated() reaches them (an empty
// week pulls in every slot on the default template, this one included) —
// this horizon just means the manager doesn't have to wait for that: the
// next couple of months show up right away, same spirit as bills' 60-day
// recurring-occurrence horizon.
const RECURRING_BACKFILL_WEEKS = 8;

// If a week has zero sessions and the studio has a default template, fills
// that week in from the template — so future weeks stay populated without
// anyone having to click anything. Only ever acts on a genuinely empty
// week: once a week has any session in it (generated or manual), it's left
// alone, so this never clobbers edits.
export async function ensureWeekGenerated(
  studio: { id: number; timezone: string },
  weekStart: Date,
  weekEnd: Date
) {
  const [{ value: existingCount }] = await db
    .select({ value: count() })
    .from(schema.classSessions)
    .where(
      and(
        eq(schema.classSessions.studioId, studio.id),
        gte(schema.classSessions.startsAt, weekStart),
        lt(schema.classSessions.startsAt, weekEnd)
      )
    );
  if (existingCount > 0) return;

  const [defaultTemplate] = await db
    .select()
    .from(schema.scheduleTemplates)
    .where(
      and(
        eq(schema.scheduleTemplates.studioId, studio.id),
        eq(schema.scheduleTemplates.isDefault, true)
      )
    )
    .limit(1);
  if (!defaultTemplate) return;

  const slots = await db
    .select()
    .from(schema.scheduleTemplateSlots)
    .where(eq(schema.scheduleTemplateSlots.templateId, defaultTemplate.id));
  if (slots.length === 0) return;

  const days = weekDays(weekStart);
  await db.insert(schema.classSessions).values(
    slots.map((slot) => ({
      studioId: studio.id,
      teacherId: slot.teacherId,
      classTypeId: slot.classTypeId,
      room: slot.room,
      startsAt: combineLocalDateTime(
        localDateKey(days[slot.weekday] ?? days[0], studio.timezone),
        slot.time,
        studio.timezone
      ),
      capacity: slot.capacity,
      status: "scheduled" as const,
    }))
  );
}

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
