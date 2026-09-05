import Link from "next/link";
import { and, eq, gte, lt, ilike, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePageContext, requireRole } from "@/lib/context";
import { todayRangeInTimeZone, formatTimeInZone } from "@/lib/time";
import {
  checkInExistingGuestAction,
  quickAddAndCheckInAction,
  setSignInStatusAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function CheckInPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; q?: string }>;
}) {
  const { session: sessionIdRaw, q } = await searchParams;
  const ctx = await requirePageContext();
  requireRole(ctx.role, ["owner", "manager", "receptionist", "teacher"]);
  const { studio, role, session: currentSession } = ctx;

  // Teachers only see (and can only check in) their own classes — reception
  // and management see everything on the schedule today.
  const teacherRecord =
    role === "teacher"
      ? (
          await db
            .select()
            .from(schema.teachers)
            .where(and(eq(schema.teachers.studioId, studio.id), eq(schema.teachers.userId, currentSession.userId)))
            .limit(1)
        )[0] ?? null
      : null;

  const { start, end } = todayRangeInTimeZone(studio.timezone);

  const sessions = await db
    .select({
      id: schema.classSessions.id,
      startsAt: schema.classSessions.startsAt,
      room: schema.classSessions.room,
      capacity: schema.classSessions.capacity,
      teacherName: schema.teachers.name,
      classTypeName: schema.classTypes.name,
    })
    .from(schema.classSessions)
    .leftJoin(schema.teachers, eq(schema.classSessions.teacherId, schema.teachers.id))
    .leftJoin(schema.classTypes, eq(schema.classSessions.classTypeId, schema.classTypes.id))
    .where(
      and(
        eq(schema.classSessions.studioId, studio.id),
        gte(schema.classSessions.startsAt, start),
        lt(schema.classSessions.startsAt, end),
        ...(role === "teacher" ? [eq(schema.classSessions.teacherId, teacherRecord?.id ?? -1)] : [])
      )
    )
    .orderBy(schema.classSessions.startsAt);

  const selectedId = sessionIdRaw ? Number(sessionIdRaw) : sessions[0]?.id;
  const selected = sessions.find((s) => s.id === selectedId);

  const roster = selected
    ? await db
        .select({
          id: schema.signIns.id,
          status: schema.signIns.status,
          guestName: schema.guests.name,
        })
        .from(schema.signIns)
        .innerJoin(schema.guests, eq(schema.signIns.guestId, schema.guests.id))
        .where(eq(schema.signIns.classSessionId, selected.id))
    : [];

  const rosterGuestIds = new Set<number>();
  if (selected) {
    const ids = await db
      .select({ guestId: schema.signIns.guestId })
      .from(schema.signIns)
      .where(eq(schema.signIns.classSessionId, selected.id));
    ids.forEach((r) => rosterGuestIds.add(r.guestId));
  }

  const searchResults =
    q && q.length >= 2
      ? await db
          .select()
          .from(schema.guests)
          .where(and(eq(schema.guests.studioId, studio.id), ilike(schema.guests.name, `%${q}%`)))
          .limit(8)
      : [];

  const membershipsByGuest = new Map<number, (typeof schema.memberships.$inferSelect)[]>();
  for (const g of searchResults) {
    const ms = await db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.guestId, g.id),
          ne(schema.memberships.type, "drop_in")
        )
      );
    membershipsByGuest.set(g.id, ms);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <h1 className="mb-3 text-lg font-semibold text-stone-900">Today at {studio.name}</h1>
        {role === "teacher" && !teacherRecord && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Your account isn&apos;t linked to a teacher profile yet — ask a manager to add you on the Team page.
          </p>
        )}
        <div className="space-y-2">
          {sessions.length === 0 && (
            <p className="text-sm text-stone-400">No classes scheduled today.</p>
          )}
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/checkin?session=${s.id}`}
              className={`block rounded-lg border px-3 py-2 text-sm ${
                s.id === selected?.id
                  ? "border-stone-900 bg-stone-900 text-white"
                  : "border-stone-200 bg-white text-stone-700 hover:border-stone-400"
              }`}
            >
              <div className="font-medium">
                {formatTimeInZone(s.startsAt, studio.timezone)} · {s.classTypeName ?? "Class"}
              </div>
              <div className={s.id === selected?.id ? "text-stone-300" : "text-stone-500"}>
                {s.teacherName ?? "TBA"} {s.room ? `· ${s.room}` : ""} · cap {s.capacity}
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="lg:col-span-2">
        {!selected ? (
          <p className="text-sm text-stone-400">Pick a class to check guests in.</p>
        ) : (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">
                {selected.classTypeName ?? "Class"} · {formatTimeInZone(selected.startsAt, studio.timezone)}
              </h2>
              <p className="text-sm text-stone-500">
                {selected.teacherName ?? "TBA"} {selected.room ? `· ${selected.room}` : ""} ·{" "}
                {roster.filter((r) => r.status === "attended").length}/{selected.capacity} checked in
              </p>
            </div>

            <div className="rounded-xl border border-stone-200 bg-white">
              <div className="border-b border-stone-100 px-4 py-2 text-sm font-medium text-stone-700">
                Roster
              </div>
              <ul className="divide-y divide-stone-100">
                {roster.length === 0 && (
                  <li className="px-4 py-3 text-sm text-stone-400">No one checked in yet.</li>
                )}
                {roster.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-stone-800">{r.guestName}</span>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={r.status} />
                      {r.status === "attended" && (
                        <form action={setSignInStatusAction}>
                          <input type="hidden" name="studioId" value={studio.id} />
                          <input type="hidden" name="signInId" value={r.id} />
                          <input type="hidden" name="classSessionId" value={selected.id} />
                          <input type="hidden" name="status" value="no_show" />
                          <button className="text-xs text-stone-400 hover:text-red-600">
                            mark no-show
                          </button>
                        </form>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="mb-2 text-sm font-medium text-stone-700">Check someone in</div>
              <form action={`/checkin?session=${selected.id}`} className="mb-3">
                <input type="hidden" name="session" value={selected.id} />
                <input
                  type="text"
                  name="q"
                  defaultValue={q ?? ""}
                  placeholder="Search guest by name…"
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
                />
              </form>

              {q && q.length >= 2 && (
                <ul className="mb-4 space-y-2">
                  {searchResults.length === 0 && (
                    <li className="text-sm text-stone-400">No guests match &quot;{q}&quot;.</li>
                  )}
                  {searchResults.map((g) => {
                    const memberships = membershipsByGuest.get(g.id) ?? [];
                    const already = rosterGuestIds.has(g.id);
                    return (
                      <li key={g.id} className="flex items-center justify-between rounded-lg border border-stone-100 px-3 py-2">
                        <div>
                          <div className="text-sm text-stone-800">{g.name}</div>
                          {memberships.length > 0 && (
                            <div className="text-xs text-stone-400">
                              {memberships
                                .map((m) =>
                                  m.type === "unlimited_monthly"
                                    ? "unlimited"
                                    : `${m.remainingCredits ?? 0} credits left`
                                )
                                .join(", ")}
                            </div>
                          )}
                        </div>
                        {already ? (
                          <span className="text-xs text-stone-400">already in</span>
                        ) : (
                          <form action={checkInExistingGuestAction}>
                            <input type="hidden" name="studioId" value={studio.id} />
                            <input type="hidden" name="classSessionId" value={selected.id} />
                            <input type="hidden" name="guestId" value={g.id} />
                            {memberships[0] && (
                              <input type="hidden" name="membershipId" value={memberships[0].id} />
                            )}
                            <button className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-800">
                              Check in
                            </button>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <details className="text-sm">
                <summary className="cursor-pointer text-stone-500">New guest, not in the system yet</summary>
                <form action={quickAddAndCheckInAction} className="mt-2 flex gap-2">
                  <input type="hidden" name="studioId" value={studio.id} />
                  <input type="hidden" name="classSessionId" value={selected.id} />
                  <input
                    name="name"
                    placeholder="Name"
                    required
                    className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  />
                  <input
                    name="phone"
                    placeholder="Phone (optional)"
                    className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  />
                  <button className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white hover:bg-stone-800">
                    Add &amp; check in
                  </button>
                </form>
              </details>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    attended: "bg-emerald-50 text-emerald-700",
    no_show: "bg-red-50 text-red-700",
    late_cancel: "bg-amber-50 text-amber-700",
  };
  const labels: Record<string, string> = {
    attended: "attended",
    no_show: "no-show",
    late_cancel: "late cancel",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${styles[status] ?? ""}`}>
      {labels[status] ?? status}
    </span>
  );
}
