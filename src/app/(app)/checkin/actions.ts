"use server";

import { revalidatePath } from "next/cache";
import { eq, and, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { packageByKey, addMonthsToDateString } from "@/lib/packages";
import { localDateKey } from "@/lib/time";

// Owner/manager/receptionist can check anyone into any class. A teacher can
// only check students into a class they are assigned to teach — covering
// the case where reception isn't around and a teacher needs to keep the
// roster accurate themselves.
async function assertCanManageCheckIn(studioId: number, classSessionId: number) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const studios = await getAccessibleStudios(session);
  const studio = studios.find((s) => s.id === studioId);
  if (!studio) throw new Error("No access to this studio");

  if (["owner", "manager", "receptionist"].includes(studio.role)) {
    return { session, studio };
  }

  if (studio.role === "teacher") {
    const [teacher] = await db
      .select()
      .from(schema.teachers)
      .where(and(eq(schema.teachers.studioId, studioId), eq(schema.teachers.userId, session.userId)))
      .limit(1);
    if (!teacher) throw new Error("Not allowed to check guests in");

    const [target] = await db
      .select({ teacherId: schema.classSessions.teacherId })
      .from(schema.classSessions)
      .where(and(eq(schema.classSessions.id, classSessionId), eq(schema.classSessions.studioId, studioId)))
      .limit(1);
    if (!target || target.teacherId !== teacher.id) {
      throw new Error("Teachers can only check students into their own classes");
    }
    return { session, studio };
  }

  throw new Error("Not allowed to check guests in");
}

// Selling a package is a front-desk/management action, not something a
// teacher does — deliberately narrower than assertCanManageCheckIn (which
// lets a teacher check in students for their own class), and doesn't need
// a classSessionId since it isn't tied to any one class.
async function assertCanSellMembership(studioId: number) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const studios = await getAccessibleStudios(session);
  const studio = studios.find((s) => s.id === studioId);
  if (!studio) throw new Error("No access to this studio");
  if (!["owner", "manager", "receptionist"].includes(studio.role)) {
    throw new Error("Not allowed to sell packages");
  }
  return { session, studio };
}

// Records a real package sale: creates the membership (so the guest can
// actually use it to check in) and a matching revenue entry in the same
// transaction (so /money and the dashboard reflect it too) — this is the
// piece that was missing between "we can check people in" and "we can
// actually run the studio's day-to-day sales through KOP." Price and
// validity come from the studio's own package list (src/lib/packages.ts),
// never from the submitted form, so a tampered request can't record an
// arbitrary amount.
export async function sellMembershipAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const guestId = Number(formData.get("guestId"));
  const packageKey = String(formData.get("packageKey") ?? "");

  const { session, studio } = await assertCanSellMembership(studioId);

  const pkg = packageByKey(studio.slug, packageKey);
  if (!pkg) throw new Error("Unknown package");

  const [guest] = await db
    .select({ id: schema.guests.id })
    .from(schema.guests)
    .where(and(eq(schema.guests.id, guestId), eq(schema.guests.studioId, studioId)))
    .limit(1);
  if (!guest) throw new Error("Guest not found");

  const startsOn = localDateKey(new Date(), studio.timezone);
  const expiresOn = addMonthsToDateString(startsOn, pkg.validityMonths);

  await db.transaction(async (tx) => {
    await tx.insert(schema.memberships).values({
      studioId,
      guestId,
      type: pkg.type,
      totalCredits: pkg.credits,
      remainingCredits: pkg.credits,
      startsOn,
      expiresOn,
    });

    await tx.insert(schema.revenueEntries).values({
      studioId,
      source: pkg.type === "drop_in" ? "drop_in" : "membership_sale",
      amount: String(pkg.price),
      note: pkg.label,
      guestId,
      occurredOn: startsOn,
      enteredByUserId: session.userId,
    });
  });

  revalidatePath("/checkin");
  revalidatePath("/money");
  revalidatePath("/dashboard");
}

