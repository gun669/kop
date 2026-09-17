// One-off cleanup (Sep 16, 2026): while verifying the Iyzico sandbox
// integration against the iyzico-payment-integration branch's Vercel
// preview, discovered too late that Preview and Production share the same
// DATABASE_URL — so 5 test bookings made against that preview URL
// (guests named "Iyzico Sandbox Test 1..5", phone 0555 000 00 01..05)
// landed in the REAL production database and consumed real capacity on
// Kula Bebek's actual live classes today. This removes exactly those rows
// and nothing else. Idempotent — safe to run more than once (checks
// before deleting, matches by the exact name pattern used for these test
// guests only).
import { and, eq, inArray, like } from "drizzle-orm";
import { db, schema } from "./index";

export async function cleanupIyzicoTestBookings() {
  const testGuests = await db
    .select({ id: schema.guests.id, name: schema.guests.name, studioId: schema.guests.studioId })
    .from(schema.guests)
    .where(like(schema.guests.name, "Iyzico Sandbox Test%"));

  if (testGuests.length === 0) {
    return { removedGuests: 0, guestNames: [] as string[] };
  }

  const guestIds = testGuests.map((g) => g.id);

  await db.delete(schema.payments).where(inArray(schema.payments.guestId, guestIds));
  // bookings and sign_ins both cascade-delete on guest deletion (see
  // src/db/schema.ts), so deleting the guest rows is sufficient for those.
  await db.delete(schema.guests).where(inArray(schema.guests.id, guestIds));

  return { removedGuests: testGuests.length, guestNames: testGuests.map((g) => g.name) };
}
