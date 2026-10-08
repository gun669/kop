import { notFound } from "next/navigation";
import { loadBookingByToken } from "@/lib/cancel";
import { guestHasSignedWaiver } from "@/lib/guest-links";
import { formatDayLabel, formatTimeInZone } from "@/lib/time";
import { displayFont } from "../../fonts";
import { signWaiverAction } from "./actions";

export const dynamic = "force-dynamic";

const input =
  "w-full rounded-lg border border-[#DDD5C7] bg-white px-3 py-2 text-sm text-[#52504E] placeholder:text-[#52504E]/50 focus:border-[#8C3B28] focus:outline-none";

export default async function WaiverPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ back?: string; error?: string; signed?: string }>;
}) {
  const { token } = await params;
  const { back, error, signed } = await searchParams;
  const b = await loadBookingByToken(token);
  if (!b) notFound();

  const alreadySigned = await guestHasSignedWaiver(b.studioId, b.guestId);
  const when = `${formatDayLabel(b.startsAt, b.timezone)} · ${formatTimeInZone(b.startsAt, b.timezone)}`;
  const backHref = back && back.startsWith("/book/") && !back.startsWith("//") ? back : `/book/${b.studioSlug}`;

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <p className="text-xs uppercase tracking-wider text-[#52504E]/60">{b.studioName}</p>
      <h1 className="mt-1 text-2xl text-[#52504E]" style={{ fontFamily: displayFont }}>
        Health &amp; waiver form
      </h1>
      <p className="mt-1 text-sm text-[#52504E]/70">
        For {b.classTypeName ?? "your class"} · {when}. You only need to do this once.
      </p>

      {alreadySigned ? (
        <div className="mt-6 space-y-3">
          <p className="rounded-lg bg-[#DDD5C7]/60 px-3 py-2 text-sm">
            {signed ? "Thank you — your form is signed. " : "You've already signed this form. "}
            You&apos;re all set.
          </p>
          <a href={backHref} className="inline-block text-sm text-[#8C3B28] underline underline-offset-2">
            Continue
          </a>
        </div>
      ) : (
        <form action={signWaiverAction} className="mt-6 space-y-3">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="back" value={back ?? ""} />
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              Please type your full name and tick the box to agree.
            </p>
          )}
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Injuries, conditions or pregnancy we should know about</span>
            <textarea name="healthNotes" rows={3} placeholder="Optional" className={input} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Emergency contact (name &amp; phone)</span>
            <input name="emergencyContact" placeholder="Optional" className={input} />
          </label>
          <div className="rounded-lg border border-[#DDD5C7] bg-white p-3 text-xs leading-relaxed text-[#52504E]/80">
            I understand that yoga and pilates involve physical movement and carry a risk of injury. I confirm I am
            in good enough health to take part, I will listen to my body and tell the teacher about any discomfort,
            and I take responsibility for my own participation.
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="agree" required className="mt-0.5" />
            <span>I have read and agree to the above.</span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Type your full name to sign</span>
            <input name="signedName" required defaultValue="" placeholder={b.guestName} className={input} />
          </label>
          <button className="w-full rounded-lg border border-[#8C3B28] bg-[#8C3B28] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#7a3222]">
            Sign &amp; continue
          </button>
        </form>
      )}
    </main>
  );
}
