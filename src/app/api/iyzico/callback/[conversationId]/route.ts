// Iyzico's own docs say this gets a POST with `token` as a form field once
// a guest finishes (or abandons) the hosted Checkout Form. Real-world
// testing (Oct 3, 2026 — Gün's first live sandbox payment, including the
// 3-D Secure/OTP step) showed two problems with trusting that: (1) the
// actual redirect landed as a GET, not a POST (fixed by handling both —
// see the git history on this file); and (2) even after that fix, the real
// redirect carried no token anywhere — not a query param, not a form
// field. Iyzico's docs don't match Iyzico's actual sandbox behavior here.
//
// The robust fix (confirmed against a real third-party Iyzico integration
// example, since Iyzico's own docs can't be trusted for this): never rely
// on Iyzico echoing the token back at all. We already know our own token
// — we saved it to the payments row at initializeCheckoutForm() time (see
// bookSessionAction in src/app/book/[slug]/actions.ts). So instead this
// route is keyed by conversationId, embedded directly in the callbackUrl's
// path segment we handed to Iyzico, and we look up the already-known
// token ourselves — regardless of what the callback request's method or
// body actually looks like.
//
// This route is under /api, so it's outside the auth middleware's matcher
// entirely — see middleware.ts — and outside PUBLIC_PATHS is fine too
// since /api is already excluded there.
//
// Never trusts the callback for payment status either way — it calls
// Iyzico's own retrieve endpoint server-to-server to confirm what actually
// happened (see src/lib/iyzico.ts), same principle as bookSessionAction
// re-verifying the class session from the database rather than the form.
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { retrieveCheckoutForm, checkoutFormWasSuccessful } from "@/lib/iyzico";
import { addMonthsToDateString } from "@/lib/packages";
import { localDateKey } from "@/lib/time";
import { sendBookingConfirmationEmail } from "@/lib/email";

async function handleCallback(req: NextRequest, conversationId: string) {
  // No slug known yet at this point — if conversationId itself is missing
  // or we can't find a payment for it, there's nothing to key a
  // /book/[slug] redirect off, so these two early-outs fall back to the
  // slug-less /book page (see src/app/book/page.tsx) rather than 404ing.
  if (!conversationId) {
    return NextResponse.redirect(new URL("/book?error=payment_missing_token", req.url));
  }

  const [payment] = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.providerConversationId, conversationId))
    .limit(1);

  if (!payment || !payment.providerToken) {
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

  // Use the token we already saved at initialize time — never depend on
  // Iyzico sending it back to us in the callback.
  const result = await retrieveCheckoutForm(payment.providerToken, conversationId);
  const success = checkoutFormWasSuccessful(result);

  await db
    .update(schema.payments)
    .set({
      status: success ? "success" : "failed",
      providerPaymentId: result.paymentId ?? null,
      rawResponse: JSON.stringify(result).slice(0, 8000),
    })
    .where(eq(schema.payments.id, payment.id));

  // Find the booking's class session (plus enough detail for a
  // confirmation email) so we can send the guest back to the right day on
  // the public booking page either way.
  const [booking] = payment.bookingId
    ? await db
        .select({
          classSessionId: schema.bookings.classSessionId,
          startsAt: schema.classSessions.startsAt,
          room: schema.classSessions.room,
          classTypeName: schema.classTypes.name,
          teacherName: schema.teachers.name,
        })
        .from(schema.bookings)
        .innerJoin(schema.classSessions, eq(schema.bookings.classSessionId, schema.classSessions.id))
        .leftJoin(schema.classTypes, eq(schema.classSessions.classTypeId, schema.classTypes.id))
        .leftJoin(schema.teachers, eq(schema.classSessions.teacherId, schema.teachers.id))
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

    // Confirmation email — only now, after the payment is actually
    // confirmed server-to-server and the credit's been granted. Never sent
    // from bookSessionAction itself for a paid booking (the guest hasn't
    // reached Iyzico's checkout yet at that point).
    if (booking) {
      const [guest] = await db
        .select({ email: schema.guests.email, name: schema.guests.name })
        .from(schema.guests)
        .where(eq(schema.guests.id, payment.guestId))
        .limit(1);
      if (guest?.email) {
        await sendBookingConfirmationEmail({
          to: guest.email,
          guestName: guest.name,
          class: {
            studioName: studio.name,
            classTypeName: booking.classTypeName,
            teacherName: booking.teacherName,
            room: booking.room,
            startsAt: booking.startsAt,
            timezone: studio.timezone,
          },
          paid: { amount: payment.amount, currency: payment.currency ?? studio.currency },
        });
      }
    }
  }

  bookUrl.searchParams.set("paid", "1");
  if (booking) bookUrl.searchParams.set("confirmed", String(booking.classSessionId));
  return NextResponse.redirect(bookUrl);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  return handleCallback(req, conversationId);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  return handleCallback(req, conversationId);
}
