// Iyzico posts here (application/x-www-form-urlencoded, a `token` field)
// once a guest finishes (or abandons) the hosted Checkout Form. This route
// is under /api, so it's outside the auth middleware's matcher entirely —
// see middleware.ts — and outside PUBLIC_PATHS is fine too since /api is
// already excluded there.
//
// Never trusts the callback body for payment status — it calls Iyzico's
// own retrieve endpoint server-to-server to confirm what actually
// happened (see src/lib/iyzico.ts), same principle as bookSessionAction
// re-verifying the class session from the database rather than the form.
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { retrieveCheckoutForm, checkoutFormWasSuccessful } from "@/lib/iyzico";
import { addMonthsToDateString } from "@/lib/packages";
import { localDateKey } from "@/lib/time";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");

  if (!token) {
    return NextResponse.redirect(new URL("/book?error=payment_missing_token", req.url));
  }

  const [payment] = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.providerToken, token))
    .limit(1);

  if (!payment) {
    return NextResponse.redirect(new URL("/book?error=payment_not_found", req.url));
  }

  const [studio] = await db
    .select()
    .from(schema.studios)
    .where(eq(schema.studios.id, payment.studioId))
    .limit(1);
  if (!studio) {
    return NextResponse.redirect(new URL("/book?error=payment_not_found", req.url));
  }

  const result = await retrieveCheckoutForm(token, payment.providerConversationId ?? undefined);
  const success = checkoutFormWasSuccessful(result);

  await db
    .update(schema.payments)
    .set({
      status: success ? "success" : "failed",
      providerPaymentId: result.paymentId ?? null,
      rawResponse: JSON.stringify(result).slice(0, 8000),
    })
    .where(eq(schema.payments.id, payment.id));

  // Find the booking's class session so we can send the guest back to the
  // right day on the public booking page either way.
  const [booking] = payment.bookingId
    ? await db
        .select({ classSessionId: schema.bookings.classSessionId })
        .from(schema.bookings)
        .where(eq(schema.bookings.id, payment.bookingId))
        .limit(1)
    : [];

  // Slug is needed to build the redirect — resolve it from the studio row
  // already fetched above rather than trusting anything in the callback.
  const bookUrl = new URL(`/book/${studio.slug}`, req.url);

  if (!success) {
    bookUrl.searchParams.set("error", "payment_failed");
    if (booking) bookUrl.searchParams.set("confirmed", String(booking.classSessionId));
    return NextResponse.redirect(bookUrl);
  }

  // Payment succeeded — actually sell the guest a drop-in so the booking
  // becomes a real paid visit, using the studio's own real drop-in price
  // (never the amount from the callback body) for both the membership and
  // the revenue entry, same "write both sides" pattern as
  // sellMembershipAction. This deliberately duplicates a little of that
  // logic rather than importing a server action from another route
  // segment.
  if (payment.guestId) {
    const todayKey = localDateKey(new Date(), studio.timezone);
    await db.transaction(async (tx) => {
      const [membership] = await tx
        .insert(schema.memberships)
        .values({
          studioId: studio.id,
          guestId: payment.guestId!,
          type: "drop_in",
          totalCredits: 1,
          remainingCredits: 1,
          startsOn: todayKey,
          expiresOn: addMonthsToDateString(todayKey, 1),
        })
        .returning();

      await tx.insert(schema.revenueEntries).values({
        studioId: studio.id,
        source: "drop_in",
        amount: payment.amount,
        note: "Drop-in — paid online via Iyzico at booking",
        guestId: payment.guestId!,
        occurredOn: todayKey,
      });

      await tx
        .update(schema.payments)
        .set({ membershipId: membership.id })
        .where(eq(schema.payments.id, payment.id));
    });
  }

  bookUrl.searchParams.set("paid", "1");
  if (booking) bookUrl.searchParams.set("confirmed", String(booking.classSessionId));
  return NextResponse.redirect(bookUrl);
}
