// Two jobs that make the check-in page an honest, single-page picture of a
// class, per Gün's ask (Sep 16, 2026): "having all the customer data on the
// same page — walk-in, online booked, etc." and "we need to be knowing
// exactly who was in each class, how they paid."
//
// 1. reconcileNoShows() — a booking still "booked" 10 minutes after its
//    class started, with no matching sign-in, means the guest booked ahead
//    and never showed and nobody noticed. Left alone this was previously
//    invisible everywhere: no sign-in row, so no-show/attendance stats and
//    the teacher performance table silently undercounted exactly the guests
//    worth tracking most. Runs lazily on every check-in page view (same
//    no-cron-job pattern as recurring bills/schedule generation) rather
//    than needing a background job — idempotent, safe to call repeatedly.
//
// 2. buildRoster() — merges bookings and sign-ins for one class session
//    into a single list, so "who was expected" (booked online) and "who
//    actually happened" (checked in, no-show, walk-in) are one picture
//    instead of two separate, hard-to-cross-reference tables.

import { and, eq, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/db";

const NO_SHOW_GRACE_MINUTES = 10;

export async function reconcileNoShows(studioId: number, referenceTime = new Date()) {
  const cutoff = new Date(referenceTime.getTime() - NO_SHOW_GRACE_MINUTES * 60_000);

  // Only sessions that actually started more than the grace period ago need
  // checking — this keeps the query cheap on every page view rather than
  // scanning the studio's entire booking history.
  const staleBookings = await db
    .select({
      bookingId: schema.bookings.id,
      classSessionId: schema.bookings.classSessionId,
      guestId: schema.bookings.guestId,
    })
    .from(schema.bookings)
    .innerJoin(schema.classSessions, eq(schema.bookings.classSessionId, schema.classSessions.id))
    .where(
      and(
        eq(schema.bookings.studioId, studioId),
        eq(schema.bookings.status, "booked"),
        lt(schema.classSessions.startsAt, cutoff)
      )
    );

  if (staleBookings.length === 0) return 0;

  // A booking can only be reconciled to no-show if nobody ever actually
  // checked that guest in for that class — if a sign-in exists, check-in
  // already flipped the booking to "attended" itself, but guard here too
  // in case of a future edge case (e.g. a sign-in created some other way).
  const existingSignIns = await db
    .select({
      classSessionId: schema.signIns.classSessionId,
      guestId: schema.signIns.guestId,
    })
    .from(schema.signIns)
    .where(
      inArray(
        schema.signIns.classSessionId,
        staleBookings.map((b) => b.classSessionId)
      )
    );
  const alreadySignedIn = new Set(existingSignIns.map((s) => `${s.classSessionId}:${s.guestId}`));

  const toReconcile = staleBookings.filter(
    (b) => !alreadySignedIn.has(`${b.classSessionId}:${b.guestId}`)
  );

  for (const b of toReconcile) {
    await db.transaction(async (tx) => {
      await tx.insert(schema.signIns).values({
        studioId,
        classSessionId: b.classSessionId,
        guestId: b.guestId,
        status: "no_show",
        // No checkedInByUserId — this is an automatic system reconciliation,
        // nobody at the desk made this call, and the roster/UI should be
        // able to tell the difference from a staff-marked no-show if that
        // ever matters later.
      });
      await tx
        .update(schema.bookings)
        .set({ status: "no_show" })
        .where(eq(schema.bookings.id, b.bookingId));
    });
  }

  return toReconcile.length;
}

export type RosterEntry = {
  guestId: number;
  guestName: string;
  guestPhone: string | null;
  status: "booked" | "attended" | "no_show" | "late_cancel";
  source: "online" | "walk-in";
  signInId: number | null;
  checkedInAt: Date | null;
  membershipType: (typeof schema.memberships.$inferSelect)["type"] | null;
  hasCoverage: boolean; // false = attended with no membership on file — flag for front desk
};

export async function buildRoster(classSessionId: number): Promise<RosterEntry[]> {
  const signInRows = await db
    .select({
      id: schema.signIns.id,
      status: schema.signIns.status,
      checkedInAt: schema.signIns.checkedInAt,
      guestId: schema.guests.id,
      guestName: schema.guests.name,
      guestPhone: schema.guests.phone,
      membershipType: schema.memberships.type,
    })
    .from(schema.signIns)
    .innerJoin(schema.guests, eq(schema.signIns.guestId, schema.guests.id))
    .leftJoin(schema.memberships, eq(schema.signIns.membershipId, schema.memberships.id))
    .where(eq(schema.signIns.classSessionId, classSessionId));

  const bookingRows = await db
    .select({
      status: schema.bookings.status,
      guestId: schema.guests.id,
      guestName: schema.guests.name,
      guestPhone: schema.guests.phone,
    })
    .from(schema.bookings)
    .innerJoin(schema.guests, eq(schema.bookings.guestId, schema.guests.id))
    .where(eq(schema.bookings.classSessionId, classSessionId));

  const bookedGuestIds = new Set(bookingRows.map((b) => b.guestId));

  const entries: RosterEntry[] = signInRows.map((s) => ({
    guestId: s.guestId,
    guestName: s.guestName,
    guestPhone: s.guestPhone,
    status: s.status,
    source: bookedGuestIds.has(s.guestId) ? "online" : "walk-in",
    signInId: s.id,
    checkedInAt: s.checkedInAt,
    membershipType: s.membershipType,
    hasCoverage: s.status !== "attended" || s.membershipType !== null,
  }));

  const signedInGuestIds = new Set(signInRows.map((s) => s.guestId));
  for (const b of bookingRows) {
    if (signedInGuestIds.has(b.guestId)) continue; // already represented above
    if (b.status !== "booked") continue; // cancelled bookings have nothing to check in
    entries.push({
      guestId: b.guestId,
      guestName: b.guestName,
      guestPhone: b.guestPhone,
      status: "booked",
      source: "online",
      signInId: null,
      checkedInAt: null,
      membershipType: null,
      hasCoverage: true, // n/a — hasn't attended yet
    });
  }

  const rank: Record<RosterEntry["status"], number> = {
    booked: 0,
    attended: 1,
    late_cancel: 2,
    no_show: 3,
  };
  entries.sort((a, b) => rank[a.status] - rank[b.status] || a.guestName.localeCompare(b.guestName));

  return entries;
}
