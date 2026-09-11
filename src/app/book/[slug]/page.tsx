import { notFound } from "next/navigation";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  todayRangeInTimeZone,
  localDateKey,
  combineLocalDateTime,
  formatTimeInZone,
} from "@/lib/time";
import { bookSessionAction } from "./actions";
import { displayFont } from "../fonts";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  full: "That class just filled up — try another time or another day.",
  session_not_found: "That class isn't available anymore — try another time.",
  unavailable: "That class isn't available anymore — try another time.",
  missing: "Please fill in your name and phone number.",
};

function dayLabel(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

export default async function PublicBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ day?: string; confirmed?: string; error?: string }>;
}) {
  const { slug } = await params;
  const { day, confirmed, error } = await searchParams;

  const [studio] = await db
    .select()
    .from(schema.studios)
    .where(eq(schema.studios.slug, slug))
    .limit(1);
  if (!studio) notFound();

  const { start: todayStart } = todayRangeInTimeZone(studio.timezone);
  const todayKey = localDateKey(todayStart, studio.timezone);

  const days = Array.from({ length: 7 }, (_, i) => new Date(todayStart.getTime() + i * 86_400_000));
  const dayKeys = days.map((d) => localDateKey(d, studio.timezone));

  const selectedKey = day && dayKeys.includes(day) ? day : todayKey;
  const dayStart = combineLocalDateTime(selectedKey, "00:00", studio.timezone);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const sessions = await db
    .select({
      id: schema.classSessions.id,
      startsAt: schema.classSessions.startsAt,
      room: schema.classSessions.room,
      capacity: schema.classSessions.capacity,
      classTypeName: schema.classTypes.name,
      durationMinutes: schema.classTypes.durationMinutes,
      teacherName: schema.teachers.name,
    })
    .from(schema.classSessions)
    .leftJoin(schema.classTypes, eq(schema.classSessions.classTypeId, schema.classTypes.id))
    .leftJoin(schema.teachers, eq(schema.classSessions.teacherId, schema.teachers.id))
    .where(
      and(
        eq(schema.classSessions.studioId, studio.id),
        eq(schema.classSessions.status, "scheduled"),
        gte(schema.classSessions.startsAt, dayStart),
        lt(schema.classSessions.startsAt, dayEnd)
      )
    )
    .orderBy(schema.classSessions.startsAt);

  const sessionIds = sessions.map((s) => s.id);
  const occupiedMap = new Map<number, number>();

  if (sessionIds.length > 0) {
    const [attendedCounts, bookedCounts] = await Promise.all([
      db
        .select({ classSessionId: schema.signIns.classSessionId, count: sql<number>`count(*)::int` })
        .from(schema.signIns)
        .where(and(inArray(schema.signIns.classSessionId, sessionIds), eq(schema.signIns.status, "attended")))
        .groupBy(schema.signIns.classSessionId),
      db
        .select({ classSessionId: schema.bookings.classSessionId, count: sql<number>`count(*)::int` })
        .from(schema.bookings)
        .where(and(inArray(schema.bookings.classSessionId, sessionIds), eq(schema.bookings.status, "booked")))
        .groupBy(schema.bookings.classSessionId),
    ]);
    for (const row of attendedCounts) {
      occupiedMap.set(row.classSessionId, (occupiedMap.get(row.classSessionId) ?? 0) + row.count);
    }
    for (const row of bookedCounts) {
      occupiedMap.set(row.classSessionId, (occupiedMap.get(row.classSessionId) ?? 0) + row.count);
    }
  }

  const confirmedSession = confirmed
    ? sessions.find((s) => s.id === Number(confirmed))
    : undefined;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <p
          className="text-xs font-medium uppercase tracking-[0.15em] text-[#8C3B28]"
        >
          {studio.city ?? "Book a class"}
        </p>
        <h1
          className="mt-1 text-3xl font-medium text-[#52504E] sm:text-4xl"
          style={{ fontFamily: displayFont }}
        >
          {studio.name}
        </h1>
      </header>

      {confirmedSession && (
        <div className="mb-6 border border-[#8C3B28] bg-[#F3F0E8] px-4 py-3">
          <p className="text-sm font-medium text-[#8C3B28]">You&apos;re booked!</p>
          <p className="mt-0.5 text-sm text-[#52504E]">
            {confirmedSession.classTypeName ?? "Class"} at{" "}
            {formatTimeInZone(confirmedSession.startsAt, studio.timezone)}
            {confirmedSession.room ? ` · ${confirmedSession.room}` : ""}. See you on the mat.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-6 border border-[#52504E]/30 bg-white px-4 py-3">
          <p className="text-sm text-[#52504E]">{ERROR_MESSAGES[error] ?? "Something went wrong — try again."}</p>
        </div>
      )}

      <nav
        className="mb-6 -mx-4 flex gap-2 overflow-x-auto whitespace-nowrap px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Choose a day"
      >
        {days.map((d, i) => {
          const key = dayKeys[i];
          const isSelected = key === selectedKey;
          const label = key === todayKey ? "Today" : i === 1 ? "Tomorrow" : dayLabel(d, studio.timezone);
          return (
            <a
              key={key}
              href={`/book/${slug}?day=${key}`}
              className={`shrink-0 border px-3 py-2 text-sm transition-colors ${
                isSelected
                  ? "border-[#8C3B28] bg-[#8C3B28] text-white"
                  : "border-[#DDD5C7] bg-white text-[#52504E] hover:border-[#8C3B28]"
              }`}
            >
              {label}
            </a>
          );
        })}
      </nav>

      <div className="divide-y divide-[#DDD5C7] border border-[#DDD5C7] bg-white">
        {sessions.length === 0 && (
          <p className="px-4 py-6 text-sm text-[#52504E]">No classes scheduled for this day.</p>
        )}
        {sessions.map((s) => {
          const occupied = occupiedMap.get(s.id) ?? 0;
          const spotsLeft = s.capacity - occupied;
          const isFull = spotsLeft <= 0;
          // Today's list can include classes earlier the same day that have
          // already started — bookSessionAction correctly refuses those, but
          // showing an active "Reserve" button for them would just walk a
          // guest into a confusing error. Treat them the same as "closed".
          const isPast = s.startsAt.getTime() <= Date.now();
          const isBookable = !isFull && !isPast;
          const endsAt = s.durationMinutes ? addMinutes(s.startsAt, s.durationMinutes) : null;

          return (
            <div key={s.id} className="px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[#52504E]">
                    {formatTimeInZone(s.startsAt, studio.timezone)}
                    {endsAt ? ` – ${formatTimeInZone(endsAt, studio.timezone)}` : ""}
                  </p>
                  <p className="mt-0.5 text-base font-medium text-[#52504E]" style={{ fontFamily: displayFont }}>
                    {s.classTypeName ?? "Class"}
                  </p>
                  <p className="mt-0.5 text-xs text-[#52504E]/70">
                    {s.teacherName ?? "TBA"}
                    {s.room ? ` · ${s.room}` : ""}
                    {" · "}
                    {isPast ? "Class started" : isFull ? "Full" : `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`}
                  </p>
                </div>

                {!isBookable ? (
                  <span className="border border-[#DDD5C7] bg-[#DDD5C7] px-4 py-2 text-sm font-medium text-[#52504E]">
                    {isPast ? "Closed" : "Full"}
                  </span>
                ) : (
                  <details className="group">
                    <summary className="cursor-pointer list-none border border-[#8C3B28] bg-[#8C3B28] px-4 py-2 text-sm font-medium text-white">
                      Reserve
                    </summary>
                    <form
                      action={bookSessionAction}
                      className="mt-3 w-full space-y-2 border-t border-[#DDD5C7] pt-3"
                    >
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="classSessionId" value={s.id} />
                      <input type="hidden" name="day" value={selectedKey} />
                      <input
                        name="name"
                        required
                        placeholder="Your name"
                        className="w-full border border-[#DDD5C7] bg-white px-3 py-2 text-sm text-[#52504E] placeholder:text-[#52504E]/50 focus:border-[#8C3B28] focus:outline-none"
                      />
                      <input
                        name="phone"
                        type="tel"
                        required
                        placeholder="Phone number"
                        className="w-full border border-[#DDD5C7] bg-white px-3 py-2 text-sm text-[#52504E] placeholder:text-[#52504E]/50 focus:border-[#8C3B28] focus:outline-none"
                      />
                      <button className="w-full border border-[#8C3B28] bg-[#8C3B28] px-4 py-2 text-sm font-medium text-white hover:bg-[#7a3222]">
                        Confirm spot
                      </button>
                    </form>
                  </details>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
