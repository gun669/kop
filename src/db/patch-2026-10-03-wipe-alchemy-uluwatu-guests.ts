// One-off cleanup (Oct 3, 2026): Gün accidentally migrated Kula Bebek's own
// guest CSV import into Alchemy Uluwatu's studio instead of Kula's. Rather
// than try to match the exact mis-imported rows by phone number (which
// assumes nothing else has touched Alchemy Uluwatu's guest list since),
// Gün explicitly chose a full wipe of every guest under Alchemy Uluwatu —
// confirmed in chat, since Alchemy Uluwatu has no real guests of its own
// yet.
//
// Looks the studio up by slug rather than a hardcoded id, so this can never
// accidentally target the wrong studio even if ids differ between
// environments. Idempotent — safe to call more than once; a second call on
// an already-empty studio just reports zero removed.
//
// Deleting a guest row cascades (onDelete: "cascade" in schema.ts) to that
// guest's memberships, sign_ins, and bookings — those are gone for good.
// payments and revenue_entries reference guests with onDelete: "set null",
// so if any of these guests had a payment or revenue entry logged against
// them, that row is NOT deleted — it survives with guestId set to null
// (the dollar amount stays in the studio's totals, just unattributed).
// Reported separately below so it's visible before anything irreversible
// happens, since a straight CSV import (which is how these guests arrived)
// never creates payments or revenue entries on its own — a non-zero count
// here would mean something else touched these guests since the import,
// worth a second look before confirming.
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "./index";

const STUDIO_SLUG = "alchemy-uluwatu";

export async function wipeAlchemyUluwatuGuests(opts: { dryRun: boolean }) {
  const [studio] = await db
    .select({ id: schema.studios.id, slug: schema.studios.slug, name: schema.studios.name })
    .from(schema.studios)
    .where(eq(schema.studios.slug, STUDIO_SLUG))
    .limit(1);

  if (!studio) {
    return { ok: false as const, error: `No studio found with slug "${STUDIO_SLUG}"` };
  }

  const guests = await db
    .select({ id: schema.guests.id })
    .from(schema.guests)
    .where(eq(schema.guests.studioId, studio.id));
  const guestIds = guests.map((g) => g.id);

  if (guestIds.length === 0) {
    return {
      ok: true as const,
      dryRun: opts.dryRun,
      studio: studio.name,
      studioId: studio.id,
      guestsFound: 0,
      removed: 0,
    };
  }

  const [memberships, signIns, bookings, payments, revenueEntries] = await Promise.all([
    db.select({ id: schema.memberships.id }).from(schema.memberships).where(inArray(schema.memberships.guestId, guestIds)),
    db.select({ id: schema.signIns.id }).from(schema.signIns).where(inArray(schema.signIns.guestId, guestIds)),
    db.select({ id: schema.bookings.id }).from(schema.bookings).where(inArray(schema.bookings.guestId, guestIds)),
    db.select({ id: schema.payments.id }).from(schema.payments).where(inArray(schema.payments.guestId, guestIds)),
    db.select({ id: schema.revenueEntries.id }).from(schema.revenueEntries).where(inArray(schema.revenueEntries.guestId, guestIds)),
  ]);

  const summary = {
    ok: true as const,
    dryRun: opts.dryRun,
    studio: studio.name,
    studioId: studio.id,
    guestsFound: guestIds.length,
    willCascadeDelete: {
      memberships: memberships.length,
      signIns: signIns.length,
      bookings: bookings.length,
    },
    willOrphanNotDelete: {
      payments: payments.length,
      revenueEntries: revenueEntries.length,
    },
    removed: opts.dryRun ? 0 : guestIds.length,
  };

  if (!opts.dryRun) {
    await db.delete(schema.guests).where(inArray(schema.guests.id, guestIds));
  }

  return summary;
}
