import Link from "next/link";
import { and, eq, gte, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePageContext, requireRole } from "@/lib/context";
import {
  mondayOfWeek,
  weekDays,
  parseWeekParam,
  localDateKey,
  formatDayLabel,
  formatTimeInZone,
  formatTimeValue,
} from "@/lib/time";
import { ensureWeekGenerated } from "@/lib/scheduleTemplates";
import {
  createSessionAction,
  updateSessionAction,
  removeSessionAction,
  reinstateSessionAction,
  copyWeekAction,
  applyTemplateAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const { studio, role } = await requirePageContext();
  requireRole(role, ["owner", "manager"]);

  const weekStart = parseWeekParam(week, studio.timezone);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
  const days = weekDays(weekStart);

  // Lazily fill this week in from the studio's default template, if it's
  // empty and one exists. A no-op most of the time (past/already-viewed
  // weeks already have sessions).
  await ensureWeekGenerated(studio, weekStart, weekEnd);

  const prevWeekKey = localDateKey(new Date(weekStart.getTime() - 7 * 86_400_000), studio.timezone);
  const nextWeekKey = localDateKey(new Date(weekStart.getTime() + 7 * 86_400_000), studio.timezone);
  const thisWeekKey = localDateKey(mondayOfWeek(studio.timezone), studio.timezone);
  const isCurrentWeek = localDateKey(weekStart, studio.timezone) === thisWeekKey;

  const [sessions, teachers, classTypes, templates] = await Promise.all([
    db
      .select({
        id: schema.classSessions.id,
        startsAt: schema.classSessions.startsAt,
        room: schema.classSessions.room,
        capacity: schema.classSessions.capacity,
        status: schema.classSessions.status,
        teacherId: schema.classSessions.teacherId,
        classTypeId: schema.classSessions.classTypeId,
        teacherName: schema.teachers.name,
        classTypeName: schema.classTypes.name,
      })
      .from(schema.classSessions)
      .leftJoin(schema.teachers, eq(schema.classSessions.teacherId, schema.teachers.id))
      .leftJoin(schema.classTypes, eq(schema.classSessions.classTypeId, schema.classTypes.id))
      .where(
        and(
          eq(schema.classSessions.studioId, studio.id),
          gte(schema.classSessions.startsAt, weekStart),
          lt(schema.classSessions.startsAt, weekEnd)
        )
      )
      .orderBy(schema.classSessions.startsAt),
    db
      .select()
      .from(schema.teachers)
      .where(and(eq(schema.teachers.studioId, studio.id), eq(schema.teachers.active, true))),
    db
      .select()
      .from(schema.classTypes)
      .where(and(eq(schema.classTypes.studioId, studio.id), eq(schema.classTypes.active, true))),
    db
      .select()
      .from(schema.scheduleTemplates)
      .where(eq(schema.scheduleTemplates.studioId, studio.id)),
  ]);

  const sessionsByDay = new Map<string, typeof sessions>();
  for (const day of days) sessionsByDay.set(localDateKey(day, studio.timezone), []);
  for (const s of sessions) {
    const key = localDateKey(s.startsAt, studio.timezone);
    sessionsByDay.get(key)?.push(s);
  }

  const rangeLabel = `${formatDayLabel(days[0], studio.timezone)} – ${formatDayLabel(days[6], studio.timezone)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-stone-900">Schedule</h1>
          <p className="text-sm text-stone-500">{rangeLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/schedule?week=${prevWeekKey}`} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-600 hover:bg-white">
            ← Previous week
          </Link>
          {!isCurrentWeek && (
            <Link href="/schedule" className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-600 hover:bg-white">
              This week
            </Link>
          )}
          <Link href={`/schedule?week=${nextWeekKey}`} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-600 hover:bg-white">
            Next week →
          </Link>
          <form action={copyWeekAction}>
            <input type="hidden" name="studioId" value={studio.id} />
            <input type="hidden" name="fromWeekStart" value={new Date(weekStart.getTime() - 7 * 86_400_000).toISOString()} />
            <input type="hidden" name="toWeekStart" value={weekStart.toISOString()} />
            <button className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-800">
              Copy last week in
            </button>
          </form>
          {templates.length > 0 && (
            <form action={applyTemplateAction} className="flex items-center gap-1.5">
              <input type="hidden" name="studioId" value={studio.id} />
              <input type="hidden" name="weekStart" value={weekStart.toISOString()} />
              <select
                name="templateId"
                defaultValue={templates.find((t) => t.isDefault)?.id ?? templates[0].id}
                className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-700"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
              <button className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-600 hover:bg-white">
                Apply template
              </button>
            </form>
          )}
          <Link href="/templates" className="text-sm text-stone-500 hover:text-stone-900">
            Manage templates
          </Link>
        </div>
      </div>

      {teachers.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No teachers on file for {studio.name} yet —{" "}
          <Link href="/team" className="underline">
            add one on the Team page
          </Link>
          .
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {days.map((day) => {
          const key = localDateKey(day, studio.timezone);
          const daySessions = sessionsByDay.get(key) ?? [];
          return (
            <div key={key} className="rounded-xl border border-stone-200 bg-white">
              <div className="border-b border-stone-100 px-4 py-2 text-sm font-medium text-stone-700">
                {formatDayLabel(day, studio.timezone)}
              </div>
              <ul className="divide-y divide-stone-100">
                {daySessions.length === 0 && (
                  <li className="px-4 py-3 text-sm text-stone-400">No classes.</li>
                )}
                {daySessions.map((s) => (
                  <li key={s.id} className={`px-4 py-3 ${s.status === "cancelled" ? "opacity-50" : ""}`}>
                    <details>
                      <summary className="cursor-pointer text-sm">
                        <span className="font-medium text-stone-800">{formatTimeInZone(s.startsAt, studio.timezone)}</span>{" "}
                        <span className="text-stone-700">{s.classTypeName ?? "Class"}</span>
                        {s.status === "cancelled" && <span className="ml-2 text-xs text-red-600">cancelled</span>}
                        <div className="pl-0 text-xs text-stone-400">
                          {s.teacherName ?? "TBA"} {s.room ? `· ${s.room}` : ""} · cap {s.capacity}
                        </div>
                      </summary>

                      <div className="mt-3 space-y-2 rounded-lg bg-stone-50 p-3">
                        {s.status === "cancelled" ? (
                          <form action={reinstateSessionAction}>
                            <input type="hidden" name="studioId" value={studio.id} />
                            <input type="hidden" name="sessionId" value={s.id} />
                            <button className="text-xs font-medium text-stone-700 hover:underline">
                              Un-cancel this class
                            </button>
                          </form>
                        ) : (
                          <>
                            <form action={updateSessionAction} className="space-y-2">
                              <input type="hidden" name="studioId" value={studio.id} />
                              <input type="hidden" name="sessionId" value={s.id} />
                              <div className="flex gap-2">
                                <input
                                  type="date"
                                  name="date"
                                  defaultValue={key}
                                  required
                                  className="flex-1 rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
                                />
                                <input
                                  type="time"
                                  name="time"
                                  defaultValue={formatTimeValue(s.startsAt, studio.timezone)}
                                  required
                                  className="w-28 rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
                                />
                              </div>
                              <select name="teacherId" defaultValue={s.teacherId ?? ""} className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs">
                                <option value="">No teacher assigned</option>
                                {teachers.map((t) => (
                                  <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                              </select>
                              <select name="classTypeId" defaultValue={s.classTypeId ?? ""} className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs">
                                <option value="">Class type</option>
                                {classTypes.map((c) => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                              <div className="flex gap-2">
                                <input name="room" defaultValue={s.room ?? ""} placeholder="Room / shala" className="flex-1 rounded-lg border border-stone-300 px-2 py-1.5 text-xs" />
                                <input type="number" name="capacity" defaultValue={s.capacity} min={1} className="w-20 rounded-lg border border-stone-300 px-2 py-1.5 text-xs" />
                              </div>
                              <button className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-800">
                                Save changes
                              </button>
                            </form>
                            <form action={removeSessionAction}>
                              <input type="hidden" name="studioId" value={studio.id} />
                              <input type="hidden" name="sessionId" value={s.id} />
                              <button className="text-xs text-red-600 hover:underline">Remove this class</button>
                            </form>
                          </>
                        )}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>

              <details className="border-t border-stone-100 px-4 py-3">
                <summary className="cursor-pointer text-sm text-stone-500">+ Add a class</summary>
                <form action={createSessionAction} className="mt-2 space-y-2">
                  <input type="hidden" name="studioId" value={studio.id} />
                  <input type="hidden" name="date" value={key} />
                  <input type="time" name="time" required defaultValue="09:00" className="w-28 rounded-lg border border-stone-300 px-2 py-1.5 text-xs" />
                  <select name="teacherId" className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs">
                    <option value="">No teacher assigned</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <select name="classTypeId" className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs">
                    <option value="">Class type</option>
                    {classTypes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <input name="room" placeholder="Room / shala" className="flex-1 rounded-lg border border-stone-300 px-2 py-1.5 text-xs" />
                    <input type="number" name="capacity" defaultValue={20} min={1} className="w-20 rounded-lg border border-stone-300 px-2 py-1.5 text-xs" />
                  </div>
                  <button className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-800">
                    Add class
                  </button>
                </form>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}
