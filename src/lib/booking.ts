import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { normalizePhone } from "@/lib/phone";

// The reusable core of "a guest books a spot in a future class" — meant to
// be called from whatever server action ends up wired to the actual
// booking UI (Launch Path p0a/p3), so the booking rules live in one place
// rather than being re-implemented per entry point. Deliberately mirrors
// check-in's quick-add guest-matching (src/app/(app)/checkin/actions.ts) —
// same phone-normalization approach, so a guest who books online and a
// guest who's walked into the studio before resolve to the same guest
// record. Not unified into one shared helper (yet) to avoid fighting
// Drizzle's transaction typing across two different call sites under
// time pressure — if it drifts, that's the sign to unify.
export type BookingResult =
  | { ok: true; bookingId: number; guestId: number; alreadyBooked: boolean }
  | { ok: false; reason: "full" | "session_not_found" };

export async function bookGuestForSession(params: {
  studioId: number;
  classSessionId: number;
  name: string;
  phone: string;
}): Promise<BookingResult> {
  const name = params.name.trim();
  const normalizedPhone = normalizePhone(params.phone);

  return db.transaction(async (tx) => {
    // 1. Find-or-create the guest by phone — the safe identity key (see
    // src/lib/phone.ts), not the name they happen to type.
    let guestId = -1;
    if (normalizedPhone) {
      const candidates = await tx
        .select({ id: schema.guests.id, phone: schema.guests.phone })
        .from(schema.guests)
        .where(and(eq(schema.guests.studioId, params.studioId), isNotNull(schema.guests.phone)));
      const existing = candidates.find((g) => normalizePhone(g.phone) === normalizedPhone);
      if (existing) guestId = existing.id;
    }
    if (guestId === -1) {
      const [guest] = await tx
        .insert(schema.guests)
        .values({ studioId: params.studioId, name, phone: params.phone || null })
        .returning();
      guestId = guest.id;
    }

    // 2. Capacity check: attended sign-ins (walk-ins today) + active
    // bookings (reserved ahead of time) both count against capacity — a
    // class can be "full" purely from online bookings before reception
    // even opens for the day.
    const [session] = await tx
      .select({ capacity: schema.classSessions.capacity })
      .from(schema.classSessions)
      .where(eq(schema.classSessions.id, params.classSessionId))
      .limit(1);
    if (!session) return { ok: false, reason: "session_not_found" as const };

    const attended = await tx
      .select({ id: schema.signIns.id })
      .from(schema.signIns)
      .where(
        and(
          eq(schema.signIns.classSessionId, params.classSessionId),
          eq(schema.signIns.status, "attended")
        )
      );

    const activeBookings = await tx
      .select({ id: schema.bookings.id, guestId: schema.bookings.guestId })
      .from(schema.bookings)
      .where(and(eq(schema.bookings.classSessionId, params.classSessionId), eq(schema.bookings.status, "booked")));

    const ownActiveBooking = activeBookings.find((b) => b.guestId === guestId);
    if (ownActiveBooking) {
      // Already holding a spot in this class — booking again is a no-op,
      // not a second reservation (the unique index would reject it anyway).
      return { ok: true, bookingId: ownActiveBooking.id, guestId, alreadyBooked: true };
    }

    const occupied = attended.length + activeBookings.length;
    if (occupied >= session.capacity) {
      return { ok: false, reason: "full" as const };
    }

    // 3. Reserve the spot. One row per (classSessionId, guestId) — if this
    // guest previously cancelled a booking for this same class, flip that
    // row back to "booked" instead of inserting a second one.
    const [existingRow] = await tx
      .select({ id: schema.bookings.id })
      .from(schema.bookings)
      .where(and(eq(schema.bookings.classSessionId, params.classSessionId), eq(schema.bookings.guestId, guestId)))
      .limit(1);

    if (existingRow) {
      await tx.update(schema.bookings).set({ status: "booked" }).where(eq(schema.bookings.id, existingRow.id));
      return { ok: true, bookingId: existingRow.id, guestId, alreadyBooked: false };
    }

    const [row] = await tx
      .insert(schema.bookings)
      .values({ studioId: params.studioId, classSessionId: params.classSessionId, guestId, status: "booked" })
      .returning();
    return { ok: true, bookingId: row.id, guestId, alreadyBooked: false };
  });
}
