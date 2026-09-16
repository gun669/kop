import Link from "next/link";
import { and, eq, gte, lt, ilike, or, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePageContext, requireRole } from "@/lib/context";
import { todayRangeInTimeZone, formatTimeInZone, localDateKey } from "@/lib/time";
import { packagesForStudio } from "@/lib/packages";
import { reconcileNoShows, buildRoster, type RosterEntry } from "@/lib/checkin-roster";
import {
  checkInExistingGuestAction,
  checkInWithNegativeOverrideAction,
  quickAddAndCheckInAction,
  sellMembershipAction,
  setSignInStatusAction,
} from "./actions";

const MEMBERSHIP_LABEL: Record<string, string> = {
  drop_in: "drop-in",
  class_pack: "class pack",
  unlimited_monthly: "unlimited",
};

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

  // Auto-reconcile any booking whose class started >10 minutes ago and was
  // never checked in — see src/lib/checkin-roster.ts. Cheap, idempotent,
  // safe on every page view; per Gün's explicit spec (Sep 16, 2026).
  await reconcileNoShows(studio.id);

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

  const roster: RosterEntry[] = selected ? await buildRoster(selected.id) : [];
  const rosterGuestIds = new Set(roster.map((r) => r.guestId));

  // Phone is the safer, more precise match (see bug: guests keyed by phone,
  // not name) — if the query has at least a few digits in it, treat it as a
  // possible phone search too, alongside the always-on name search.
  const qDigits = (q ?? "").replace(/\D/g, "");
  const searchResults =
    q && q.length >= 2
      ? await db
          .select()
          .from(schema.guests)
          .where(
            and(
              eq(schema.guests.studioId, studio.id),
              qDigits.length >= 3
                ? or(ilike(schema.guests.name, `%${q}%`), ilike(schema.guests.phone, `%${qDigits}%`))
                : ilike(schema.guests.name, `%${q}%`)
            )
          )
          .limit(8)
      : [];

  const todayKey = localDateKey(new Date(), studio.timezone);

  // Only memberships that could actually cover this visit — has a credit
  // left (or is unlimited) and hasn't expired — get auto-attached to the
  // "Check in" button below. Drop-ins are included here now that they're
  // a real, sellable package (see sellMembershipAction): a drop-in bought
  // ahead of time is just a 1-credit membership like any other.
  //
  // Needed for two groups of guests: search results (walk-in flow, as
  // before) and "booked, not yet arrived" roster rows (so a guest who
  // already booked online and shows up in person doesn't need to be
  // re-searched by name — they're already right there in the roster,
  // per Gün's "everyone on the same page" ask, Sep 16, 2026).
  const membershipsByGuest = new Map<number, (typeof schema.memberships.$inferSelect)[]>();
  // Exhausted (or already-negative) finite-credit packs — the private-
  // lesson-pack-overage case (Launch Path b8). Surfaced separately from
  // the usable list above so only owner/manager get the override control,
  // not a second normal "Check in" path.
  const overridableByGuest = new Map<number, (typeof schema.memberships.$inferSelect)[]>();
  const guestIdsNeedingMemberships = new Set<number>(searchResults.map((g) => g.id));
  for (const r of roster) {
    if (r.status === "booked") guestIdsNeedingMemberships.add(r.guestId);
  }
  if (guestIdsNeedingMemberships.size > 0) {
    const allMemberships = await db
      .select()
      .from(schema.memberships)
      .where(inArray(schema.memberships.guestId, Array.from(guestIdsNeedingMemberships)));
    for (const guestId of guestIdsNeedingMemberships) {
      const ms = allMemberships.filter((m) => m.guestId === guestId);
      const usable = ms.filter(
        (m) =>
          (m.remainingCredits === null || m.remainingCredits > 0) &&
          (!m.expiresOn || m.expiresOn >= todayKey)
      );
      membershipsByGuest.set(guestId, usable);

      const exhausted = ms
        .filter((m) => m.remainingCredits !== null && m.remainingCredits <= 0)
        .sort((a, b) => (b.startsOn > a.startsOn ? 1 : -1));
      overridableByGuest.set(guestId, exhausted);
    }
  }

  const packages = packagesForStudio(studio.slug);
  const canSellPackages = ["owner", "manager", "receptionist"].includes(role);
  const canOverrideBalance = ["owner", "manager"].includes(role);

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
                {roster.some((r) => r.status === "booked") &&
                  ` · ${roster.filter((r) => r.status === "booked").length} not arrived yet`}
                {roster.some((r) => r.status === "no_show") &&
                  ` · ${roster.filter((r) => r.status === "no_show").length} no-show`}
              </p>
            </div>

            <div className="rounded-xl border border-stone-200 bg-white">
              <div className="border-b border-stone-100 px-4 py-2 text-sm font-medium text-stone-700">
                Roster — everyone expected or here, booked and walk-in together
              </div>
              <ul className="divide-y divide-stone-100">
                {roster.length === 0 && (
                  <li className="px-4 py-3 text-sm text-stone-400">Nobody booked or checked in yet.</li>
                )}
                {roster.map((r) => {
                  const guestMemberships = membershipsByGuest.get(r.guestId) ?? [];
                  return (
                    <li key={r.guestId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Link href={`/guests/${r.guestId}`} className="truncate text-stone-800 hover:underline">
                            {r.guestName}
                          </Link>
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                              r.source === "online" ? "bg-blue-50 text-blue-600" : "bg-stone-100 text-stone-500"
                            }`}
                          >
                            {r.source === "online" ? "booked online" : "walk-in"}
                          </span>
                        </div>
                        {r.status === "attended" && (
                          <div className="text-xs text-stone-400">
                            {r.membershipType
                              ? MEMBERSHIP_LABEL[r.membershipType] ?? r.membershipType
                              : "no package on file — collect payment"}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={r.status} />
                        {r.status === "booked" && (
                          <form action={checkInExistingGuestAction}>
                            <input type="hidden" name="studioId" value={studio.id} />
                            <input type="hidden" name="classSessionId" value={selected.id} />
                            <input type="hidden" name="guestId" value={r.guestId} />
                            {guestMemberships[0] && (
                              <input type="hidden" name="membershipId" value={guestMemberships[0].id} />
                            )}
                            <button className="rounded-lg bg-stone-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-stone-800">
                              Check in
                            </button>
                          </form>
                        )}
                        {r.status === "attended" && r.signInId !== null && (
                          <form action={setSignInStatusAction}>
                            <input type="hidden" name="studioId" value={studio.id} />
                            <input type="hidden" name="signInId" value={r.signInId} />
                            <input type="hidden" name="classSessionId" value={selected.id} />
                            <input type="hidden" name="status" value="no_show" />
                            <button className="text-xs text-stone-400 hover:text-red-600">
                              mark no-show
                            </button>
                          </form>
                        )}
                      </div>
                    </li>
                  );
                })}
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
                  placeholder="Search guest by name or phone…"
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
                          <div className="text-sm text-stone-800">
                            <Link href={`/guests/${g.id}`} className="hover:underline">
                              {g.name}
                            </Link>
                            {g.phone && <span className="ml-1.5 text-xs text-stone-400">{g.phone}</span>}
                          </div>
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
                        <div className="flex items-center gap-2">
                          {canSellPackages && packages.length > 0 && (
                            <form action={sellMembershipAction} className="flex items-center gap-1">
                              <input type="hidden" name="studioId" value={studio.id} />
                              <input type="hidden" name="guestId" value={g.id} />
                              <select
                                name="packageKey"
                                className="rounded-lg border border-stone-300 px-1.5 py-1.5 text-xs text-stone-600"
                              >
                                {packages.map((p) => (
                                  <option key={p.key} value={p.key}>
                                    {p.label}
                                  </option>
                                ))}
                              </select>
                              <button className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs text-stone-600 hover:bg-stone-50">
                                Sell
                              </button>
                            </form>
                          )}
                          {already ? (
                            <span className="text-xs text-stone-400">already in the roster above</span>
                          ) : (
                            <>
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
                              {canOverrideBalance &&
                                memberships.length === 0 &&
                                (overridableByGuest.get(g.id) ?? [])[0] && (
                                  <form action={checkInWithNegativeOverrideAction} title="Check in anyway — their pack has no credits left, this will take them negative">
                                    <input type="hidden" name="studioId" value={studio.id} />
                                    <input type="hidden" name="classSessionId" value={selected.id} />
                                    <input type="hidden" name="guestId" value={g.id} />
                                    <input
                                      type="hidden"
                                      name="membershipId"
                                      value={(overridableByGuest.get(g.id) ?? [])[0].id}
                                    />
                                    <button className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100">
                                      Check in (override, −credit)
                                    </button>
                                  </form>
                                )}
                            </>
                          )}
                        </div>
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
    booked: "bg-sky-50 text-sky-700",
    attended: "bg-emerald-50 text-emerald-700",
    no_show: "bg-red-50 text-red-700",
    late_cancel: "bg-amber-50 text-amber-700",
  };
  const labels: Record<string, string> = {
    booked: "not arrived yet",
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
