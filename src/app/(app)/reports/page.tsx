import { and, eq, gte, lte, lt, ne, inArray, asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePageContext, requireRole } from "@/lib/context";
import { localDateKey, combineLocalDateTime } from "@/lib/time";
import { setTeacherPayRateAction } from "./actions";

export const dynamic = "force-dynamic";

function money(n: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function ymd(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}
function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function addDaysToDateKey(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PAY_TYPE_LABELS: Record<string, string> = {
  per_class: "per class taught",
  per_head: "per student attended",
  salary: "flat salary",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { studio, role } = await requirePageContext();
  requireRole(role, ["owner", "manager"]);

  const { from: fromParam, to: toParam } = await searchParams;
  const todayKey = localDateKey(new Date(), studio.timezone);
  const [ty, tm] = todayKey.split("-").map(Number);

  const presets: Record<string, { label: string; from: string; to: string }> = {
    this_month: { label: "This month", from: ymd(ty, tm, 1), to: todayKey },
    last_month: (() => {
      const lm = tm === 1 ? 12 : tm - 1;
      const ly = tm === 1 ? ty - 1 : ty;
      return { label: "Last month", from: ymd(ly, lm, 1), to: ymd(ly, lm, daysInMonth(ly, lm)) };
    })(),
    last_3_months: (() => {
      let m3 = tm - 2;
      let y3 = ty;
      while (m3 <= 0) {
        m3 += 12;
        y3 -= 1;
      }
      return { label: "Last 3 months", from: ymd(y3, m3, 1), to: todayKey };
    })(),
    this_year: { label: "This year", from: ymd(ty, 1, 1), to: todayKey },
  };

  const from = fromParam && DATE_RE.test(fromParam) ? fromParam : presets.this_month.from;
  const to = toParam && DATE_RE.test(toParam) ? toParam : presets.this_month.to;

  const rangeStart = combineLocalDateTime(from, "00:00", studio.timezone);
  const rangeEnd = combineLocalDateTime(addDaysToDateKey(to, 1), "00:00", studio.timezone);

  const [revenue, expenseRows, teachers, sessionsInRange] = await Promise.all([
    db
      .select()
      .from(schema.revenueEntries)
      .where(
        and(
          eq(schema.revenueEntries.studioId, studio.id),
          gte(schema.revenueEntries.occurredOn, from),
          lte(schema.revenueEntries.occurredOn, to)
        )
      ),
    db
      .select()
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.studioId, studio.id),
          gte(schema.expenses.occurredOn, from),
          lte(schema.expenses.occurredOn, to)
        )
      ),
    db
      .select()
      .from(schema.teachers)
      .where(and(eq(schema.teachers.studioId, studio.id), eq(schema.teachers.active, true)))
      .orderBy(asc(schema.teachers.name)),
    db
      .select({
        id: schema.classSessions.id,
        teacherId: schema.classSessions.teacherId,
      })
      .from(schema.classSessions)
      .where(
        and(
          eq(schema.classSessions.studioId, studio.id),
          gte(schema.classSessions.startsAt, rangeStart),
          lt(schema.classSessions.startsAt, rangeEnd),
          ne(schema.classSessions.status, "cancelled")
        )
      ),
  ]);

  const sessionIdsInRange = sessionsInRange.map((s) => s.id);
  const attendedSignIns = sessionIdsInRange.length
    ? await db
        .select({ classSessionId: schema.signIns.classSessionId })
        .from(schema.signIns)
        .where(
          and(
            eq(schema.signIns.studioId, studio.id),
            eq(schema.signIns.status, "attended"),
            inArray(schema.signIns.classSessionId, sessionIdsInRange)
          )
        )
    : [];

  // --- Revenue & expenses (P&L) ---
  const revenueBySource = new Map<string, { count: number; total: number }>();
  for (const r of revenue) {
    const cur = revenueBySource.get(r.source) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(r.amount);
    revenueBySource.set(r.source, cur);
  }
  const totalRevenue = revenue.reduce((s, r) => s + Number(r.amount), 0);

  const expensesByCategory = new Map<string, { count: number; total: number }>();
  for (const e of expenseRows) {
    const cur = expensesByCategory.get(e.category) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(e.amount);
    expensesByCategory.set(e.category, cur);
  }
  const totalExpenses = expenseRows.reduce((s, e) => s + Number(e.amount), 0);
  const net = totalRevenue - totalExpenses;

  // --- Teacher payroll (estimated from attendance, not yet a payment record) ---
  const sessionCountByTeacher = new Map<number, number>();
  const sessionTeacherById = new Map<number, number | null>();
  for (const s of sessionsInRange) {
    sessionTeacherById.set(s.id, s.teacherId);
    if (s.teacherId) {
      sessionCountByTeacher.set(s.teacherId, (sessionCountByTeacher.get(s.teacherId) ?? 0) + 1);
    }
  }
  const attendedCountByTeacher = new Map<number, number>();
  for (const a of attendedSignIns) {
    const teacherId = sessionTeacherById.get(a.classSessionId);
    if (!teacherId) continue;
    attendedCountByTeacher.set(teacherId, (attendedCountByTeacher.get(teacherId) ?? 0) + 1);
  }

  const payrollRows = teachers.map((t) => {
    const classesCount = sessionCountByTeacher.get(t.id) ?? 0;
    const studentsCount = attendedCountByTeacher.get(t.id) ?? 0;
    const rate = t.payRate !== null ? Number(t.payRate) : null;
    let computed: number | null = null;
    if (rate !== null && t.payRateType === "per_class") computed = rate * classesCount;
    else if (rate !== null && t.payRateType === "per_head") computed = rate * studentsCount;
    return {
      id: t.id,
      name: t.name,
      payRateType: t.payRateType,
      payRate: t.payRate,
      classesCount,
      studentsCount,
      computed,
    };
  });
  const totalPayrollOwed = payrollRows.reduce((s, r) => s + (r.computed ?? 0), 0);

  function periodHref(f: string, t: string) {
    return `/reports?from=${f}&to=${t}`;
  }

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-stone-900">Reports — {studio.name}</h1>
        <p className="mt-1 text-sm text-stone-500">
          Revenue, expenses, and estimated teacher payroll for a period you choose.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(presets).map(([key, p]) => {
          const active = from === p.from && to === p.to;
          return (
            <a
              key={key}
              href={periodHref(p.from, p.to)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                active
                  ? "bg-stone-900 text-white"
                  : "border border-stone-300 text-stone-600 hover:bg-stone-50"
              }`}
            >
              {p.label}
            </a>
          );
        })}
        <form className="flex items-center gap-1.5">
          <input type="date" name="from" defaultValue={from} className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs" />
          <span className="text-xs text-stone-400">to</span>
          <input type="date" name="to" defaultValue={to} className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs" />
          <button className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs text-stone-600 hover:bg-stone-50">
            Go
          </button>
        </form>
      </div>
      <p className="-mt-6 text-xs text-stone-400">
        {from} – {to}
      </p>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-stone-900">Revenue & expenses</h2>
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Revenue" value={money(totalRevenue, studio.currency)} tone="good" />
          <StatTile label="Expenses" value={money(totalExpenses, studio.currency)} tone="bad" />
          <StatTile label="Net" value={money(net, studio.currency)} tone={net >= 0 ? "good" : "bad"} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-stone-200 bg-white">
            <div className="border-b border-stone-100 px-4 py-2 text-sm font-medium text-stone-700">
              Revenue by source
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-stone-100">
                {[...revenueBySource.entries()].map(([source, v]) => (
                  <tr key={source}>
                    <td className="px-4 py-2 text-stone-700">
                      {source.replace("_", " ")} <span className="text-xs text-stone-400">({v.count})</span>
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-emerald-700">
                      {money(v.total, studio.currency)}
                    </td>
                  </tr>
                ))}
                {revenueBySource.size === 0 && (
                  <tr>
                    <td className="px-4 py-3 text-sm text-stone-400" colSpan={2}>
                      No revenue in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-stone-200 bg-white">
            <div className="border-b border-stone-100 px-4 py-2 text-sm font-medium text-stone-700">
              Expenses by category
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-stone-100">
                {[...expensesByCategory.entries()].map(([category, v]) => (
                  <tr key={category}>
                    <td className="px-4 py-2 text-stone-700">
                      {category.replace("_", " ")} <span className="text-xs text-stone-400">({v.count})</span>
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-red-700">
                      {money(v.total, studio.currency)}
                    </td>
                  </tr>
                ))}
                {expensesByCategory.size === 0 && (
                  <tr>
                    <td className="px-4 py-3 text-sm text-stone-400" colSpan={2}>
                      No expenses in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold text-stone-900">Teacher payroll (estimated)</h2>
        <p className="mb-3 text-xs text-stone-400">
          Computed from classes taught and attendance in this period × each teacher&apos;s rate below — not
          yet a payment record. To record an actual payout, add a &quot;Teacher pay&quot; expense entry on{" "}
          <a href="/money" className="underline">
            Revenue &amp; expenses
          </a>
          .
        </p>
        <div className="rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-400">
                <th className="px-4 py-2 font-medium">Teacher</th>
                <th className="px-4 py-2 font-medium">Classes</th>
                <th className="px-4 py-2 font-medium">Attended</th>
                <th className="px-4 py-2 font-medium">Rate</th>
                <th className="px-4 py-2 text-right font-medium">Est. owed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {payrollRows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-stone-800">{r.name}</td>
                  <td className="px-4 py-2 text-stone-600">{r.classesCount}</td>
                  <td className="px-4 py-2 text-stone-600">{r.studentsCount}</td>
                  <td className="px-4 py-2">
                    <form action={setTeacherPayRateAction} className="flex items-center gap-1">
                      <input type="hidden" name="studioId" value={studio.id} />
                      <input type="hidden" name="teacherId" value={r.id} />
                      <select
                        name="payRateType"
                        defaultValue={r.payRateType}
                        className="rounded-lg border border-stone-300 px-1.5 py-1 text-xs text-stone-600"
                      >
                        <option value="per_class">per class</option>
                        <option value="per_head">per student</option>
                        <option value="salary">salary</option>
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        name="payRate"
                        defaultValue={r.payRate ?? ""}
                        placeholder={studio.currency}
                        className="w-20 rounded-lg border border-stone-300 px-1.5 py-1 text-xs"
                      />
                      <button className="rounded-lg border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50">
                        Save
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-stone-800">
                    {r.payRate === null
                      ? <span className="text-xs font-normal text-stone-400">no rate set</span>
                      : r.payRateType === "salary"
                        ? <span className="text-xs font-normal text-stone-400">{money(Number(r.payRate), studio.currency)} {PAY_TYPE_LABELS.salary}</span>
                        : money(r.computed ?? 0, studio.currency)}
                  </td>
                </tr>
              ))}
              {payrollRows.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-sm text-stone-400" colSpan={5}>
                    No active teachers.
                  </td>
                </tr>
              )}
            </tbody>
            {payrollRows.length > 0 && (
              <tfoot>
                <tr className="border-t border-stone-200">
                  <td className="px-4 py-2 text-xs font-medium text-stone-500" colSpan={4}>
                    Total estimated (per-class/per-student teachers only)
                  </td>
                  <td className="px-4 py-2 text-right text-sm font-semibold text-stone-900">
                    {money(totalPayrollOwed, studio.currency)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
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
