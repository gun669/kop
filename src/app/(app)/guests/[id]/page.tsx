import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePageContext, requireRole } from "@/lib/context";
import { localDateKey } from "@/lib/time";
import { updateGuestAction } from "../actions";

export const dynamic = "force-dynamic";

function money(amount: string, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
}

const STATUS_LABEL: Record<string, string> = {
  attended: "attended",
  no_show: "no-show",
  late_cancel: "late cancel",
};
const STATUS_STYLE: Record<string, string> = {
  attended: "bg-emerald-50 text-emerald-700",
  no_show: "bg-red-50 text-red-700",
  late_cancel: "bg-amber-50 text-amber-700",
};

export default async function GuestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const { saved, error } = await searchParams;
  const guestId = Number(id);
  const { studio, role } = await requirePageContext();
  requireRole(role, ["owner", "manager", "receptionist"]);

  const [guest] = await db
    .select()
    .from(schema.guests)
    .where(and(eq(schema.guests.id, guestId), eq(schema.guests.studioId, studio.id)))
    .limit(1);
  if (!guest) notFound();

  const todayKey = localDateKey(new Date(), studio.timezone);

  const memberships = await db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.guestId, guestId))
    .orderBy(desc(schema.memberships.startsOn));
  const isUsable = (m: (typeof memberships)[number]) =>
    (m.remainingCredits === null || m.remainingCredits > 0) && (!m.expiresOn || m.expiresOn >= todayKey);
  const activeMemberships = memberships.filter(isUsable);
  const pastMemberships = memberships.filter((m) => !isUsable(m));

  // Launch Path b8: a negative remainingCredits means a manager overrode a
  // check-in past zero (private-lesson pack overage) — surface it clearly
  // rather than making staff track it on paper. Clears automatically the
  // next time this guest buys a package (see sellMembershipAction).
  const sessionsOwed = memberships.reduce(
    (sum, m) => sum + (m.remainingCredits !== null && m.remainingCredits < 0 ? Math.abs(m.remainingCredits) : 0),
    0
  );

  const history = await db
    .select({
      id: schema.signIns.id,
      status: schema.signIns.status,
      checkedInAt: schema.signIns.checkedInAt,
      classTypeName: schema.classTypes.name,
      startsAt: schema.classSessions.startsAt,
    })
    .from(schema.signIns)
    .innerJoin(schema.classSessions, eq(schema.signIns.classSessionId, schema.classSessions.id))
    .leftJoin(schema.classTypes, eq(schema.classSessions.classTypeId, schema.classTypes.id))
    .where(eq(schema.signIns.guestId, guestId))
    .orderBy(desc(schema.classSessions.startsAt))
    .limit(20);

  const attendedCount = history.filter((h) => h.status === "attended").length;
  const noShowCount = history.filter((h) => h.status === "no_show").length;

  const upcoming = await db
    .select({
      id: schema.bookings.id,
      classTypeName: schema.classTypes.name,
      startsAt: schema.classSessions.startsAt,
    })
    .from(schema.bookings)
    .innerJoin(schema.classSessions, eq(schema.bookings.classSessionId, schema.classSessions.id))
    .leftJoin(schema.classTypes, eq(schema.classSessions.classTypeId, schema.classTypes.id))
    .where(and(eq(schema.bookings.guestId, guestId), eq(schema.bookings.status, "booked")))
    .orderBy(schema.classSessions.startsAt);

  const revenue = await db
    .select()
    .from(schema.revenueEntries)
    .where(eq(schema.revenueEntries.guestId, guestId))
    .orderBy(desc(schema.revenueEntries.occurredOn));
  const totalSpent = revenue.reduce((sum, r) => sum + Number(r.amount), 0);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/guests" className="text-xs text-stone-400 hover:text-stone-600">
          ← All guests
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-stone-900">{guest.name}</h1>
        <p className="text-sm text-stone-500">
          Guest since {new Date(guest.createdAt).toLocaleDateString()} · {attendedCount} visit
          {attendedCount === 1 ? "" : "s"}
          {noShowCount > 0 && ` · ${noShowCount} no-show${noShowCount === 1 ? "" : "s"}`} ·{" "}
          {money(String(totalSpent), studio.currency)} lifetime spend
        </p>
      </div>

      {sessionsOwed > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Owes {sessionsOwed} session{sessionsOwed === 1 ? "" : "s"} — clears automatically on their
          next package purchase.
        </p>
      )}

      {saved && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved.</p>
      )}
      {error === "missing_name" && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Name can&apos;t be empty.</p>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="space-y-4">
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-stone-900">Contact info</h2>
            <form action={updateGuestAction} className="space-y-2">
              <input type="hidden" name="studioId" value={studio.id} />
              <input type="hidden" name="guestId" value={guest.id} />
              <div>
                <label className="block text-xs text-stone-500">Name</label>
                <input
                  name="name"
                  defaultValue={guest.name}
                  required
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500">Phone</label>
                <input
                  name="phone"
                  defaultValue={guest.phone ?? ""}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500">Email</label>
                <input
                  name="email"
                  type="email"
                  defaultValue={guest.email ?? ""}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500">Notes</label>
                <textarea
                  name="notes"
                  defaultValue={guest.notes ?? ""}
                  rows={3}
                  placeholder="Injuries, preferences, anything worth remembering…"
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>
              <button className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800">
                Save
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-stone-900">Packages</h2>
            {activeMemberships.length === 0 && pastMemberships.length === 0 && (
              <p className="text-sm text-stone-400">No packages sold yet.</p>
            )}
            {activeMemberships.length > 0 && (
              <ul className="space-y-2">
                {activeMemberships.map((m) => (
                  <li key={m.id} className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm">
                    <span className="text-emerald-900">
                      {m.type === "unlimited_monthly"
                        ? "Monthly unlimited"
                        : m.type === "drop_in"
                          ? "Drop-in"
                          : "Class pack"}
                    </span>
                    <span className="text-xs text-emerald-700">
                      {m.type === "unlimited_monthly" ? "unlimited" : `${m.remainingCredits ?? 0}/${m.totalCredits ?? 0} left`}
                      {m.expiresOn && ` · expires ${m.expiresOn}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {pastMemberships.length > 0 && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-stone-400">
                  {pastMemberships.length} expired/used package{pastMemberships.length === 1 ? "" : "s"}
                </summary>
                <ul className="mt-2 space-y-1">
                  {pastMemberships.map((m) => (
                    <li key={m.id} className="flex items-center justify-between text-stone-400">
                      <span>
                        {m.type === "unlimited_monthly" ? "Monthly unlimited" : m.type === "drop_in" ? "Drop-in" : "Class pack"}
                      </span>
                      <span>
                        {m.startsOn} – {m.expiresOn ?? "no expiry"}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {upcoming.length > 0 && (
            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-stone-900">Upcoming bookings</h2>
              <ul className="space-y-1 text-sm">
                {upcoming.map((u) => (
                  <li key={u.id} className="flex items-center justify-between">
                    <span className="text-stone-700">{u.classTypeName ?? "Class"}</span>
                    <span className="text-xs text-stone-400">
                      {new Date(u.startsAt).toLocaleDateString()} {new Date(u.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-stone-900">Attendance history</h2>
            {history.length === 0 && <p className="text-sm text-stone-400">No visits yet.</p>}
            <ul className="divide-y divide-stone-100">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="text-stone-800">{h.classTypeName ?? "Class"}</div>
                    <div className="text-xs text-stone-400">{new Date(h.startsAt).toLocaleDateString()}</div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[h.status] ?? ""}`}>
                    {STATUS_LABEL[h.status] ?? h.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-stone-900">Payments</h2>
            {revenue.length === 0 && <p className="text-sm text-stone-400">No payments logged yet.</p>}
            <ul className="divide-y divide-stone-100">
              {revenue.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="text-stone-800">{r.note ?? r.source.replace("_", " ")}</div>
                    <div className="text-xs text-stone-400">{r.occurredOn}</div>
                  </div>
                  <span className="font-medium text-emerald-700">+{money(r.amount, studio.currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
