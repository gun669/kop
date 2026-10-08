import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export type Coupon = typeof schema.coupons.$inferSelect;

export function normalizeCouponCode(raw: string) {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export type CouponLookup =
  | { ok: true; coupon: Coupon }
  | { ok: false; reason: "coupon_invalid" | "coupon_expired" | "coupon_used_up" };

// `todayKey` is the studio-local YYYY-MM-DD (expiry is inclusive: a coupon
// that expires on the 10th still works all day on the 10th).
export async function findValidCoupon(
  studioId: number,
  rawCode: string,
  todayKey: string
): Promise<CouponLookup> {
  const code = normalizeCouponCode(rawCode);
  if (!code) return { ok: false, reason: "coupon_invalid" };
  const [coupon] = await db
    .select()
    .from(schema.coupons)
    .where(and(eq(schema.coupons.studioId, studioId), eq(schema.coupons.code, code)))
    .limit(1);
  if (!coupon || !coupon.active) return { ok: false, reason: "coupon_invalid" };
  if (coupon.expiresOn && coupon.expiresOn < todayKey) return { ok: false, reason: "coupon_expired" };
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses)
    return { ok: false, reason: "coupon_used_up" };
  return { ok: true, coupon };
}

export function applyCoupon(price: number, coupon: Coupon) {
  const value = Number(coupon.value);
  const raw = coupon.discountType === "percent" ? (price * value) / 100 : value;
  const discount = Math.min(price, Math.max(0, Math.round(raw * 100) / 100));
  return { discount, finalPrice: Math.round((price - discount) * 100) / 100 };
}

// Counts one use, but only if the coupon still has uses left — so two
// guests racing for the last use can't both get it. Returns whether the use
// was counted.
export async function redeemCoupon(couponId: number) {
  const rows = await db
    .update(schema.coupons)
    .set({ usedCount: sql`${schema.coupons.usedCount} + 1` })
    .where(
      and(
        eq(schema.coupons.id, couponId),
        or(isNull(schema.coupons.maxUses), lt(schema.coupons.usedCount, schema.coupons.maxUses))
      )
    )
    .returning({ id: schema.coupons.id });
  return rows.length > 0;
}

export function describeCoupon(c: Pick<Coupon, "discountType" | "value">, currency: string) {
  const v = Number(c.value);
  return c.discountType === "percent" ? `${v}% off` : `${v.toLocaleString()} ${currency} off`;
}
