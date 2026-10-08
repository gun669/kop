import { notFound } from "next/navigation";
import { loadBookingByToken, cancelState } from "@/lib/cancel";
import { formatDayLabel, formatTimeInZone } from "@/lib/time";
import { displayFont } from "../../fonts";
import { cancelBookingAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CancelBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; late?: string; credit?: string; error?: string }>;
}) {
  const { token } = await params;
  const { done, late, credit, error } = await searchParams;
  const b = await loadBookingByToken(token);
  if (!b) notFound();

  const when = `${formatDayLabel(b.startsAt, b.timezone)} · ${formatTimeInZone(b.startsAt, b.timezone)}`;
  const classLabel = [b.classTypeName ?? "Class", b.teacherName].filter(Boolean).join(" with ");
  const state = cancelState(b.startsAt, b.cancelWindowHours);
  const active = b.status === "booked";

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <p className="text-xs uppercase tracking-wider text-[#52504E]/60">{b.studioName}</p>
      <h1 className="mt-1 text-2xl text-[#52504E]" style={{ fontFamily: displayFont }}>
        {done ? "Booking cancelled" : "Cancel your booking"}
      </h1>

      <div className="mt-5 rounded-xl border border-[#DDD5C7] bg-white p-4">
        <p className="text-base font-medium" style={{ fontFamily: displayFont }}>
          {classLabel}
        </p>
        <p className="mt-0.5 text-sm text-[#52504E]/70">
          {when}
          {b.room ? ` · ${b.room}` : ""}
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error === "started"
            ? "This class has already started, so it can't be cancelled online. Please contact the studio."
            : error === "not_active"
              ? "This booking has already been cancelled."
              : "We couldn't cancel this booking. Please contact the studio."}
        </p>
      )}

      {done ? (
        <div className="mt-4 space-y-2 text-sm">
          <p className="rounded-lg bg-[#DDD5C7]/60 px-3 py-2">
            Your spot has been released, {b.guestName.split(" ")[0]}. We hope to see you another time.
          </p>
          {late && (
            <p className="text-[#52504E]/70">
              This was inside the {b.cancelWindowHours}-hour cancellation window
              {credit ? ", so one class credit was used." : "."}
            </p>
          )}
        </div>
      ) : !active ? (
        <p className="mt-4 text-sm text-[#52504E]/70">
          {b.status === "cancelled"
            ? "This booking has already been cancelled."
            : "This booking can no longer be cancelled."}
        </p>
      ) : state.started ? (
        <p className="mt-4 text-sm text-[#52504E]/70">
          This class has already started, so it can&apos;t be cancelled online.
        </p>
      ) : (
        <form action={cancelBookingAction} className="mt-5 space-y-3">
          <input type="hidden" name="token" value={token} />
          <p className="text-sm text-[#52504E]/80">
            {state.late
              ? `This class starts in under ${b.cancelWindowHours} hours. You can still cancel to free up your spot, but one class credit will be used.`
              : `Free cancellation is available until ${b.cancelWindowHours} hours before class.`}
          </p>
          <button className="w-full rounded-lg border border-[#8C3B28] bg-[#8C3B28] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#7a3222]">
            {state.late ? "Cancel anyway (late cancel)" : "Cancel booking"}
          </button>
        </form>
      )}

      <p className="mt-8 text-xs">
        <a href={`/book/${b.studioSlug}`} className="text-[#8C3B28] underline underline-offset-2">
          Back to the class schedule
        </a>
      </p>
    </main>
  );
}
