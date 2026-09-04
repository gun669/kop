"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, lt, count } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";
import { combineLocalDateTime, localDateKey, weekDays } from "@/lib/time";

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

export async function createSessionAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const { studio } = await assertManagerAccess(studioId);

  const date = String(formData.get("date"));
  const time = String(formData.get("time"));
  const teacherId = Number(formData.get("teacherId")) || null;
  const classTypeId = Number(formData.get("classTypeId")) || null;
  const room = String(formData.get("room") ?? "").trim() || null;
  const capacity = Number(formData.get("capacity")) || 20;

  await db.insert(schema.classSessions).values({
    studioId,
    teacherId,
    classTypeId,
    room,
    startsAt: combineLocalDateTime(date, time, studio.timezone),
    capacity,
    status: "scheduled",
  });

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

// Duplicates every non-cancelled class from one week onto another — the
// realistic weekly workflow ("mostly the same as last week, tweak a few
// teacher slots") instead of re-entering the whole schedule by hand.
export async function copyWeekAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  await assertManagerAccess(studioId);

  const fromWeekStart = new Date(String(formData.get("fromWeekStart")));
  const toWeekStart = new Date(String(formData.get("toWeekStart")));
  const fromWeekEnd = new Date(fromWeekStart.getTime() + 7 * 86_400_000);
  const shift = toWeekStart.getTime() - fromWeekStart.getTime();

  const sourceSessions = await db
    .select()
    .from(schema.classSessions)
    .where(
      and(
        eq(schema.classSessions.studioId, studioId),
        gte(schema.classSessions.startsAt, fromWeekStart),
        lt(schema.classSessions.startsAt, fromWeekEnd)
      )
    );

  const toCopy = sourceSessions.filter((s) => s.status !== "cancelled");
  if (toCopy.length > 0) {
    await db.insert(schema.classSessions).values(
      toCopy.map((s) => ({
        studioId,
        teacherId: s.teacherId,
        classTypeId: s.classTypeId,
        room: s.room,
        startsAt: new Date(s.startsAt.getTime() + shift),
        capacity: s.capacity,
        status: "scheduled" as const,
      }))
    );
  }

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
