"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { loadBookingByToken } from "@/lib/cancel";

// Public (token-gated) action: records the guest's one-time waiver / health
// form. Idempotent — a second submission for the same guest leaves the
// original signature in place.
export async function signWaiverAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const back = String(formData.get("back") ?? "");
  const signedName = String(formData.get("signedName") ?? "").trim();
  const healthNotes = String(formData.get("healthNotes") ?? "").trim();
  const emergencyContact = String(formData.get("emergencyContact") ?? "").trim();
  const agreed = formData.get("agree") === "on";

  const safeBack = back.startsWith("/book/") && !back.startsWith("//") ? back : "";
  const here = `/book/waiver/${encodeURIComponent(token)}`;
  const withBack = (qs: string) => `${here}?${qs}${safeBack ? `&back=${encodeURIComponent(safeBack)}` : ""}`;

  const b = await loadBookingByToken(token);
  if (!b) redirect("/book");
  if (!signedName || !agreed) redirect(withBack("error=missing"));

  const [existing] = await db
    .select({ id: schema.guestWaivers.id })
    .from(schema.guestWaivers)
    .where(and(eq(schema.guestWaivers.studioId, b.studioId), eq(schema.guestWaivers.guestId, b.guestId)))
    .limit(1);
  if (!existing) {
    await db
      .insert(schema.guestWaivers)
      .values({
        studioId: b.studioId,
        guestId: b.guestId,
        signedName: signedName.slice(0, 120),
        healthNotes: healthNotes ? healthNotes.slice(0, 2000) : null,
        emergencyContact: emergencyContact ? emergencyContact.slice(0, 200) : null,
      })
      .onConflictDoNothing();
  }

  redirect(safeBack || `${here}?signed=1`);
}
