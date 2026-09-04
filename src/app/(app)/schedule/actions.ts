"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, lt, count } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";

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

function combineLocalDateTime(dateStr: string, timeStr: string, timezone: string) {
  // dateStr: "2026-09-07", timeStr: "09:30" — both in the studio's local time.
  // Build the UTC instant by anchoring at UTC noon on that date (safe for
  // realistic studio timezones) and then applying the timezone's offset.
  const [h, m] = timeStr.split(":").map(Number);
  const noonUtc = new Date(`${dateStr}T12:00:00Z`);
  const offsetFmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" });
  const offsetPart = offsetFmt.formatToParts(noonUtc).find((p) => p.type === "timeZoneName")!.value;
  const match = offsetPart.match(/GMT([+-])(\d{2}):(\d{2})/);
  const sign = match?.[1] === "-" ? -1 : 1;
  const offsetMinutes = match ? sign * (Number(match[2]) * 60 + Number(match[3])) : 0;
  // Local midnight (UTC instant) for dateStr:
  const localMidnightUtc = new Date(Date.UTC(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10)),
    0, 0, 0
  ) - offsetMinutes * 60_000);
  return new Date(localMidnightUtc.getTime() + (h * 60 + m) * 60_000);
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
