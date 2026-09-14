import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePageContext, requireRole } from "@/lib/context";
import { localDateKey } from "@/lib/time";
import { BILL_CATEGORIES, BILL_FREQUENCIES, billCategoryLabel, ensureRecurringBillOccurrences } from "@/lib/bills";
import { addVendorBillAction, markBillPaidAction, deleteVendorBillAction } from "./actions";

export const dynamic = "force-dynamic";

function money(amount: string, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
}

function StatTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "bad" | "warn";
}) {
  const toneClass =
    tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-stone-900";
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

export default async function BillsPage() {
  const { studio, role } = await requirePageContext();
  requireRole(role, ["owner", "manager"]);

  const todayKey = localDateKey(new Date(), studio.timezone);

  // Lazy top-up: generate any recurring bills' upcoming instances before
  // reading the list, same convention as the schedule page auto-filling
  // an empty future week.
  await ensureRecurringBillOccurrences(studio.id, todayKey);

  const bills = await db
    .select()
    .from(schema.vendorBills)
    .where(eq(schema.vendorBills.studioId, studio.id))
    .orderBy(desc(schema.vendorBills.status), schema.vendorBills.dueDate);

  const unpaid = bills.filter((b) => b.status === "unpaid");
  const overdue = unpaid.filter((b) => b.dueDate < todayKey);
  const dueSoonHorizon = new Date(`${todayKey}T12:00:00Z`);
  dueSoonHorizon.setUTCDate(dueSoonHorizon.getUTCDate() + 7);
  const dueSoonKey = dueSoonHorizon.toISOString().slice(0, 10);
  const dueThisWeek = unpaid.filter((b) => b.dueDate >= todayKey && b.dueDate <= dueSoonKey);

  const overdueTotal = overdue.reduce((s, b) => s + Number(b.amount), 0);
  const dueThisWeekTotal = dueThisWeek.reduce((s, b) => s + Number(b.amount), 0);
  const totalUnpaid = unpaid.reduce((s, b) => s + Number(b.amount), 0);

  const paidRecently = bills.filter((b) => b.status === "paid").slice(0, 10);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-stone-900">Bills (Accounts Payable)</h1>
        <p className="text-sm text-stone-500">
          Vendor bills, teacher pay, and anything else the studio owes — due dates and paid/unpaid
          status, so you know what cash you need right now.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Overdue" value={money(String(overdueTotal), studio.currency)} tone={overdueTotal > 0 ? "bad" : "neutral"} />
        <StatTile label="Due in next 7 days" value={money(String(dueThisWeekTotal), studio.currency)} tone={dueThisWeekTotal > 0 ? "warn" : "neutral"} />
        <StatTile label="Total unpaid" value={money(String(totalUnpaid), studio.currency)} />
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-stone-900">Add a bill</h2>
        <form action={addVendorBillAction} className="space-y-2" id="bill-form">
          <input type="hidden" name="studioId" value={studio.id} />
          <div className="flex flex-wrap gap-2">
            <input
              name="vendorName"
              placeholder="Vendor (e.g. Bebek Elektrik, Ayşe Demir)"
              required
              className="flex-1 min-w-[180px] rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
            <select name="category" className="rounded-lg border border-stone-300 px-2 py-2 text-sm">
              {BILL_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <input
            name="description"
            placeholder="Description (optional) — e.g. September rent, roof repair"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <input
              type="number"
              step="0.01"
              name="amount"
              required
              placeholder={`Amount (${studio.currency})`}
              className="w-40 rounded-lg border border-stone-300 px-2 py-2 text-sm"
            />
            <input type="date" name="dueDate" required defaultValue={todayKey} className="rounded-lg border border-stone-300 px-2 py-2 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input type="checkbox" name="isRecurring" id="isRecurring" className="rounded border-stone-300" />
            Recurring
          </label>
          <select
            name="recurrenceFrequency"
            defaultValue="monthly"
            className="rounded-lg border border-stone-300 px-2 py-2 text-sm"
          >
            {BILL_FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-stone-400">
            A recurring bill auto-generates its next occurrences (up to 60 days ahead) every time
            this page loads, so next month&apos;s cost shows up before it&apos;s due.
          </p>
          <button className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white hover:bg-stone-800">
            Add bill
          </button>
        </form>
      </div>

      <div className="rounded-xl border border-stone-200 bg-white">
        <div className="border-b border-stone-100 px-4 py-2 text-sm font-medium text-stone-700">
          Unpaid ({unpaid.length})
        </div>
        <ul className="divide-y divide-stone-100">
          {unpaid.length === 0 && <li className="px-4 py-3 text-sm text-stone-400">Nothing unpaid.</li>}
          {unpaid.map((b) => {
            const isOverdue = b.dueDate < todayKey;
            return (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <div className="text-stone-800">
                    {b.vendorName}{" "}
                    <span className="text-xs text-stone-400">· {billCategoryLabel(b.category)}</span>
                    {b.isRecurring && (
                      <span className="ml-1 rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">
                        recurring{b.recurrenceFrequency ? ` · ${b.recurrenceFrequency}` : ""}
                      </span>
                    )}
                  </div>
                  {b.description && <div className="text-xs text-stone-400">{b.description}</div>}
                  <div className={`text-xs ${isOverdue ? "text-red-600 font-medium" : "text-stone-400"}`}>
                    Due {b.dueDate}
                    {isOverdue && " · overdue"}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="font-medium text-stone-900">{money(b.amount, studio.currency)}</div>
                  <form action={markBillPaidAction}>
                    <input type="hidden" name="studioId" value={studio.id} />
                    <input type="hidden" name="billId" value={b.id} />
                    <button className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs text-stone-600 hover:bg-stone-50">
                      Mark paid
                    </button>
                  </form>
                  <form action={deleteVendorBillAction}>
                    <input type="hidden" name="studioId" value={studio.id} />
                    <input type="hidden" name="billId" value={b.id} />
                    <button className="text-xs text-stone-400 hover:text-red-600">delete</button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {paidRecently.length > 0 && (
        <details className="rounded-xl border border-stone-200 bg-white p-4 text-sm">
          <summary className="cursor-pointer text-stone-500">Recently paid</summary>
          <ul className="mt-2 divide-y divide-stone-100">
            {paidRecently.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-2 text-sm text-stone-500">
                <span>
                  {b.vendorName} · {billCategoryLabel(b.category)}
                </span>
                <span>
                  {money(b.amount, studio.currency)} · paid {b.paidOn}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
