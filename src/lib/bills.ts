import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { addMonthsToDateString } from "@/lib/packages";

export const BILL_CATEGORIES = [
  { value: "rent", label: "Rent" },
  { value: "utilities", label: "Utilities" },
  { value: "insurance", label: "Insurance" },
  { value: "supplies", label: "Supplies" },
  { value: "teacher_pay", label: "Teacher pay" },
  { value: "construction", label: "Construction" },
  { value: "repairs", label: "Repairs" },
  { value: "equipment", label: "Equipment" },
  { value: "other", label: "Other" },
] as const;

export const BILL_FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
] as const;

export function billCategoryLabel(value: string) {
  return BILL_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

function addDaysToDateString(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Advance a "YYYY-MM-DD" date by one occurrence of the given frequency.
export function advanceDueDate(dateStr: string, frequency: string): string {
  switch (frequency) {
    case "weekly":
      return addDaysToDateString(dateStr, 7);
    case "quarterly":
      return addMonthsToDateString(dateStr, 3);
    case "yearly":
      return addMonthsToDateString(dateStr, 12);
    case "monthly":
    default:
      return addMonthsToDateString(dateStr, 1);
  }
}

// Lazy recurring-bill generation, same pattern as the schedule page's
// "is this week empty? fill it from the template" check: rather than a
// cron job pre-generating future bills, every time the bills page is
// viewed this tops up each recurring series with instances out to
// `horizonDays` from today, so a manager can see next month's (or next
// quarter's) costs before they're incurred, not just after the current
// one is marked paid. Capped per series so a series nobody has opened in
// a long time (e.g. a paused studio) can't generate an unbounded number
// of rows in one call.
export async function ensureRecurringBillOccurrences(
  studioId: number,
  todayKey: string,
  horizonDays = 60
) {
  const horizon = addDaysToDateString(todayKey, horizonDays);

  const roots = await db
    .select()
    .from(schema.vendorBills)
    .where(
      and(
        eq(schema.vendorBills.studioId, studioId),
        eq(schema.vendorBills.isRecurring, true),
        isNull(schema.vendorBills.recurrenceSeriesId)
      )
    );

  for (const root of roots) {
    if (!root.recurrenceFrequency) continue;

    const [latestChild] = await db
      .select()
      .from(schema.vendorBills)
      .where(eq(schema.vendorBills.recurrenceSeriesId, root.id))
      .orderBy(desc(schema.vendorBills.dueDate))
      .limit(1);

    let latestDue = (latestChild ?? root).dueDate;
    let iterations = 0;
    while (latestDue < horizon && iterations < 24) {
      const nextDue = advanceDueDate(latestDue, root.recurrenceFrequency);
      await db.insert(schema.vendorBills).values({
        studioId,
        vendorName: root.vendorName,
        category: root.category,
        description: root.description,
        amount: root.amount,
        dueDate: nextDue,
        status: "unpaid",
        isRecurring: true,
        recurrenceFrequency: root.recurrenceFrequency,
        recurrenceSeriesId: root.id,
        enteredByUserId: root.enteredByUserId,
      });
      latestDue = nextDue;
      iterations++;
    }
  }
}
