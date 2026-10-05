"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, and, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { parseCsvWithHeader, resolveName, cellAt, parseDateCell, type GuestColumnMapping } from "@/lib/csv";

// Bulk-importing (and potentially overwriting/duplicating) a studio's whole
// guest list is a bigger blast radius than the usual add-a-note edit on
// /guests, so this stays owner/manager only — not receptionist.
async function assertCanImportGuests(studioId: number) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const studios = await getAccessibleStudios(session);
  const studio = studios.find((s) => s.id === studioId);
  if (!studio || !["owner", "manager"].includes(studio.role)) {
    throw new Error("Not allowed to import guests here");
  }
  return { session, studio };
}

export async function uploadImportBatchAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  await assertCanImportGuests(studioId);

  const file = formData.get("csv");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/guests/import?error=${encodeURIComponent("Pick a CSV file first.")}`);
  }
  if (file.size > 8 * 1024 * 1024) {
    redirect(`/guests/import?error=${encodeURIComponent("That file is too large (max 8MB).")}`);
  }

  const csvText = await file.text();
  const { headers } = parseCsvWithHeader(csvText);
  if (headers.length === 0) {
    redirect(`/guests/import?error=${encodeURIComponent("Couldn't read any columns from that file.")}`);
  }

  const [batch] = await db
    .insert(schema.guestImportBatches)
    .values({ studioId, fileName: file.name || null, csvText })
    .returning();

  redirect(`/guests/import/${batch.id}`);
}

export async function cancelImportBatchAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const batchId = Number(formData.get("batchId"));
  await assertCanImportGuests(studioId);

  await db
    .delete(schema.guestImportBatches)
    .where(and(eq(schema.guestImportBatches.id, batchId), eq(schema.guestImportBatches.studioId, studioId)));

  redirect("/guests/import");
}

export async function confirmImportBatchAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const batchId = Number(formData.get("batchId"));
  await assertCanImportGuests(studioId);

  const mapping: GuestColumnMapping = {
    nameCol: (formData.get("nameCol") as string) || null,
    firstNameCol: (formData.get("firstNameCol") as string) || null,
    lastNameCol: (formData.get("lastNameCol") as string) || null,
    phoneCol: (formData.get("phoneCol") as string) || null,
    emailCol: (formData.get("emailCol") as string) || null,
    notesCol: (formData.get("notesCol") as string) || null,
    sourceCol: (formData.get("sourceCol") as string) || null,
    memberSinceCol: (formData.get("memberSinceCol") as string) || null,
  };

  const [batch] = await db
    .select()
    .from(schema.guestImportBatches)
    .where(and(eq(schema.guestImportBatches.id, batchId), eq(schema.guestImportBatches.studioId, studioId)))
    .limit(1);
  if (!batch) redirect("/guests/import?error=" + encodeURIComponent("That import batch is gone — upload the file again."));

  const { headers, rows } = parseCsvWithHeader(batch.csvText);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  await db.transaction(async (tx) => {
    // Same identity rule as everywhere else in KOP: a guest is keyed by
    // phone number, not name — loaded once here rather than per-row so a
    // 1,000-row import doesn't run 1,000 separate lookup queries.
    const existing = await tx
      .select({
        id: schema.guests.id,
        name: schema.guests.name,
        phone: schema.guests.phone,
        email: schema.guests.email,
        notes: schema.guests.notes,
        source: schema.guests.source,
        memberSince: schema.guests.memberSince,
      })
      .from(schema.guests)
      .where(and(eq(schema.guests.studioId, studioId), isNotNull(schema.guests.phone)));
    const byPhone = new Map<string, (typeof existing)[number]>();
    for (const g of existing) {
      const n = normalizePhone(g.phone);
      if (n && !byPhone.has(n)) byPhone.set(n, g);
    }

    for (const row of rows) {
      const name = resolveName(headers, row, mapping);
      const rawPhone = cellAt(headers, row, mapping.phoneCol);
      const email = cellAt(headers, row, mapping.emailCol);
      const notes = cellAt(headers, row, mapping.notesCol);
      const source = cellAt(headers, row, mapping.sourceCol);
      const memberSinceRaw = cellAt(headers, row, mapping.memberSinceCol);
      const memberSince = memberSinceRaw ? parseDateCell(memberSinceRaw) : null;
      const normalized = normalizePhone(rawPhone);

      if (!name) {
        skipped++;
        continue;
      }

      const match = normalized ? byPhone.get(normalized) : undefined;
      if (match) {
        // Never clobber a name or detail staff may have already corrected
        // in KOP — only fill in what's currently blank.
        const patch: Partial<typeof schema.guests.$inferInsert> = {};
        if (!match.phone && rawPhone) patch.phone = rawPhone;
        if (!match.email && email) patch.email = email;
        if (!match.notes && notes) patch.notes = notes;
        if (!match.source && source) patch.source = source;
        if (!match.memberSince && memberSince) patch.memberSince = memberSince;
        if (Object.keys(patch).length > 0) {
          await tx.update(schema.guests).set(patch).where(eq(schema.guests.id, match.id));
        }
        updated++;
      } else {
        const [created] = await tx
          .insert(schema.guests)
          .values({
            studioId,
            name,
            phone: rawPhone || null,
            email: email || null,
            notes: notes || null,
            source: source || null,
            memberSince,
          })
          .returning({ id: schema.guests.id, phone: schema.guests.phone });
        inserted++;
        if (normalized)
          byPhone.set(normalized, {
            id: created.id,
            name,
            phone: created.phone,
            email: email || null,
            notes: notes || null,
            source: source || null,
            memberSince,
          });
      }
    }

    await tx.delete(schema.guestImportBatches).where(eq(schema.guestImportBatches.id, batchId));
  });

  revalidatePath("/guests");
  revalidatePath("/checkin");
  redirect(`/guests?imported=${inserted}&updated=${updated}&skipped=${skipped}`);
}
