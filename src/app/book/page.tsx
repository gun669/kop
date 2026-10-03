// Fallback for the (rare) case where a redirect needs to send a guest back
// to booking but has no studio slug to work with — e.g. the Iyzico
// callback route (see src/app/api/iyzico/callback/[conversationId]/route.ts)
// got a conversationId it can't match to any payment row at all, so it has
// no studio to resolve /book/[slug] from. Every other redirect in the app
// always has a slug by this point; this page exists purely so that edge
// case 404s gracefully instead of hitting Next's generic 404 page.
import { bodyFont, displayFont } from "./fonts";

const ERROR_MESSAGES: Record<string, string> = {
  payment_missing_token: "Something went wrong confirming your payment — please check with the studio about your booking.",
  payment_not_found: "We couldn't find that payment — please check with the studio about your booking.",
};

export default async function BookingFallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = (error && ERROR_MESSAGES[error]) || "This booking link is missing a studio — please use the link your studio gave you.";

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12" style={{ fontFamily: bodyFont }}>
      <h1
        className="text-2xl font-medium text-[#52504E] sm:text-3xl"
        style={{ fontFamily: displayFont }}
      >
        We couldn't find that booking page
      </h1>
      <p className="mt-3 text-sm text-[#52504E]">{message}</p>
    </div>
  );
}
