import Link from "next/link";
import { and, eq, ilike, or, sql, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePageContext, requireRole } from "@/lib/context";
import { localDateKey } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function GuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const { studio, role } = await requirePageContext();
  requireRole(role, ["owner", "manager", "receptionist"]);

  const qDigits = (q ?? "").replace(/\D/g, "");
  const guests = await db
    .select()
    .from(schema.guests)
    .where(
      and(
        eq(schema.guests.studioId, studio.id),
        q && q.length >= 2
          ? qDigits.length >= 3
            ? or(ilike(schema.guests.name, `%${q}%`), ilike(schema.guests.phone, `%${qDigits}%`))
            : ilike(schema.guests.name, `%${q}%`)
          : undefined
      )
    )
    .orderBy(schema.guests.name)
    .limit(100);

  const guestIds = guests.map((g) => g.id);
  const todayKey = localDateKey(new Date(), studio.timezone);

  const memberships = guestIds.length
    ? await db
        .select()
        .from(schema.memberships)
        .where(inArray(schema.memberships.guestId, guestIds))
    : [];
  const usableByGuest = new Map<number, (typeof memberships)[number][]>();
  for (const m of memberships) {
    if ((m.remainingCredits === null || m.remainingCredits > 0) && (!m.expiresOn || m.expiresOn >= todayKey)) {
      const list = usableByGuest.get(m.guestId) ?? [];
      list.push(m);
      usableByGuest.set(m.guestId, list);
    }
  }

  const attendance = guestIds.length
    ? await db
        .select({
          guestId: schema.signIns.guestId,
          attended: sql<number>`count(*) filter (where ${schema.signIns.status} = 'attended')::int`,
          noShows: sql<number>`count(*) filter (where ${schema.signIns.status} = 'no_show')::int`,
        })
        .from(schema.signIns)
        .where(inArray(schema.signIns.guestId, guestIds))
        .groupBy(schema.signIns.guestId)
    : [];
  const attendanceByGuest = new Map(attendance.map((a) => [a.guestId, a]));

  function membershipSummary(id: number) {
    const list = usableByGuest.get(id) ?? [];
    if (list.length === 0) return { text: "No active package", dim: true };
    const parts = list.map((m) =>
      m.type === "unlimited_monthly" ? "Unlimited" : `${m.remainingCredits ?? 0} credit${m.remainingCredits === 1 ? "" : "s"}`
    );
    return { text: parts.join(", "), dim: false };
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-stone-900">Guests</h1>
        <p className="mt-1 text-sm text-stone-500">
          Everyone {studio.name} has on file — contact info, current packages, and attendance history.
        </p>
      </div>

      <form className="flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name or phone…"
          className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
        />
        <button className="shrink-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50">
          Search
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <ul className="divide-y divide-stone-100">
          {guests.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-stone-400">
              {q ? `No guests match "${q}".` : "No guests yet."}
            </li>
          )}
          {guests.map((g) => {
            const summary = membershipSummary(g.id);
            const a = attendanceByGuest.get(g.id);
            return (
              <li key={g.id}>
                <Link
                  href={`/guests/${g.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-stone-50"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-stone-800">{g.name}</div>
                    <div className="text-xs text-stone-400">
                      {g.phone ?? "No phone on file"} {a ? `· ${a.attended} visit${a.attended === 1 ? "" : "s"}` : ""}
                    </div>
                  </div>
                  <div className={`shrink-0 text-xs ${summary.dim ? "text-stone-400" : "text-emerald-700"}`}>
                    {summary.text}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      {guests.length === 100 && (
        <p className="text-xs text-stone-400">Showing the first 100 — search to narrow it down.</p>
      )}
    </div>
  );
}
