"use server";

import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";

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

  await db.transaction(async (tx) => {
    const [guest] = await tx
      .insert(schema.guests)
      .values({ studioId, name, phone: phone || null })
      .returning();

    await tx.insert(schema.signIns).values({
      studioId,
      classSessionId,
      guestId: guest.id,
      status: "attended",
      checkedInByUserId: session.userId,
    });
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
