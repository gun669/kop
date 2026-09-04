"use server";

import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";

async function assertManagerAccess(studioId: number) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const studios = await getAccessibleStudios(session);
  const studio = studios.find((s) => s.id === studioId);
  if (!studio || !["owner", "manager"].includes(studio.role)) {
    throw new Error("Not allowed");
  }
  return { session, studio };
}

export async function addExpenseAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const { session } = await assertManagerAccess(studioId);

  await db.insert(schema.expenses).values({
    studioId,
    category: String(formData.get("category") ?? "other"),
    amount: String(formData.get("amount") ?? "0"),
    note: String(formData.get("note") ?? "") || null,
    occurredOn: String(formData.get("occurredOn")),
    enteredByUserId: session.userId,
  });

  revalidatePath("/money");
  revalidatePath("/dashboard");
}

export async function addRevenueAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const { session } = await assertManagerAccess(studioId);

  await db.insert(schema.revenueEntries).values({
    studioId,
    source: String(formData.get("source") ?? "other") as "membership_sale" | "drop_in" | "other",
    amount: String(formData.get("amount") ?? "0"),
    note: String(formData.get("note") ?? "") || null,
    occurredOn: String(formData.get("occurredOn")),
    enteredByUserId: session.userId,
  });

  revalidatePath("/money");
  revalidatePath("/dashboard");
}
