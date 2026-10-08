import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";

// Public site origin used when building links inside emails (cancel link,
// waiver link). Prefers an explicit APP_BASE_URL, then Vercel's own
// production/preview hostnames. `fallbackOrigin` is the request's origin
// when the caller has one.
export function appBaseUrl(fallbackOrigin?: string | null) {
  const explicit = process.env.APP_BASE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  if (fallbackOrigin) return fallbackOrigin.replace(/\/$/, "");
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return host ? `https://${host}` : "http://localhost:3000";
}

function newToken() {
  return randomBytes(24).toString("base64url");
}

// Returns the booking's cancel token, creating one if the booking predates
// the column (or was just created). Safe to call repeatedly.
export async function ensureCancelToken(bookingId: number): Promise<string> {
  const [row] = await db
    .select({ token: schema.bookings.cancelToken })
    .from(schema.bookings)
    .where(eq(schema.bookings.id, bookingId))
    .limit(1);
  if (row?.token) return row.token;
  const token = newToken();
  // `isNull` guard so two concurrent callers can't overwrite each other.
  await db
    .update(schema.bookings)
    .set({ cancelToken: token })
    .where(and(eq(schema.bookings.id, bookingId), isNull(schema.bookings.cancelToken)));
  const [after] = await db
    .select({ token: schema.bookings.cancelToken })
    .from(schema.bookings)
    .where(eq(schema.bookings.id, bookingId))
    .limit(1);
  return after!.token!;
}

export async function guestHasSignedWaiver(studioId: number, guestId: number) {
  const [row] = await db
    .select({ id: schema.guestWaivers.id })
    .from(schema.guestWaivers)
    .where(and(eq(schema.guestWaivers.studioId, studioId), eq(schema.guestWaivers.guestId, guestId)))
    .limit(1);
  return Boolean(row);
}

// Everything an email needs to link a guest to their own booking.
export async function buildGuestLinks(params: {
  bookingId: number;
  studioId: number;
  guestId: number;
  origin?: string | null;
}) {
  const token = await ensureCancelToken(params.bookingId);
  const base = appBaseUrl(params.origin);
  const signed = await guestHasSignedWaiver(params.studioId, params.guestId);
  return {
    token,
    cancelUrl: `${base}/book/cancel/${token}`,
    waiverUrl: signed ? undefined : `${base}/book/waiver/${token}`,
    needsWaiver: !signed,
  };
}
