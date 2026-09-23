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

  // Which single day mobile shows by default — a real desktop calendar
  // shows every day as its own column at once, but on a phone there's only
  // room for one, so this is also the day the pills above jump/scroll to.
  const selectedKey = day && dayKeys.includes(day) ? day : todayKey;

  const weekStart = combineLocalDateTime(dayKeys[0], "00:00", studio.timezone);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);

  // Fetch the whole visible week at once — a real calendar shows every
  // day's column side by side, not just the selected one (that was the
  // old single-day-list design). Grouped by local day below.
  const sessions = await db
    .select({
      id: schema.classSessions.id,
      startsAt: schema.classSessions.startsAt,
      room: schema.classSessions.room,
      capacity: schema.classSessions.capacity,
      classTypeName: schema.classTypes.name,
      durationMinutes: schema.classTypes.durationMinutes,
      classDescription: schema.classTypes.description,
      teacherName: schema.teachers.name,
      teacherBio: schema.teachers.bio,
      teacherPhotoUrl: schema.teachers.photoUrl,
    })
    .from(schema.classSessions)
    .leftJoin(schema.classTypes, eq(schema.classSessions.classTypeId, schema.classTypes.id))
    .leftJoin(schema.teachers, eq(schema.classSessions.teacherId, schema.teachers.id))
    .where(
      and(
        eq(schema.classSessions.studioId, studio.id),
        eq(schema.classSessions.status, "scheduled"),
        gte(schema.classSessions.startsAt, weekStart),
        lt(schema.classSessions.startsAt, weekEnd)
      )
    )
    .orderBy(schema.classSessions.startsAt);

  const sessionsByDay = new Map<string, typeof sessions>();
  for (const key of dayKeys) sessionsByDay.set(key, []);
  for (const s of sessions) {
    const key = localDateKey(s.startsAt, studio.timezone);
    sessionsByDay.get(key)?.push(s);
  }

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
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8C3B28]">
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
        <div className="mb-6 rounded-xl border border-[#8C3B28] bg-[#F3F0E8] px-4 py-3">
          <p className="text-sm font-medium text-[#8C3B28]">You&apos;re booked!</p>
          <p className="mt-0.5 text-sm text-[#52504E]">
            {confirmedSession.classTypeName ?? "Class"} at{" "}
            {formatTimeInZone(confirmedSession.startsAt, studio.timezone)}
            {confirmedSession.room ? ` · ${confirmedSession.room}` : ""}. See you on the mat.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-[#52504E]/30 bg-white px-4 py-3">
          <p className="text-sm text-[#52504E]">{ERROR_MESSAGES[error] ?? "Something went wrong — try again."}</p>
        </div>
      )}

      {/* Day pills — on a phone these are the only way to switch days (the
          calendar below shows just one column at a time there); on a wider
          screen every day is already visible as its own column, so a pill
          just jump-scrolls the calendar to that column and highlights it. */}
      <nav
        className="mb-4 -mx-4 flex gap-2 overflow-x-auto whitespace-nowrap px-4 pb-1 sm:mx-0 sm:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Choose a day"
      >
        {days.map((d, i) => {
          const key = dayKeys[i];
          const isSelected = key === selectedKey;
          const label = key === todayKey ? "Today" : i === 1 ? "Tomorrow" : dayLabel(d, studio.timezone);
          return (
            <a
              key={key}
              href={`/book/${slug}?day=${key}#day-${key}`}
              className={`shrink-0 rounded-full border px-3.5 py-2 text-sm transition-colors ${
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

      {/* The calendar itself: 7 day-columns. On a phone only the selected
          day's column renders (block vs. hidden per column below, then
          overridden back to visible from `sm` up); from `sm` up they all
          show together, side by side, horizontally scrollable if the
          viewport is narrower than 7 columns — this is the "day-by-day,
          side by side, Wix-Booking-style" layout Gün asked for. */}
      <div className="scroll-smooth sm:-mx-1 sm:flex sm:gap-3 sm:overflow-x-auto sm:pb-2">
        {days.map((d, i) => {
          const key = dayKeys[i];
          const daySessions = sessionsByDay.get(key) ?? [];
          const isSelected = key === selectedKey;
          const label = key === todayKey ? "Today" : i === 1 ? "Tomorrow" : dayLabel(d, studio.timezone);
          return (
            <div
              key={key}
              id={`day-${key}`}
              className={`${isSelected ? "block" : "hidden"} scroll-mt-4 overflow-hidden rounded-2xl border border-[#DDD5C7] bg-white sm:block sm:w-72 sm:shrink-0`}
            >
              <div className="border-b border-[#DDD5C7] bg-[#F3F0E8] px-4 py-2.5">
                <p className="text-sm font-medium text-[#52504E]">{label}</p>
                <p className="text-xs text-[#52504E]/60">{dayLabel(d, studio.timezone)}</p>
              </div>

              <div className="divide-y divide-[#DDD5C7]">
                {daySessions.length === 0 && (
                  <p className="px-4 py-6 text-sm text-[#52504E]/70">No classes scheduled.</p>
                )}
                {daySessions.map((s) => {
                  const occupied = occupiedMap.get(s.id) ?? 0;
                  const spotsLeft = s.capacity - occupied;
                  const isFull = spotsLeft <= 0;
                  // Today's list can include classes earlier the same day
                  // that have already started — bookSessionAction correctly
                  // refuses those, but showing an active "Reserve" button
                  // for them would just walk a guest into a confusing
                  // error. Treat them the same as "closed".
                  const isPast = s.startsAt.getTime() <= Date.now();
                  const isBookable = !isFull && !isPast;
                  const endsAt = s.durationMinutes ? addMinutes(s.startsAt, s.durationMinutes) : null;

                  return (
                    <div key={s.id} className="px-4 py-3">
                      <p className="text-sm font-medium text-[#52504E]">
                        {formatTimeInZone(s.startsAt, studio.timezone)}
                        {endsAt ? ` – ${formatTimeInZone(endsAt, studio.timezone)}` : ""}
                      </p>
                      <p className="mt-0.5 text-base font-medium text-[#52504E]" style={{ fontFamily: displayFont }}>
                        {s.classTypeName ?? "Class"}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[#52504E]/70">
                        {s.teacherPhotoUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={s.teacherPhotoUrl}
                            alt=""
                            className="h-4 w-4 shrink-0 rounded-full object-cover"
                          />
                        )}
                        <span>
                          {s.teacherName ?? "TBA"}
                          {s.room ? ` · ${s.room}` : ""}
                          {" · "}
                          {isPast ? "Class started" : isFull ? "Full" : `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`}
                        </span>
                      </div>
                      {(s.classDescription || s.teacherBio) && (
                        <details className="mt-1.5">
                          <summary className="cursor-pointer text-xs text-[#8C3B28] underline underline-offset-2">
                            More about this class
                          </summary>
                          <div className="mt-1.5 space-y-1.5 text-xs leading-relaxed text-[#52504E]/80">
                            {s.classDescription && <p>{s.classDescription}</p>}
                            {s.teacherBio && (
                              <p>
                                <span className="font-medium text-[#52504E]">{s.teacherName}: </span>
                                {s.teacherBio}
                              </p>
                            )}
                          </div>
                        </details>
                      )}

                      <div className="mt-2">
                        {!isBookable ? (
                          <span className="inline-block rounded-lg border border-[#DDD5C7] bg-[#DDD5C7] px-3 py-1.5 text-xs font-medium text-[#52504E]">
                            {isPast ? "Closed" : "Full"}
                          </span>
                        ) : (
                          <details className="group">
                            <summary className="cursor-pointer list-none rounded-lg border border-[#8C3B28] bg-[#8C3B28] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#7a3222]">
                              Reserve
                            </summary>
                            <form
                              action={bookSessionAction}
                              className="mt-2 w-full space-y-2 border-t border-[#DDD5C7] pt-2"
                            >
                              <input type="hidden" name="slug" value={slug} />
                              <input type="hidden" name="classSessionId" value={s.id} />
                              <input type="hidden" name="day" value={key} />
                              <input
                                name="name"
                                required
                                placeholder="Your name"
                                className="w-full rounded-lg border border-[#DDD5C7] bg-white px-3 py-2 text-sm text-[#52504E] placeholder:text-[#52504E]/50 focus:border-[#8C3B28] focus:outline-none"
                              />
                              <input
                                name="phone"
                                type="tel"
                                required
                                placeholder="Phone number"
                                className="w-full rounded-lg border border-[#DDD5C7] bg-white px-3 py-2 text-sm text-[#52504E] placeholder:text-[#52504E]/50 focus:border-[#8C3B28] focus:outline-none"
                              />
                              <button className="w-full rounded-lg border border-[#8C3B28] bg-[#8C3B28] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#7a3222]">
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
        })}
      </div>
    </div>
  );
}
