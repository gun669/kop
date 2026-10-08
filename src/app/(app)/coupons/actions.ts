"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";
import { normalizeCouponCode } from "@/lib/coupons";

// Coupons change what guests pay, so — like bills and reports — this is an
// owner/manager job.
async function assertCanManageCoupons(studioId: number) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const studios = await getAccessibleStudios(session);
  const studio = studios.find((s) => s.id === studioId);
  if (!studio || !["owner", "manager"].includes(studio.role)) {
    throw new Error("Not allowed");
  }
  return studio;
}

export async function createCouponAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  await assertCanManageCoupons(studioId);

  const code = normalizeCouponCode(String(formData.get("code") ?? ""));
  const discountType = String(formData.get("discountType")) === "fixed" ? "fixed" : "percent";
  const value = Number(formData.get("value"));
  const expiresOn = String(formData.get("expiresOn") ?? "").trim();
  const maxUsesRaw = String(formData.get("maxUses") ?? "").trim();
  const maxUses = maxUsesRaw ? Math.floor(Number(maxUsesRaw)) : null;

  const fail = (msg: string) => {
    throw new Error(msg);
  };
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) fail("Code must be 3–40 letters, numbers, - or _");
  if (!Number.isFinite(value) || value <= 0) fail("Discount must be greater than 0");
  if (discountType === "percent" && value > 100) fail("Percent discount can't exceed 100");
  if (maxUses !== null && (!Number.isFinite(maxUses) || maxUses < 1)) fail("Max uses must be 1 or more");
  if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) fail("Bad expiry date");

  const [existing] = await db
    .select({ id: schema.coupons.id })
    .from(schema.coupons)
    .where(and(eq(schema.coupons.studioId, studioId), eq(schema.coupons.code, code)))
    .limit(1);
  if (existing) fail(`A coupon with code ${code} already exists`);

  await db.insert(schema.coupons).values({
    studioId,
    code,
    discountType,
    value: value.toFixed(2),
    expiresOn: expiresOn || null,
    maxUses,
  });
  revalidatePath("/coupons");
}

export async function toggleCouponAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const couponId = Number(formData.get("couponId"));
  await assertCanManageCoupons(studioId);
  const [c] = await db
    .select()
    .from(schema.coupons)
    .where(and(eq(schema.coupons.id, couponId), eq(schema.coupons.studioId, studioId)))
    .limit(1);
  if (!c) throw new Error("Coupon not found");
  await db.update(schema.coupons).set({ active: !c.active }).where(eq(schema.coupons.id, c.id));
  revalidatePath("/coupons");
}
