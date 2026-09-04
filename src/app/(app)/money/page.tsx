import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePageContext, requireRole } from "@/lib/context";
import { addExpenseAction, addRevenueAction } from "./actions";

export const dynamic = "force-dynamic";

function money(amount: string, currency: string) {
  const n = Number(amount);
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

export default async function MoneyPage() {
  const { studio, role } = await requirePageContext();
  requireRole(role, ["owner", "manager"]);

  const [expenses, revenues] = await Promise.all([
    db
      .select()
      .from(schema.expenses)
      .where(eq(schema.expenses.studioId, studio.id))
      .orderBy(desc(schema.expenses.occurredOn))
      .limit(15),
    db
      .select()
      .from(schema.revenueEntries)
      .where(eq(schema.revenueEntries.studioId, studio.id))
      .orderBy(desc(schema.revenueEntries.occurredOn))
      .limit(15),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <section>
        <h2 className="mb-3 text-lg font-semibold text-stone-900">Revenue</h2>
        <form action={addRevenueAction} className="mb-4 space-y-2 rounded-xl border border-stone-200 bg-white p-4">
          <input type="hidden" name="studioId" value={studio.id} />
          <div className="flex gap-2">
            <select name="source" className="flex-1 rounded-lg border border-stone-300 px-2 py-2 text-sm">
              <option value="membership_sale">Membership sale</option>
              <option value="drop_in">Drop-in payment</option>
              <option value="other">Other</option>
            </select>
            <input
              type="number"
              step="0.01"
              name="amount"
              required
              placeholder={`Amount (${studio.currency})`}
              className="w-40 rounded-lg border border-stone-300 px-2 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <input type="date" name="occurredOn" defaultValue={today} required className="rounded-lg border border-stone-300 px-2 py-2 text-sm" />
            <input name="note" placeholder="Note (optional)" className="flex-1 rounded-lg border border-stone-300 px-2 py-2 text-sm" />
          </div>
          <button className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white hover:bg-stone-800">
            Add revenue entry
          </button>
        </form>
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
          {revenues.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <div>
                <div className="text-stone-800">{r.source.replace("_", " ")}</div>
                <div className="text-xs text-stone-400">{r.occurredOn} {r.note ? `· ${r.note}` : ""}</div>
              </div>
              <div className="font-medium text-emerald-700">+{money(r.amount, studio.currency)}</div>
            </li>
          ))}
          {revenues.length === 0 && <li className="px-4 py-3 text-sm text-stone-400">No revenue logged yet.</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-stone-900">Expenses</h2>
        <form action={addExpenseAction} className="mb-4 space-y-2 rounded-xl border border-stone-200 bg-white p-4">
          <input type="hidden" name="studioId" value={studio.id} />
          <div className="flex gap-2">
            <select name="category" className="flex-1 rounded-lg border border-stone-300 px-2 py-2 text-sm">
              <option value="rent">Rent</option>
              <option value="teacher_pay">Teacher pay</option>
              <option value="utilities">Utilities</option>
              <option value="supplies">Supplies</option>
              <option value="marketing">Marketing</option>
              <option value="other">Other</option>
            </select>
            <input
              type="number"
              step="0.01"
              name="amount"
              required
              placeholder={`Amount (${studio.currency})`}
              className="w-40 rounded-lg border border-stone-300 px-2 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <input type="date" name="occurredOn" defaultValue={today} required className="rounded-lg border border-stone-300 px-2 py-2 text-sm" />
            <input name="note" placeholder="Note (optional)" className="flex-1 rounded-lg border border-stone-300 px-2 py-2 text-sm" />
          </div>
          <button className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white hover:bg-stone-800">
            Add expense entry
          </button>
        </form>
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
          {expenses.map((e) => (
            <li key={e.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <div>
                <div className="text-stone-800">{e.category.replace("_", " ")}</div>
                <div className="text-xs text-stone-400">{e.occurredOn} {e.note ? `· ${e.note}` : ""}</div>
              </div>
              <div className="font-medium text-red-700">-{money(e.amount, studio.currency)}</div>
            </li>
          ))}
          {expenses.length === 0 && <li className="px-4 py-3 text-sm text-stone-400">No expenses logged yet.</li>}
        </ul>
      </section>
    </div>
  );
}
