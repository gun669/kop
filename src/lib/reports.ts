import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@/db";

export type PnlBreakdown = { count: number; total: number };

export type Pnl = {
  revenueBySource: Map<string, PnlBreakdown>;
  expensesByCategory: Map<string, PnlBreakdown>;
  totalRevenue: number;
  totalExpenses: number;
  net: number;
};

// Revenue-by-source / expenses-by-category for a studio over a date range
// (inclusive "YYYY-MM-DD" strings, same convention as occurredOn columns).
// Shared by the Reports page (/reports) and the PDF share-link route
// (src/app/api/reports/share/[token]) so the two can never quietly drift
// apart into showing different numbers for the same period.
export async function computePnl(studioId: number, from: string, to: string): Promise<Pnl> {
  const [revenue, expenseRows] = await Promise.all([
    db
      .select()
      .from(schema.revenueEntries)
      .where(
        and(
          eq(schema.revenueEntries.studioId, studioId),
          gte(schema.revenueEntries.occurredOn, from),
          lte(schema.revenueEntries.occurredOn, to)
        )
      ),
    db
      .select()
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.studioId, studioId),
          gte(schema.expenses.occurredOn, from),
          lte(schema.expenses.occurredOn, to)
        )
      ),
  ]);

  const revenueBySource = new Map<string, PnlBreakdown>();
  for (const r of revenue) {
    const cur = revenueBySource.get(r.source) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(r.amount);
    revenueBySource.set(r.source, cur);
  }
  const totalRevenue = revenue.reduce((s, r) => s + Number(r.amount), 0);

  const expensesByCategory = new Map<string, PnlBreakdown>();
  for (const e of expenseRows) {
    const cur = expensesByCategory.get(e.category) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(e.amount);
    expensesByCategory.set(e.category, cur);
  }
  const totalExpenses = expenseRows.reduce((s, e) => s + Number(e.amount), 0);
  const net = totalRevenue - totalExpenses;

  return { revenueBySource, expensesByCategory, totalRevenue, totalExpenses, net };
}
