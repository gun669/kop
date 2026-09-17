"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { bookGuestForSession } from "@/lib/booking";
import { packageByKey } from "@/lib/packages";
import { isIyzicoConfigured, initializeCheckoutForm } from "@/lib/iyzico";
import { normalizePhone } from "@/lib/phone";

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
    })
    .from(schema.classSessions)
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

  const result = await bookGuestForSession({
    studioId: studio.id,
    classSessionId,
    name,
    phone,
  });

  if (!result.ok) {
    redirect(backTo({ error: result.reason }));
  }

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
  if (isIyzicoConfigured()) {
    const dropIn = packageByKey(studio.slug, "drop_in");
    if (dropIn) {
      try {
        const hdrs = await headers();
        const origin = hdrs.get("origin") ?? `https://${hdrs.get("host")}`;
        const conversationId = `booking-${result.bookingId}-${Date.now()}`;
        const normalizedPhone = normalizePhone(phone) || "5000000000";

        const init = await initializeCheckoutForm({
          conversationId,
          price: dropIn.price.toFixed(2),
          currency: (studio.currency as "TRY" | "USD" | "EUR") ?? "TRY",
          basketId: `booking-${result.bookingId}`,
          callbackUrl: `${origin}/api/iyzico/callback`,
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
              price: dropIn.price.toFixed(2),
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
          amount: String(dropIn.price),
          currency: studio.currency,
          status: init.status === "success" ? "pending" : "failed",
          rawResponse: JSON.stringify(init).slice(0, 8000),
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

  if (paymentRedirectUrl) redirect(paymentRedirectUrl);
  redirect(backTo({ confirmed: String(classSessionId) }));
}
