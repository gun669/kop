"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { bookGuestForSession } from "@/lib/booking";
import { packageByKey } from "@/lib/packages";
import { isIyzicoConfigured, initializeCheckoutForm } from "@/lib/iyzico";
import { normalizePhone } from "@/lib/phone";
import { sendBookingConfirmationEmail } from "@/lib/email";
import { findValidCoupon, applyCoupon, redeemCoupon, normalizeCouponCode } from "@/lib/coupons";
import { buildGuestLinks } from "@/lib/guest-links";
import { addMonthsToDateString } from "@/lib/packages";
import { localDateKey } from "@/lib/time";

// Public server action behind the guest-facing booking page — no session,
// no studio-access check like the internal app has, since anyone with the
// studio's link is meant to be able to use this. Every input is re-verified
// against the database rather than trusted from the submitted form: the
// studio slug resolves to a real studio, and the class session has to
// actually belong to that studio and still be a live, future, scheduled
// class before bookGuestForSession() is even called.
export async function bookSessionAction(formData: FormData) {
  const slug = String(formData.get("slug") ?? "");
  const classSessionId = Number(formData.get("classSessionId"));
  const day = String(formData.get("day") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const couponCode = normalizeCouponCode(String(formData.get("coupon") ?? ""));

  const backTo = (params: Record<string, string>) => {
    const qs = new URLSearchParams({ day, ...params });
    return `/book/${slug}?${qs.toString()}`;
  };

  if (!slug || !classSessionId || !name || !phone) {
    redirect(backTo({ error: "missing" }));
  }

  const [studio] = await db
    .select()
    .from(schema.studios)
    .where(eq(schema.studios.slug, slug))
    .limit(1);
  if (!studio) redirect("/book");

  const [sessionRow] = await db
    .select({
      id: schema.classSessions.id,
      studioId: schema.classSessions.studioId,
      status: schema.classSessions.status,
      startsAt: schema.classSessions.startsAt,
      room: schema.classSessions.room,
      classTypeName: schema.classTypes.name,
      teacherName: schema.teachers.name,
    })
    .from(schema.classSessions)
    .leftJoin(schema.classTypes, eq(schema.classSessions.classTypeId, schema.classTypes.id))
    .leftJoin(schema.teachers, eq(schema.classSessions.teacherId, schema.teachers.id))
    .where(eq(schema.classSessions.id, classSessionId))
    .limit(1);

  if (
    !sessionRow ||
    sessionRow.studioId !== studio.id ||
    sessionRow.status !== "scheduled" ||
    sessionRow.startsAt.getTime() <= Date.now()
  ) {
    redirect(backTo({ error: "unavailable" }));
  }

  // Coupon codes only discount the online drop-in price, so check up front
  // (before a spot is reserved) that one was asked for, is valid, and that
  // this studio can actually charge online. A bad code sends the guest back
  // to fix it instead of silently booking at full price.
  const dropInPackage = isIyzicoConfigured() ? packageByKey(studio.slug, "drop_in") : null;
  let coupon: Awaited<ReturnType<typeof findValidCoupon>> | null = null;
  if (couponCode) {
    if (!dropInPackage) redirect(backTo({ error: "coupon_na" }));
    coupon = await findValidCoupon(studio.id, couponCode, localDateKey(new Date(), studio.timezone));
    if (!coupon.ok) redirect(backTo({ error: coupon.reason }));
  }

  const result = await bookGuestForSession({
    studioId: studio.id,
    classSessionId,
    name,
    phone,
    email,
  });

  if (!result.ok) {
    redirect(backTo({ error: result.reason }));
  }

  // Effective email for a confirmation — whatever's now on the guest's
  // record (just-typed this time, or already on file from a previous
  // booking/import). A fresh select rather than threading it back through
  // bookGuestForSession's result, since most callers don't need it.
  const [guestForEmail] = await db
    .select({ email: schema.guests.email })
    .from(schema.guests)
    .where(eq(schema.guests.id, result.guestId))
    .limit(1);

  // Real Iyzico payment collection (Launch Path p4) — deliberately
  // additive and fail-open: if Iyzico isn't configured (no live/sandbox
  // credentials yet — see the build log), or this studio has no drop-in
  // price set (STUDIO_PACKAGES in src/lib/packages.ts), or the call to
  // Iyzico itself fails for any reason, the booking still succeeds and
  // behaves exactly as it does today — pay at the studio. A guest's spot
  // is never lost because a payment call had a problem. This is also why
  // this whole block ships on its own branch rather than straight to
  // main: until real sandbox credentials exist to actually exercise it,
  // it's unverified against Iyzico's real API, even though it's inert
  // (IYZICO_API_KEY unset) on every environment that currently runs.
  let paymentRedirectUrl: string | null = null;
  let couponFullyCovered = false;
  if (dropInPackage) {
    const dropIn = dropInPackage;
    if (dropIn) {
      const priced = coupon && coupon.ok ? applyCoupon(dropIn.price, coupon.coupon) : null;
      const chargePrice = priced ? priced.finalPrice : dropIn.price;
      const couponFields =
        priced && coupon && coupon.ok
          ? { couponId: coupon.coupon.id, discountAmount: priced.discount.toFixed(2) }
          : {};

      if (priced && chargePrice <= 0 && coupon && coupon.ok) {
        // 100%-off coupon: nothing to charge, so skip Iyzico entirely and
        // grant the drop-in directly. The use is only counted if it was
        // still available (guards the last-use race).
        if (await redeemCoupon(coupon.coupon.id)) {
          const todayKey = localDateKey(new Date(), studio.timezone);
          await db.transaction(async (tx) => {
            const [membership] = await tx
              .insert(schema.memberships)
              .values({
                studioId: studio.id,
                guestId: result.guestId,
                type: "drop_in",
                totalCredits: 1,
                remainingCredits: 1,
                startsOn: todayKey,
                expiresOn: addMonthsToDateString(todayKey, 1),
              })
              .returning();
            await tx.insert(schema.payments).values({
              studioId: studio.id,
              guestId: result.guestId,
              bookingId: result.bookingId,
              membershipId: membership.id,
              purpose: "booking",
              provider: "coupon",
              amount: "0.00",
              currency: studio.currency,
              status: "success",
              ...couponFields,
            });
          });
          couponFullyCovered = true;
        }
      } else {
      try {
        const hdrs = await headers();
        const origin = hdrs.get("origin") ?? `https://${hdrs.get("host")}`;
        const conversationId = `booking-${result.bookingId}-${Date.now()}`;
        const normalizedPhone = normalizePhone(phone) || "5000000000";

        const init = await initializeCheckoutForm({
          conversationId,
          price: chargePrice.toFixed(2),
          currency: (studio.currency as "TRY" | "USD" | "EUR") ?? "TRY",
          basketId: `booking-${result.bookingId}`,
          // Embedding conversationId in the path, not relying on Iyzico to
          // echo the token back to us — see the callback route's own
          // comment for why (Oct 3, 2026 sandbox test: Iyzico's real
          // redirect carried no token anywhere, despite their docs).
          callbackUrl: `${origin}/api/iyzico/callback/${conversationId}`,
          buyer: {
            id: String(result.guestId),
            name: name.split(" ")[0] || name,
            surname: name.split(" ").slice(1).join(" ") || name,
            // Iyzico's own validation rejects the RFC 2606 "never real"
            // TLD (.invalid) as a malformed email -- found Sep 17, 2026
            // via the diagnostic logging below (errorCode 5, "email is
            // invalid"). A plain .com-shaped placeholder passes their
            // format check; nothing ever actually sends mail here.
            email: `guest${result.guestId}@guests.${slug}.kop-booking-placeholder.com`,
            phone: normalizedPhone.startsWith("+") ? normalizedPhone : `+${normalizedPhone}`,
            // Iyzico requires an identity number; real bookings today don't
            // collect one from the guest, so this uses Iyzico's own
            // documented placeholder for buyers without a TC number on
            // file. Worth revisiting with Gün before this goes fully live.
            identityNumber: "11111111111",
            city: studio.city ?? "Istanbul",
            country: "Turkey",
            address: studio.city ?? "Istanbul",
          },
          basketItems: [
            {
              id: `session-${classSessionId}`,
              name: dropIn.label,
              category: "Class",
              price: chargePrice.toFixed(2),
            },
          ],
        });

        await db.insert(schema.payments).values({
          studioId: studio.id,
          guestId: result.guestId,
          bookingId: result.bookingId,
          purpose: "booking",
          provider: "iyzico",
          providerConversationId: conversationId,
          providerToken: init.token ?? null,
          amount: chargePrice.toFixed(2),
          currency: studio.currency,
          status: init.status === "success" ? "pending" : "failed",
          rawResponse: JSON.stringify(init).slice(0, 8000),
          ...couponFields,
        });

        if (init.status === "success" && init.paymentPageUrl) {
          paymentRedirectUrl = init.paymentPageUrl;
        } else {
          // TEMPORARY diagnostic logging (Sep 16, 2026) -- to see why a
          // request that no longer ECONNRESETs still isn't producing a
          // paymentPageUrl, without needing a data-reading endpoint.
          // Remove once the Iyzico flow is confirmed working end to end.
          console.error("Iyzico checkout initialize did not yield a paymentPageUrl", {
            status: init.status,
            errorCode: init.errorCode,
            errorMessage: init.errorMessage,
            hasToken: Boolean(init.token),
          });
        }
        // Iyzico rejected the initialize call itself (bad request, account
        // issue, etc.) — fall through to the normal pay-at-studio
        // confirmation rather than stranding the guest with an error.
      } catch (err) {
        // Deliberately caught here (not just left to bubble) so a real
        // Iyzico/network failure never costs the guest their booking —
        // redirect() itself is called outside this try/catch below, so
        // it can never be accidentally swallowed by this catch.
        console.error("Iyzico checkout initialize failed", err);
      }
      }
    }
  }

  if (paymentRedirectUrl) redirect(paymentRedirectUrl);

  // Confirmation email — only for the free / pay-at-studio path. A paid
  // booking's confirmation is sent from the Iyzico callback route instead,
  // once the payment has actually been confirmed server-to-server (never
  // here, before the guest has even reached the checkout page).
  const hdrs2 = await headers();
  const links = await buildGuestLinks({
    bookingId: result.bookingId,
    studioId: studio.id,
    guestId: result.guestId,
    origin: hdrs2.get("origin") ?? `https://${hdrs2.get("host")}`,
  });

  if (guestForEmail?.email) {
    await sendBookingConfirmationEmail({
      to: guestForEmail.email,
      guestName: name,
      class: {
        studioName: studio.name,
        classTypeName: sessionRow.classTypeName,
        teacherName: sessionRow.teacherName,
        room: sessionRow.room,
        startsAt: sessionRow.startsAt,
        timezone: studio.timezone,
      },
      cancelUrl: links.cancelUrl,
      waiverUrl: links.waiverUrl,
      cancelWindowHours: studio.cancelWindowHours,
    });
  }

  const confirmedUrl = backTo({ confirmed: String(classSessionId), ...(couponFullyCovered ? { paid: "1" } : {}) });
  // First booking ever for this guest: send them to the one-time waiver,
  // then back to the confirmation.
  if (links.needsWaiver) {
    redirect(`/book/waiver/${links.token}?back=${encodeURIComponent(confirmedUrl)}`);
  }
  redirect(confirmedUrl);
}
