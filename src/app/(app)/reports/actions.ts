"use server";

import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";

// Same boundary as /money — reports (and who's allowed to set what a
// teacher gets paid) are an owner/manager job, not front-desk or teacher.
async function assertCanManageReports(studioId: number) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const studios = await getAccessibleStudios(session);
  const studio = studios.find((s) => s.id === studioId);
  if (!studio || !["owner", "manager"].includes(studio.role)) {
    throw new Error("Not allowed");
  }
  return { session, studio };
}

const PAY_RATE_TYPES = ["per_class", "per_head", "salary"];

// teachers.payRateType/payRate have existed in the schema since the
// beginning but were never actually settable anywhere in the app — this is
// the first UI that exposes them, so the payroll report below has real
// numbers to compute from instead of just showing "no rate set" forever.
export async function setTeacherPayRateAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const teacherId = Number(formData.get("teacherId"));
  const payRateType = String(formData.get("payRateType") ?? "per_class");
  const payRateRaw = String(formData.get("payRate") ?? "").trim();

  await assertCanManageReports(studioId);

  if (!PAY_RATE_TYPES.includes(payRateType)) {
    throw new Error("Invalid pay rate type");
  }

  await db
    .update(schema.teachers)
    .set({
      payRateType,
      payRate: payRateRaw === "" ? null : payRateRaw,
    })
    .where(and(eq(schema.teachers.id, teacherId), eq(schema.teachers.studioId, studioId)));

  revalidatePath("/reports");
}