export async function checkInExistingGuestAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const classSessionId = Number(formData.get("classSessionId"));
  const guestId = Number(formData.get("guestId"));
  const membershipId = formData.get("membershipId")
    ? Number(formData.get("membershipId"))
    : null;

  const { session } = await assertCanManageCheckIn(studioId, classSessionId);

  await db.transaction(async (tx) => {
    await tx.insert(schema.signIns).values({
      studioId,
      classSessionId,
      guestId,
      membershipId,
      status: "attended",
      checkedInByUserId: session.userId,
    });

    // If this guest already booked a spot in this class ahead of time,
    // checking them in converts that reservation to "attended" instead of
    // leaving it stranded as a separate, disconnected record — see the
    // bookings table (src/db/schema.ts) for why the two are kept apart.
    await tx
      .update(schema.bookings)
      .set({ status: "attended" })
      .where(
        and(
          eq(schema.bookings.classSessionId, classSessionId),
          eq(schema.bookings.guestId, guestId),
          eq(schema.bookings.status, "booked")
        )
      );

    if (membershipId) {
      const [m] = await tx
        .select()
        .from(schema.memberships)
        .where(eq(schema.memberships.id, membershipId))
        .limit(1);
      if (m && m.remainingCredits !== null && m.remainingCredits > 0) {
        await tx
          .update(schema.memberships)
          .set({ remainingCredits: m.remainingCredits - 1 })
          .where(eq(schema.memberships.id, membershipId));
      }
    }
  });

  revalidatePath("/checkin");
}

export async function quickAddAndCheckInAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const classSessionId = Number(formData.get("classSessionId"));
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!name) return;

  const { session } = await assertCanManageCheckIn(studioId, classSessionId);
  const normalizedPhone = normalizePhone(phone);

  await db.transaction(async (tx) => {
    // Phone number is the real identity key here, not the name someone
    // happens to type at the desk — so before creating a new guest, check
    // whether this phone number already belongs to someone in this studio
    // and reuse that record instead of splintering their history across
    // two guest rows (see bug: "guests should be linked by phone number,
    // not name"). Matching happens in JS against normalized numbers since
    // phone is stored as free-text and can't be compared reliably in SQL.
    let guestId: number;
    if (normalizedPhone) {
      const candidates = await tx
        .select({ id: schema.guests.id, phone: schema.guests.phone })
        .from(schema.guests)
        .where(and(eq(schema.guests.studioId, studioId), isNotNull(schema.guests.phone)));
      const existing = candidates.find((g) => normalizePhone(g.phone) === normalizedPhone);
      guestId = existing ? existing.id : -1;
    } else {
      guestId = -1;
    }

    if (guestId === -1) {
      const [guest] = await tx
        .insert(schema.guests)
        .values({ studioId, name, phone: phone || null })
        .returning();
      guestId = guest.id;
    } else {
      // Matched an existing guest by phone — if they're already on this
      // class's roster (e.g. reception typed them in twice), don't create a
      // second sign-in row for the same person/class.
      const [already] = await tx
        .select({ id: schema.signIns.id })
        .from(schema.signIns)
        .where(and(eq(schema.signIns.classSessionId, classSessionId), eq(schema.signIns.guestId, guestId)))
        .limit(1);
      if (already) return;
    }

    await tx.insert(schema.signIns).values({
      studioId,
      classSessionId,
      guestId,
      status: "attended",
      checkedInByUserId: session.userId,
    });

    // Same conversion as the existing-guest path above — a walk-in who'd
    // already booked online shouldn't end up with a dangling reservation.
    await tx
      .update(schema.bookings)
      .set({ status: "attended" })
      .where(
        and(
          eq(schema.bookings.classSessionId, classSessionId),
          eq(schema.bookings.guestId, guestId),
          eq(schema.bookings.status, "booked")
        )
      );
  });

  revalidatePath("/checkin");
}

export async function setSignInStatusAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const signInId = Number(formData.get("signInId"));
  const classSessionId = Number(formData.get("classSessionId"));
  const status = String(formData.get("status")) as
    | "attended"
    | "no_show"
    | "late_cancel";

  await assertCanManageCheckIn(studioId, classSessionId);

  await db
    .update(schema.signIns)
    .set({ status })
    .where(and(eq(schema.signIns.id, signInId), eq(schema.signIns.studioId, studioId)));

  revalidatePath("/checkin");
}
