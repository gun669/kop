"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";
import { localDateKey } from "@/lib/time";

// Same boundary as /money and /reports — accounts payable is an
// owner/manager job.
async function assertCanManageBills(studioId: number) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const studios = await getAccessibleStudios(session);
  const studio = studios.find((s) => s.id === studioId);
  if (!studio || !["owner", "manager"].includes(studio.role)) {
    throw new Error("Not allowed");
  }
  return { session, studio };
}

export async function addVendorBillAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const { session } = await assertCanManageBills(studioId);

  const vendorName = String(formData.get("vendorName") ?? "").trim();
  const category = String(formData.get("category") ?? "other");
  const description = String(formData.get("description") ?? "").trim();
  const amount = String(formData.get("amount") ?? "0");
  const dueDate = String(formData.get("dueDate") ?? "");
  const isRecurring = formData.get("isRecurring") === "on";
  const recurrenceFrequency = isRecurring
    ? (String(formData.get("recurrenceFrequency") ?? "monthly") as
        | "weekly"
        | "monthly"
        | "quarterly"
        | "yearly")
    : null;

  if (!vendorName || !dueDate) throw new Error("Vendor and due date are required");

  await db.insert(schema.vendorBills).values({
    studioId,
    vendorName,
    category,
    description: description || null,
    amount,
    dueDate,
    isRecurring,
    recurrenceFrequency,
    enteredByUserId: session.userId,
  });

  revalidatePath("/bills");
}

export async function markBillPaidAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const billId = Number(formData.get("billId"));
  const { session, studio } = await assertCanManageBills(studioId);

  const [bill] = await db
    .select()
    .from(schema.vendorBills)
    .where(and(eq(schema.vendorBills.id, billId), eq(schema.vendorBills.studioId, studioId)))
    .limit(1);
  if (!bill) throw new Error("Bill not found");
  if (bill.status === "paid") return;

  const paidOn = localDateKey(new Date(), studio.timezone);

  await db.transaction(async (tx) => {
    await tx
      .update(schema.vendorBills)
      .set({ status: "paid", paidOn })
      .where(eq(schema.vendorBills.id, billId));

    // Mirror the paid bill into the expense ledger so /money and /reports
    // (P&L) reflect the real cash outflow too — same "write both sides"
    // pattern as sellMembershipAction writing a membership + a matching
    // revenue entry.
    await tx.insert(schema.expenses).values({
      studioId,
      category: bill.category,
      amount: bill.amount,
      note: `${bill.vendorName}${bill.description ? " — " + bill.description : ""}`,
      occurredOn: paidOn,
      enteredByUserId: session.userId,
    });
  });

  revalidatePath("/bills");
  revalidatePath("/money");
  revalidatePath("/reports");
  revalidatePath("/dashboard");
}

export async function deleteVendorBillAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const billId = Number(formData.get("billId"));
  await assertCanManageBills(studioId);

  await db
    .delete(schema.vendorBills)
    .where(and(eq(schema.vendorBills.id, billId), eq(schema.vendorBills.studioId, studioId)));

  revalidatePath("/bills");
}
