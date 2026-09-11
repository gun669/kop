import { redirect } from "next/navigation";
import { ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { runCleanupAction } from "./actions";

export const dynamic = "force-dynamic";

const KEEP_EMAIL = "gursoygun@gmail.com";

// Exact names the seed script creates — used only to pre-check the boxes
// most likely to be demo content. Everything is still shown individually
// so nothing gets removed without a human actually looking at it first.
const SEED_TEACHER_NAMES: Record<string, string[]> = {
  istanbul: ["Elif Yıldız", "Deniz Kaya", "Ayşe Demir"],
  "alchemy-uluwatu": ["Made Sujana", "Kadek Ayu", "Wayan Putra", "Kai Sørensen", "Nyoman Sari"],
};
const SEED_CLASS_TYPE_NAMES: Record<string, string[]> = {
  istanbul: ["Vinyasa Flow", "Yin Yoga", "Hatha"],
  "alchemy-uluwatu": ["Vinyasa Flow", "Yin Yoga", "Ashtanga", "Sound Healing", "Sunrise Flow"],
};
const DEMO_ONLY_EMAILS = new Set(["reception@istanbulstudio.demo", "manager@alchemyuluwatu.demo"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function count(table: any) {
  const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(table);
  return row.c as number;
}

export default async function CleanupPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { done, error } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.isSuperOwner) redirect("/dashboard");

  const studios = await db.select().from(schema.studios).orderBy(schema.studios.id);
  const studioName = new Map(studios.map((s) => [s.id, s.name]));

  const teachers = await db.select().from(schema.teachers).orderBy(schema.teachers.studioId, schema.teachers.name);
  const classTypes = await db
    .select()
    .from(schema.classTypes)
    .orderBy(schema.classTypes.studioId, schema.classTypes.name);
  const otherUsers = await db
    .select()
    .from(schema.users)
    .where(ne(schema.users.email, KEEP_EMAIL))
    .orderBy(schema.users.email);

  const [guestsCount, classSessionsCount, templatesCount, bookingsCount, signInsCount, expensesCount, revenueCount] =
    await Promise.all([
      count(schema.guests),
      count(schema.classSessions),
      count(schema.scheduleTemplates),
      count(schema.bookings),
      count(schema.signIns),
      count(schema.expenses),
      count(schema.revenueEntries),
    ]);

  const studioSlugById = new Map(studios.map((s) => [s.id, s.slug]));
  const looksLikeSeedTeacher = (t: (typeof teachers)[number]) =>
    (SEED_TEACHER_NAMES[studioSlugById.get(t.studioId) ?? ""] ?? []).includes(t.name);
  const looksLikeSeedClassType = (c: (typeof classTypes)[number]) =>
    (SEED_CLASS_TYPE_NAMES[studioSlugById.get(c.studioId) ?? ""] ?? []).includes(c.name);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-stone-900">Clean up demo data</h1>
        <p className="mt-1 text-sm text-stone-500">
          Owner-only. Your two studios and your own login are never touched by this page — everything else below
          is reviewed one item at a time. Nothing is checked automatically except the items that exactly match the
          original demo seed data; anything you or your team have actually entered starts unchecked. Review the
          boxes, then confirm at the bottom.
        </p>
      </div>

      {done && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Done — the checked items were deleted. Refresh to see the updated lists.
        </p>
      )}
      {error === "confirm" && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          Nothing was deleted — you need to type DELETE exactly (all caps) to confirm.
        </p>
      )}

      <form action={runCleanupAction} className="space-y-6">
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-900">Staff logins ({otherUsers.length})</h2>
          <p className="mt-1 text-xs text-stone-500">
            Your own login isn&apos;t listed — it can&apos;t be removed here. Checked = this login gets deleted.
          </p>
          <div className="mt-3 divide-y divide-stone-100">
            {otherUsers.length === 0 && <p className="py-2 text-sm text-stone-400">No other logins.</p>}
            {otherUsers.map((u) => (
              <label key={u.id} className="flex items-center gap-3 py-2 text-sm">
                <input
                  type="checkbox"
                  name="userIds"
                  value={u.id}
                  defaultChecked={DEMO_ONLY_EMAILS.has(u.email)}
                  className="h-4 w-4"
                />
                <span className="flex-1">
                  <span className="font-medium text-stone-800">{u.name}</span>{" "}
                  <span className="text-stone-500">— {u.email}</span>
                </span>
                {DEMO_ONLY_EMAILS.has(u.email) && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">demo login</span>
                )}
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-900">Teachers ({teachers.length})</h2>
          <div className="mt-3 divide-y divide-stone-100">
            {teachers.length === 0 && <p className="py-2 text-sm text-stone-400">No teachers.</p>}
            {teachers.map((t) => (
              <label key={t.id} className="flex items-center gap-3 py-2 text-sm">
                <input
                  type="checkbox"
                  name="teacherIds"
                  value={t.id}
                  defaultChecked={looksLikeSeedTeacher(t)}
                  className="h-4 w-4"
                />
                <span className="flex-1">
                  <span className="font-medium text-stone-800">{t.name}</span>{" "}
                  <span className="text-stone-500">— {studioName.get(t.studioId)}</span>
                </span>
                {looksLikeSeedTeacher(t) && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
                    matches demo seed
                  </span>
                )}
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-900">Class types ({classTypes.length})</h2>
          <div className="mt-3 divide-y divide-stone-100">
            {classTypes.length === 0 && <p className="py-2 text-sm text-stone-400">No class types.</p>}
            {classTypes.map((c) => (
              <label key={c.id} className="flex items-center gap-3 py-2 text-sm">
                <input
                  type="checkbox"
                  name="classTypeIds"
                  value={c.id}
                  defaultChecked={looksLikeSeedClassType(c)}
                  className="h-4 w-4"
                />
                <span className="flex-1">
                  <span className="font-medium text-stone-800">{c.name}</span>{" "}
                  <span className="text-stone-500">— {studioName.get(c.studioId)}</span>
                  {c.description && <span className="text-stone-400"> · has a description</span>}
                </span>
                {looksLikeSeedClassType(c) && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
                    matches demo seed
                  </span>
                )}
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-900">Bulk day-to-day data</h2>
          <p className="mt-1 text-xs text-stone-500">
            These aren&apos;t reviewed item-by-item — each box clears the whole category. Leave unchecked anything
            you&apos;ve started using for real.
          </p>
          <div className="mt-3 space-y-3 text-sm">
            <label className="flex items-start gap-3">
              <input type="checkbox" name="clearGuests" className="mt-0.5 h-4 w-4" />
              <span>
                <span className="font-medium text-stone-800">Guests ({guestsCount})</span>
                <span className="block text-stone-500">
                  Also clears their sign-ins, bookings, and memberships ({signInsCount} sign-ins,{" "}
                  {bookingsCount} bookings).
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input type="checkbox" name="clearSchedule" className="mt-0.5 h-4 w-4" />
              <span>
                <span className="font-medium text-stone-800">
                  Class schedule &amp; templates ({classSessionsCount} sessions, {templatesCount} templates)
                </span>
                <span className="block text-stone-500">
                  Every scheduled/past class and saved weekly template, for both studios.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input type="checkbox" name="clearMoney" className="mt-0.5 h-4 w-4" />
              <span>
                <span className="font-medium text-stone-800">
                  Revenue &amp; expense entries ({expensesCount} expenses, {revenueCount} revenue)
                </span>
                <span className="block text-stone-500">Every manually-logged revenue/expense row.</span>
              </span>
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-red-200 bg-red-50 p-4">
          <label className="block text-sm font-medium text-red-900">
            Type DELETE to confirm
            <input
              name="confirmText"
              required
              placeholder="DELETE"
              className="mt-1 block w-full rounded-lg border border-red-300 px-3 py-2 text-sm"
            />
          </label>
          <button className="mt-3 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800">
            Delete everything checked above
          </button>
        </section>
      </form>
    </div>
  );
}
