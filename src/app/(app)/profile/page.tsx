import { headers } from "next/headers";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePageContext, requireRole } from "@/lib/context";
import { generateIcsToken } from "@/lib/ics";
import { updateOwnProfileAction, createMyTeacherProfileAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;
  // Owner/manager/teacher can all reach this page now (not teacher-only) —
  // an owner or manager who also teaches classes (e.g. Gün at Kula) needs
  // their own bio/photo/ICS feed too, not just people with a "teacher"
  // studio-member role.
  const { studio, role, session } = await requirePageContext();
  requireRole(role, ["owner", "manager", "teacher"]);

  let [teacher] = await db
    .select()
    .from(schema.teachers)
    .where(and(eq(schema.teachers.studioId, studio.id), eq(schema.teachers.userId, session.userId)))
    .limit(1);

  // Fallback for someone (typically an owner/manager) who already has a
  // teachers row for this studio — because they teach classes and are
  // assignable on the schedule — but that row was never linked to their
  // login (it has no userId, e.g. it was seeded/added before they had an
  // owner account, or added without going through "Add team member").
  // Auto-link it by matching their session email against the teacher
  // row's email, the same lazy "fix on first real use" pattern as the
  // icsToken generation below, rather than requiring a manual DB fix.
  if (!teacher && session.email) {
    const [unlinked] = await db
      .select()
      .from(schema.teachers)
      .where(
        and(
          eq(schema.teachers.studioId, studio.id),
          isNull(schema.teachers.userId),
          sql`lower(${schema.teachers.email}) = lower(${session.email})`
        )
      )
      .limit(1);
    if (unlinked) {
      await db.update(schema.teachers).set({ userId: session.userId }).where(eq(schema.teachers.id, unlinked.id));
      teacher = { ...unlinked, userId: session.userId };
    }
  }

  // Lazily issue this teacher's private calendar-feed token the first
  // time they open this page — same "generate on first real use, not
  // ahead of time" pattern as the studio's default schedule template
  // (see ensureWeekGenerated). Nothing reads or writes it anywhere else.
  if (teacher && !teacher.icsToken) {
    const icsToken = generateIcsToken();
    await db.update(schema.teachers).set({ icsToken }).where(eq(schema.teachers.id, teacher.id));
    teacher = { ...teacher, icsToken };
  }

  if (!teacher) {
    return (
      <div className="max-w-lg space-y-3">
        <h1 className="text-lg font-semibold text-stone-900">My profile</h1>
        {role === "owner" || role === "manager" ? (
          <div className="space-y-3 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800">
            <p>
              You don&apos;t have a teacher profile at {studio.name} yet — that&apos;s separate from your{" "}
              {role} access, and only needed if you also teach classes here.
            </p>
            <form action={createMyTeacherProfileAction}>
              <input type="hidden" name="studioId" value={studio.id} />
              <button className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800">
                I teach here — create my teacher profile
              </button>
            </form>
          </div>
        ) : (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Your account isn&apos;t linked to a teacher profile at {studio.name} yet — ask a manager to add
            you on the Team page.
          </p>
        )}
      </div>
    );
  }

  const hdrs = await headers();
  const origin = `${hdrs.get("x-forwarded-proto") ?? "https"}://${hdrs.get("host")}`;
  const icsUrl = `${origin}/api/calendar/${teacher.icsToken}/feed.ics`;

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-stone-900">My profile</h1>
        <p className="text-sm text-stone-500">
          This bio and photo show up wherever {studio.name} lists its teachers — students see it, other
          staff can&apos;t edit it for you.
        </p>
      </div>

      {saved && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved.</p>
      )}

      <form action={updateOwnProfileAction} className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
        <input type="hidden" name="studioId" value={studio.id} />

        <div className="flex items-center gap-3">
          {teacher.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={teacher.photoUrl}
              alt={teacher.name}
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-stone-100 text-lg font-medium text-stone-400">
              {teacher.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="text-sm text-stone-500">{teacher.name}</div>
        </div>

        <div>
          <label className="block text-xs text-stone-500">Photo URL</label>
          <input
            name="photoUrl"
            type="url"
            defaultValue={teacher.photoUrl ?? ""}
            placeholder="https://…"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-stone-500">Bio</label>
          <textarea
            name="bio"
            defaultValue={teacher.bio ?? ""}
            rows={5}
            placeholder="A few sentences about your teaching style and background…"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
        </div>

        <button className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800">
          Save profile
        </button>
      </form>

      <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-stone-900">Your class calendar</h2>
        <p className="text-xs text-stone-500">
          Add this link to Google Calendar or Apple Calendar as a subscription and your classes at{" "}
          {studio.name} show up there automatically — no more checking KOP separately, and it updates
          itself whenever a class time changes or you get subbed in or out.
        </p>
        <p className="break-all rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-700">{icsUrl}</p>

        <details className="text-xs text-stone-500">
          <summary className="cursor-pointer font-medium text-stone-700">
            How to add this (Google Calendar / Apple Calendar)
          </summary>
          <div className="mt-2 space-y-3">
            <div>
              <p className="font-medium text-stone-700">Google Calendar</p>
              <ol className="ml-4 list-decimal space-y-0.5">
                <li>On a computer, open Google Calendar and click the + next to &quot;Other calendars&quot;.</li>
                <li>Choose &quot;From URL&quot;.</li>
                <li>Paste the link above, then click &quot;Add calendar&quot;.</li>
              </ol>
            </div>
            <div>
              <p className="font-medium text-stone-700">Apple Calendar (Mac)</p>
              <ol className="ml-4 list-decimal space-y-0.5">
                <li>Open the Calendar app.</li>
                <li>Choose File → New Calendar Subscription.</li>
                <li>Paste the link above and click Subscribe.</li>
              </ol>
            </div>
            <div>
              <p className="font-medium text-stone-700">iPhone / iPad</p>
              <ol className="ml-4 list-decimal space-y-0.5">
                <li>Open Settings → Calendar → Accounts → Add Account → Other.</li>
                <li>Choose &quot;Add Subscribed Calendar&quot; and paste the link above.</li>
              </ol>
            </div>
            <p className="text-stone-400">
              This link is private to you — don&apos;t share it, since anyone with it can see your class
              schedule. Calendar apps re-check it on their own schedule (usually every few hours), so a
              change on the studio&apos;s side shows up there without you doing anything.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}
