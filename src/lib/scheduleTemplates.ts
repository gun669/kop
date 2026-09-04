import { and, count, eq, gte, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { combineLocalDateTime, localDateKey, weekDays } from "./time";

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
