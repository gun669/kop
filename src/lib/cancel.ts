import { and, asc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { localDateKey } from "@/lib/time";

// Guest-facing cancellation by emailed token. Policy (Gün, Oct 8 2026):
// cancelling more than the studio's cancelWindowHours before class is free;
// inside the window it's a "late cancel" — the spot is still released, but
// one class credit is forfeited (if the guest has a credit-based
// membership; unlimited memberships and guests with no credits lose
// nothing but the late-cancel mark).

export async function loadBookingByToken(token: string) {
  if (!token || token.length > 64) return null;
  const [row] = await db
    .select({
      bookingId: schema.bookings.id,
      status: schema.bookings.status,
      studioId: schema.bookings.studioId,
      guestId: schema.bookings.guestId,
      classSessionId: schema.bookings.classSessionId,
      guestName: schema.guests.name,
      startsAt: schema.classSessions.startsAt,
      room: schema.classSessions.room,
      classTypeName: schema.classTypes.name,
      teacherName: schema.teachers.name,
      studioName: schema.studios.name,
      studioSlug: schema.studios.slug,
      timezone: schema.studios.timezone,
      cancelWindowHours: schema.studios.cancelWindowHours,
    })
    .from(schema.bookings)
    .innerJoin(schema.guests, eq(schema.bookings.guestId, schema.guests.id))
    .innerJoin(schema.classSessions, eq(schema.bookings.classSessionId, schema.classSessions.id))
    .innerJoin(schema.studios, eq(schema.bookings.studioId, schema.studios.id))
    .leftJoin(schema.classTypes, eq(schema.classSessions.classTypeId, schema.classTypes.id))
    .leftJoin(schema.teachers, eq(schema.classSessions.teacherId, schema.teachers.id))
    .where(eq(schema.bookings.cancelToken, token))
    .limit(1);
  return row ?? null;
}

export function cancelState(startsAt: Date, windowHours: number, now = new Date()) {
  const msLeft = startsAt.getTime() - now.getTime();
  return {
    started: msLeft <= 0,
    late: msLeft < windowHours * 3_600_000,
  };
}

export type CancelResult =
  | { ok: true; late: boolean; creditForfeited: boolean }
  | { ok: false; reason: "not_found" | "not_active" | "started" };

export async function cancelBookingByToken(token: string): Promise<CancelResult> {
  const info = await loadBookingByToken(token);
  if (!info) return { ok: false, reason: "not_found" };

  const { started, late } = cancelState(info.startsAt, info.cancelWindowHours);
  if (started) return { ok: false, reason: "started" };

  return db.transaction(async (tx) => {
    // Flip only if still "booked" so a double click can't forfeit two
    // credits.
    const flipped = await tx
      .update(schema.bookings)
      .set({ status: "cancelled" })
      .where(and(eq(schema.bookings.id, info.bookingId), eq(schema.bookings.status, "booked")))
      .returning({ id: schema.bookings.id });
    if (flipped.length === 0) return { ok: false as const, reason: "not_active" as const };

    if (!late) return { ok: true as const, late: false, creditForfeited: false };

    // Late cancel: forfeit one credit from the soonest-expiring
    // credit-based membership that still has credits, and record a
    // late_cancel sign-in so reporting sees it.
    const today = localDateKey(new Date(), info.timezone);
    const [membership] = await tx
      .select({ id: schema.memberships.id, remaining: schema.memberships.remainingCredits })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.guestId, info.guestId),
          eq(schema.memberships.studioId, info.studioId),
          sql`${schema.memberships.remainingCredits} > 0`,
          or(isNull(schema.memberships.expiresOn), gte(schema.memberships.expiresOn, today))
        )
      )
      .orderBy(sql`${schema.memberships.expiresOn} asc nulls last`, asc(schema.memberships.id))
      .limit(1);

    let creditForfeited = false;
    if (membership && membership.remaining !== null) {
      await tx
        .update(schema.memberships)
        .set({ remainingCredits: membership.remaining - 1 })
        .where(eq(schema.memberships.id, membership.id));
      creditForfeited = true;
    }

    const [existingSignIn] = await tx
      .select({ id: schema.signIns.id })
      .from(schema.signIns)
      .where(
        and(
          eq(schema.signIns.classSessionId, info.classSessionId),
          eq(schema.signIns.guestId, info.guestId)
        )
      )
      .limit(1);
    if (!existingSignIn) {
      await tx.insert(schema.signIns).values({
        studioId: info.studioId,
        classSessionId: info.classSessionId,
        guestId: info.guestId,
        membershipId: creditForfeited ? membership!.id : null,
        status: "late_cancel",
      });
    }
    return { ok: true as const, late: true, creditForfeited };
  });
}
