"use server";

import { revalidatePath } from "next/cache";
import { and, eq, count } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";
import { combineLocalDateTime, localDateKey, weekDays, weekdayIndexInZone } from "@/lib/time";
import { addRecurringSlotAndBackfill } from "@/lib/scheduleTemplates";

async function assertManagerAccess(studioId: number) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const studios = await getAccessibleStudios(session);
  const studio = studios.find((s) => s.id === studioId);
  if (!studio || !["owner", "manager"].includes(studio.role)) {
    throw new Error("Not allowed to edit the schedule");
  }
  return { session, studio };
}

// Adds a class from the "+ Add a class" form on a given day. Two modes,
// picked by the manager right after choosing a class type:
//  - "one_time" (default): a single session on this exact date, same as
//    before — no template involved at all.
//  - "recurring": this class happens every week from now on. Adds a new
//    slot to the studio's default template (so future weeks keep including
//    it automatically) and backfills real sessions into the next several
//    already-generated weeks — see addRecurringSlotAndBackfill().
export async function createSessionAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const { studio } = await assertManagerAccess(studioId);

  const mode = String(formData.get("mode") ?? "one_time");
  const date = String(formData.get("date"));
  const time = String(formData.get("time"));
  const teacherId = Number(formData.get("teacherId")) || null;
  const classTypeId = Number(formData.get("classTypeId")) || null;
  const room = String(formData.get("room") ?? "").trim() || null;
  const capacity = Number(formData.get("capacity")) || 20;

  if (mode === "recurring") {
    await addRecurringSlotAndBackfill(studio, {
      weekday: weekdayIndexInZone(date, studio.timezone),
      time,
      teacherId,
      classTypeId,
      room,
      capacity,
    });
    revalidatePath("/templates");
  } else {
    await db.insert(schema.classSessions).values({
      studioId,
      teacherId,
      classTypeId,
      room,
      startsAt: combineLocalDateTime(date, time, studio.timezone),
      capacity,
      status: "scheduled",
    });
  }

  revalidatePath("/schedule");
  revalidatePath("/checkin");
  revalidatePath("/dashboard");
}

export async function updateSessionAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const { studio } = await assertManagerAccess(studioId);

  const sessionId = Number(formData.get("sessionId"));
  const date = String(formData.get("date"));
  const time = String(formData.get("time"));
  const teacherId = Number(formData.get("teacherId")) || null;
  const classTypeId = Number(formData.get("classTypeId")) || null;
  const room = String(formData.get("room") ?? "").trim() || null;
  const capacity = Number(formData.get("capacity")) || 20;

  await db
    .update(schema.classSessions)
    .set({
      teacherId,
      classTypeId,
      room,
      startsAt: combineLocalDateTime(date, time, studio.timezone),
      capacity,
    })
    .where(and(eq(schema.classSessions.id, sessionId), eq(schema.classSessions.studioId, studioId)));

  revalidatePath("/schedule");
  revalidatePath("/checkin");
  revalidatePath("/dashboard");
}

// Removes a class from the schedule. If nobody has been checked in against
// it yet, it's gone entirely. If people have sign-ins on it, we cancel it
// instead so that attendance history isn't silently deleted.
export async function removeSessionAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  await assertManagerAccess(studioId);

  const sessionId = Number(formData.get("sessionId"));

  const [{ value: signInCount }] = await db
    .select({ value: count() })
    .from(schema.signIns)
    .where(eq(schema.signIns.classSessionId, sessionId));

  if (signInCount > 0) {
    await db
      .update(schema.classSessions)
      .set({ status: "cancelled" })
      .where(and(eq(schema.classSessions.id, sessionId), eq(schema.classSessions.studioId, studioId)));
  } else {
    await db
      .delete(schema.classSessions)
      .where(and(eq(schema.classSessions.id, sessionId), eq(schema.classSessions.studioId, studioId)));
  }

  revalidatePath("/schedule");
  revalidatePath("/checkin");
  revalidatePath("/dashboard");
}

export async function reinstateSessionAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  await assertManagerAccess(studioId);
  const sessionId = Number(formData.get("sessionId"));

  await db
    .update(schema.classSessions)
    .set({ status: "scheduled" })
    .where(and(eq(schema.classSessions.id, sessionId), eq(schema.classSessions.studioId, studioId)));

  revalidatePath("/schedule");
}

// Inserts every slot from a saved template into a specific week — additive,
// like copyWeekAction, so applying a template on top of an already-partly-
// filled week doesn't wipe anything out.
export async function applyTemplateAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const { studio } = await assertManagerAccess(studioId);

  const templateId = Number(formData.get("templateId"));
  const weekStart = new Date(String(formData.get("weekStart")));

  const slots = await db
    .select()
    .from(schema.scheduleTemplateSlots)
    .innerJoin(
      schema.scheduleTemplates,
      eq(schema.scheduleTemplateSlots.templateId, schema.scheduleTemplates.id)
    )
    .where(
      and(
        eq(schema.scheduleTemplateSlots.templateId, templateId),
        eq(schema.scheduleTemplates.studioId, studioId)
      )
    );

  if (slots.length > 0) {
    const days = weekDays(weekStart);
    await db.insert(schema.classSessions).values(
      slots.map(({ schedule_template_slots: slot }) => ({
        studioId,
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

  revalidatePath("/schedule");
}
