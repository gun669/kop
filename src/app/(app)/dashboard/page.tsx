import { and, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePageContext } from "@/lib/context";
import { todayRangeInTimeZone } from "@/lib/time";
import { AttendanceTrendChart, MoneyTrendChart } from "./DashboardCharts";

export const dynamic = "force-dynamic";

function money(n: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

function dateKey(d: Date | string) {
  return (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));
}

export default async function DashboardPage() {
  const { studio, role, session } = await requirePageContext();
  // Owner/manager/receptionist keep seeing the full studio dashboard, same
  // as before. Only a teacher gets scoped down to their own numbers —
  // that's the one role this page was never actually gating.
  const showStudioWideData = role !== "teacher";

  const { start: todayStart, end: todayEnd } = todayRangeInTimeZone(studio.timezone);
  const window14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const window30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // A teacher's dashboard shows only their own numbers — revenue, expenses,
  // and other teachers' performance are studio-level data that stays with
  // reception/management. Scoped at the query level (not just hidden in the
  // UI) so a teacher's browser never even receives anyone else's figures.
  const teacherRecord =
    role === "teacher"
      ? (
          await db
            .select()
            .from(schema.teachers)
            .where(and(eq(schema.teachers.studioId, studio.id), eq(schema.teachers.userId, session.userId)))
            .limit(1)
        )[0] ?? null
      : null;

  const sessionScope =
    role === "teacher" ? [eq(schema.classSessions.teacherId, teacherRecord?.id ?? -1)] : [];

  const [classesToday, sessions30, teachers] = await Promise.all([
    db
      .select()
      .from(schema.classSessions)
      .where(
        and(
          eq(schema.classSessions.studioId, studio.id),
          gte(schema.classSessions.startsAt, todayStart),
          ...sessionScope
        )
      ),
    db
      .select()
      .from(schema.classSessions)
      .where(and(eq(schema.classSessions.studioId, studio.id), gte(schema.classSessions.startsAt, window30), ...sessionScope)),
    showStudioWideData
      ? db.select().from(schema.teachers).where(and(eq(schema.teachers.studioId, studio.id), eq(schema.teachers.active, true)))
      : Promise.resolve([]),
  ]);

  const sessionIds30 = sessions30.map((s) => s.id);

  const [signIns30, revenue30, expenses30] = await Promise.all([
    role === "teacher"
      ? sessionIds30.length > 0
        ? db
            .select()
            .from(schema.signIns)
            .where(
              and(
                eq(schema.signIns.studioId, studio.id),
                gte(schema.signIns.checkedInAt, window30),
                inArray(schema.signIns.classSessionId, sessionIds30)
              )
            )
        : Promise.resolve([])
      : db
          .select()
          .from(schema.signIns)
          .where(and(eq(schema.signIns.studioId, studio.id), gte(schema.signIns.checkedInAt, window30))),
    showStudioWideData
      ? db
          .select()
          .from(schema.revenueEntries)
          .where(and(eq(schema.revenueEntries.studioId, studio.id), gte(schema.revenueEntries.occurredOn, dateKey(window30))))
      : Promise.resolve([]),
    showStudioWideData
      ? db
          .select()
          .from(schema.expenses)
          .where(and(eq(schema.expenses.studioId, studio.id), gte(schema.expenses.occurredOn, dateKey(window30))))
      : Promise.resolve([]),
  ]);

  const classesTodayCount = classesToday.filter(
    (s) => s.startsAt >= todayStart && s.startsAt < todayEnd
  ).length;

  const attended = signIns30.filter((s) => s.status === "attended").length;
  const noShow = signIns30.filter((s) => s.status === "no_show").length;
  const lateCancel = signIns30.filter((s) => s.status === "late_cancel").length;
  const attendanceRate = attended + noShow + lateCancel > 0 ? Math.round((attended / (attended + noShow + lateCancel)) * 100) : null;

  const revenueSum = revenue30.reduce((sum, r) => sum + Number(r.amount), 0);
  const expenseSum = expenses30.reduce((sum, e) => sum + Number(e.amount), 0);

  // --- 14-day attendance trend ---
  const attendanceByDay = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    attendanceByDay.set(dateKey(d), 0);
  }
  for (const s of signIns30) {
    if (s.status !== "attended") continue;
    const key = dateKey(s.checkedInAt);
    if (attendanceByDay.has(key)) {
      attendanceByDay.set(key, (attendanceByDay.get(key) ?? 0) + 1);
    }
  }
  const attendanceTrend = Array.from(attendanceByDay.entries()).map(([date, attended]) => ({
    date: date.slice(5),
    attended,
  }));

  // --- 14-day revenue vs expense trend ---
  const moneyByDay = new Map<string, { revenue: number; expense: number }>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    moneyByDay.set(dateKey(d), { revenue: 0, expense: 0 });
  }
  for (const r of revenue30) {
    const key = dateKey(r.occurredOn);
    if (moneyByDay.has(key)) moneyByDay.get(key)!.revenue += Number(r.amount);
  }
  for (const e of expenses30) {
    const key = dateKey(e.occurredOn);
    if (moneyByDay.has(key)) moneyByDay.get(key)!.expense += Number(e.amount);
  }
  const moneyTrend = Array.from(moneyByDay.entries()).map(([date, v]) => ({
    date: date.slice(5),
    ...v,
  }));

  // --- teacher performance (last 30 days) ---
  const teacherRows = teachers.map((t) => {
    const theirSessions = sessions30.filter((s) => s.teacherId === t.id);
    const sessionIds = new Set(theirSessions.map((s) => s.id));
    const theirSignIns = signIns30.filter((s) => sessionIds.has(s.classSessionId));
    const a = theirSignIns.filter((s) => s.status === "attended").length;
    const ns = theirSignIns.filter((s) => s.status === "no_show").length;
    return {
      id: t.id,
      name: t.name,
      classesTaught: theirSessions.length,
      avgAttendance: theirSessions.length > 0 ? (a / theirSessions.length).toFixed(1) : "–",
      noShowRate: a + ns > 0 ? `${Math.round((ns / (a + ns)) * 100)}%` : "–",
    };
  });

  return (
    <div className="space-y-6">
      {/* TEMPORARY DEBUG — remove once the teacher-scoping issue is diagnosed */}
      <p className="rounded bg-yellow-100 px-2 py-1 font-mono text-[11px] text-yellow-900">
        debug: role=&quot;{role}&quot; showStudioWideData={String(showStudioWideData)} email=
        {session.email} studioId={studio.id} teacherRecordId={teacherRecord?.id ?? "null"}
      </p>
      <div>
        <h1 className="text-lg font-semibold text-stone-900">{studio.name}</h1>
        <p className="text-sm text-stone-500">Last 30 days, unless noted</p>
      </div>

      <div className={`grid grid-cols-2 gap-3 ${showStudioWideData ? "md:grid-cols-5" : "md:grid-cols-3"}`}>
        <StatTile label="Classes today" value={String(classesTodayCount)} />
        <StatTile label="Attendance rate" value={attendanceRate !== null ? `${attendanceRate}%` : "–"} />
        {showStudioWideData ? (
          <>
            <StatTile label="Revenue" value={money(revenueSum, studio.currency)} tone="good" />
            <StatTile label="Expenses" value={money(expenseSum, studio.currency)} tone="bad" />
            <StatTile
              label="Net"
              value={money(revenueSum - expenseSum, studio.currency)}
              tone={revenueSum - expenseSum >= 0 ? "good" : "bad"}
            />
          </>
        ) : (
          <StatTile label="Classes taught (30d)" value={String(sessions30.length)} />
        )}
      </div>

      <div className={`grid grid-cols-1 gap-6 ${showStudioWideData ? "lg:grid-cols-2" : ""}`}>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-stone-700">
            {showStudioWideData ? "Attendance, last 14 days" : "Your attendance, last 14 days"}
          </h2>
          <AttendanceTrendChart data={attendanceTrend} />
        </div>
        {showStudioWideData && (
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-medium text-stone-700">Revenue vs. expenses, last 14 days</h2>
            <MoneyTrendChart data={moneyTrend} currency={studio.currency} />
          </div>
        )}
      </div>

      {showStudioWideData && (
        <div className="rounded-xl border border-stone-200 bg-white">
          <div className="border-b border-stone-100 px-4 py-2 text-sm font-medium text-stone-700">
            Teacher performance, last 30 days
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-400">
                <th className="px-4 py-2 font-medium">Teacher</th>
                <th className="px-4 py-2 font-medium">Classes taught</th>
                <th className="px-4 py-2 font-medium">Avg. attendance</th>
                <th className="px-4 py-2 font-medium">No-show rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {teacherRows.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2 text-stone-800">{t.name}</td>
                  <td className="px-4 py-2 text-stone-600">{t.classesTaught}</td>
                  <td className="px-4 py-2 text-stone-600">{t.avgAttendance}</td>
                  <td className="px-4 py-2 text-stone-600">{t.noShowRate}</td>
                </tr>
              ))}
              {teacherRows.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-sm text-stone-400" colSpan={4}>
                    No teachers yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  const toneClass =
    tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-stone-900";
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
