"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";

// Only the super owner (Gün) ever sees this page or can call this action —
// it deletes real rows across every studio at once, deliberately not
// scoped to whichever studio happens to be selected.
const KEEP_EMAIL = "gursoygun@gmail.com";

export async function runCleanupAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.isSuperOwner) redirect("/dashboard");

  const confirmText = String(formData.get("confirmText") ?? "").trim();
  if (confirmText !== "DELETE") {
    redirect("/admin/cleanup?error=confirm");
  }

  const teacherIds = formData
    .getAll("teacherIds")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
  const classTypeIds = formData
    .getAll("classTypeIds")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
  const userIds = formData
    .getAll("userIds")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);

  const clearGuests = formData.get("clearGuests") === "on";
  const clearSchedule = formData.get("clearSchedule") === "on";
  const clearMoney = formData.get("clearMoney") === "on";

  // Each of these is a root delete — the schema's own onDelete
  // cascade/set-null rules take care of dependent rows (bookings,
  // sign-ins, memberships, template slots) automatically.
  if (clearGuests) {
    await db.delete(schema.guests);
  }
  if (clearSchedule) {
    await db.delete(schema.classSessions);
    await db.delete(schema.scheduleTemplates);
  }
  if (clearMoney) {
    await db.delete(schema.expenses);
    await db.delete(schema.revenueEntries);
  }
  if (teacherIds.length) {
    await db.delete(schema.teachers).where(inArray(schema.teachers.id, teacherIds));
  }
  if (classTypeIds.length) {
    await db.delete(schema.classTypes).where(inArray(schema.classTypes.id, classTypeIds));
  }
  if (userIds.length) {
    await db
      .delete(schema.users)
      .where(and(inArray(schema.users.id, userIds), ne(schema.users.email, KEEP_EMAIL)));
  }

  revalidatePath("/admin/cleanup");
  redirect("/admin/cleanup?done=1");
}
