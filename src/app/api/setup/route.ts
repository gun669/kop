import { NextRequest, NextResponse } from "next/server";
import { runMigrations } from "@/db/migrate";

// TEMPORARY migration route (Sep 16, 2026) -- applies migration 0005
// (booking_status enum gains "no_show", for the check-in roster
// auto-reconciliation). Guarded by a random secret, removed again right
// after use -- same established pattern as every prior production schema
// change (see the build log's operational note #2).
const SECRET = "NqQiSvHc7gkIvgCUKEM6paUwURuXC0xM";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== SECRET) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await runMigrations();
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString() });
}
