"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

// Launch Path b14: lets a manager hand the current revenue/expenses report
// to someone with no KOP login (an accountant, a co-owner) via a link
// instead of giving them full access. Deliberately narrow — one fixed
// period, one report type (P&L) — rather than a general "share my whole
// account" mechanism.
export async function createReportShareLinkAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");

  const { session } = await assertCanManageReports(studioId);

  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new Error("Invalid date range");
  }

  const token = crypto.randomBytes(24).toString("hex");

  await db.insert(schema.reportShareLinks).values({
    studioId,
    token,
    reportType: "pnl",
    periodFrom: from,
    periodTo: to,
    createdByUserId: session.userId,
  });

  revalidatePath("/reports");
}

// Revoking just flips a flag — the link's row (and its own history of ever
// having existed) stays, but the route 404s on it from the next request
// on, immediately, with nothing further for Claude or Gün to rotate.
export async function revokeReportShareLinkAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const linkId = Number(formData.get("linkId"));

  await assertCanManageReports(studioId);

  await db
    .update(schema.reportShareLinks)
    .set({ revoked: true })
    .where(and(eq(schema.reportShareLinks.id, linkId), eq(schema.reportShareLinks.studioId, studioId)));

  revalidatePath("/reports");
}
