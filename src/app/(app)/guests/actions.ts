"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";

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

export async function updateGuestAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const guestId = Number(formData.get("guestId"));
  await assertCanManageGuests(studioId);

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!name) redirect(`/guests/${guestId}?error=missing_name`);

  await db
    .update(schema.guests)
    .set({
      name,
      email: email || null,
      phone: phone || null,
      notes: notes || null,
    })
    .where(and(eq(schema.guests.id, guestId), eq(schema.guests.studioId, studioId)));

  revalidatePath(`/guests/${guestId}`);
  revalidatePath("/guests");
  revalidatePath("/checkin");
  redirect(`/guests/${guestId}?saved=1`);
}
