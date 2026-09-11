// Guests are matched by phone number, not name (name-matching is fragile —
// "Ayse" vs "Ayşe" vs "Aysha", and unsafe to search on since it's the
// person's actual legal name). Phone numbers get typed in all kinds of
// formats across two countries (+90 532 ..., 0532 ..., +62 812 ..., with or
// without spaces/dashes), so matching compares a normalized form rather
// than the raw string.
//
// Heuristic: strip everything but digits, then keep the last 10 — that
// drops country codes (90/62) and a leading trunk "0" the same way, and 10
// digits is the mobile-number length in both Turkey and Indonesia. Good
// enough to dedupe real-world data entry without a full per-country phone
// parsing library.
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return null; // too short to be a real phone number
  return digits.slice(-10);
}
