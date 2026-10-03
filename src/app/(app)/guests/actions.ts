"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";
import { addMonthsToDateString } from "@/lib/packages";

// Same access level as Check-in and selling packages — front desk needs to
// be able to fix a mistyped phone number or jot a note just as much as
// owner/manager do. Teachers don't get a guest directory at all.
async function assertCanManageGuests(studioId: number) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const studios = await getAccessibleStudios(session);
  const studio = studios.find((s) => s.id === studioId);
  if (!studio || !["owner", "manager", "receptionist"].includes(studio.role)) {
    throw new Error("Not allowed");
  }
  return { session, studio };
}

// Stricter than assertCanManageGuests — this gates money-adjacent actions
// (adjusting/granting credits with no charge) to owner/manager only, same
// bar as the negative-balance override at check-in. Receptionists can edit
// contact info but shouldn't be able to hand out free classes.
async function assertCanAdjustCredits(studioId: number) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const studios = await getAccessibleStudios(session);
  const studio = studios.find((s) => s.id === studioId);
  if (!studio || !["owner", "manager"].includes(studio.role)) {
    throw new Error("Not allowed");
  }
  return { session, studio };
}

export async function updateGuestAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const guestId = Number(formData.get("guestId"));
  await assertCanManageGuests(studioId);

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const source = String(formData.get("source") ?? "").trim();
  const memberSince = String(formData.get("memberSince") ?? "").trim();

  if (!name) redirect(`/guests/${guestId}?error=missing_name`);
  if (memberSince && !/^\d{4}-\d{2}-\d{2}$/.test(memberSince)) {
    redirect(`/guests/${guestId}?error=invalid_member_since`);
  }

  await db
    .update(schema.guests)
    .set({
      name,
      email: email || null,
      phone: phone || null,
      notes: notes || null,
      source: source || null,
      memberSince: memberSince || null,
    })
    .where(and(eq(schema.guests.id, guestId), eq(schema.guests.studioId, studioId)));

  revalidatePath(`/guests/${guestId}`);
  revalidatePath("/guests");
  revalidatePath("/checkin");
  redirect(`/guests/${guestId}?saved=1`);
}

// Owner/manager tool to directly set how many credits remain on an
// existing pack — e.g. correcting a miscount, or backfilling a balance a
// guest already paid for elsewhere (Wix) without re-recording a sale.
// Deliberately does NOT touch revenueEntries: unlike sellMembershipAction,
// no money changes hands here, so recording revenue would double-count a
// payment that was never actually collected today. Also deliberately does
// NOT interact with the negative-balance debt-settlement logic that
// sellMembershipAction has — this is a blunt "set the number" tool, kept
// separate from the sale flow on purpose.
export async function setMembershipCreditsAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const guestId = Number(formData.get("guestId"));
  const membershipId = Number(formData.get("membershipId"));
  await assertCanAdjustCredits(studioId);

  const remainingCreditsRaw = String(formData.get("remainingCredits") ?? "").trim();
  const remainingCredits = Number(remainingCreditsRaw);
  if (remainingCreditsRaw === "" || !Number.isFinite(remainingCredits) || !Number.isInteger(remainingCredits)) {
    redirect(`/guests/${guestId}?adjustError=invalid`);
  }

  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.id, membershipId),
        eq(schema.memberships.guestId, guestId),
        eq(schema.memberships.studioId, studioId)
      )
    )
    .limit(1);
  if (!membership) redirect(`/guests/${guestId}?adjustError=invalid`);
  if (membership.type === "unlimited_monthly") redirect(`/guests/${guestId}?adjustError=invalid`);

  await db
    .update(schema.memberships)
    .set({ remainingCredits })
    .where(eq(schema.memberships.id, membershipId));

  revalidatePath(`/guests/${guestId}`);
  revalidatePath("/checkin");
  redirect(`/guests/${guestId}?adjusted=1`);
}

// Owner/manager tool to issue a brand-new complimentary pack — gifts,
// goodwill, backfilling a Wix balance as a fresh pack rather than editing
// an existing one. Same no-revenue rule as setMembershipCreditsAction
// above, and intentionally independent of STUDIO_PACKAGES (no price to
// look up — this isn't a sale, so a studio with no priced packages yet,
// like Alchemy Uluwatu, can still use this).
export async function grantCreditsAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const guestId = Number(formData.get("guestId"));
  await assertCanAdjustCredits(studioId);

  const type = String(formData.get("type") ?? "");
  if (!["drop_in", "class_pack", "unlimited_monthly"].includes(type)) {
    redirect(`/guests/${guestId}?adjustError=invalid`);
  }

  const creditsRaw = String(formData.get("credits") ?? "").trim();
  let credits: number | null = null;
  if (type !== "unlimited_monthly") {
    const parsed = Number(creditsRaw);
    if (creditsRaw === "" || !Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
      redirect(`/guests/${guestId}?adjustError=invalid`);
    }
    credits = parsed;
  }

  const validityMonthsRaw = String(formData.get("validityMonths") ?? "").trim();
  const validityMonths = validityMonthsRaw === "" ? null : Number(validityMonthsRaw);
  if (validityMonthsRaw !== "" && (!Number.isFinite(validityMonths) || Number(validityMonths) <= 0)) {
    redirect(`/guests/${guestId}?adjustError=invalid`);
  }

  const startsOn = new Date().toISOString().slice(0, 10);
  const expiresOn = validityMonths ? addMonthsToDateString(startsOn, Number(validityMonths)) : null;

  await db.insert(schema.memberships).values({
    studioId,
    guestId,
    type: type as "drop_in" | "class_pack" | "unlimited_monthly",
    totalCredits: credits,
    remainingCredits: credits,
    startsOn,
    expiresOn,
  });

  revalidatePath(`/guests/${guestId}`);
  revalidatePath("/checkin");
  redirect(`/guests/${guestId}?adjusted=1`);
}
