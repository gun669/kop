import { NextRequest, NextResponse } from "next/server";
import { cleanupIyzicoTestBookings } from "@/db/patch-2026-09-16-cleanup-iyzico-test-bookings";

// TEMPORARY route (Sep 16, 2026) -- removes the 5 test guest/booking rows
// accidentally created in PRODUCTION while verifying Iyzico on the branch
// preview (Preview and Production share DATABASE_URL). Guarded by a
// random secret, removed again right after use.
const SECRET = "5JHU7KR8IlnbC6iwTUEovw8_CjbkOcW4";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== SECRET) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const result = await cleanupIyzicoTestBookings();
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...result });
}
