import { NextRequest, NextResponse } from "next/server";
import { runMigrations } from "@/db/migrate";

// Temporary, guarded one-off migration route — applies any pending SQL
// migrations under /drizzle (currently: the Sep 11, 2026 `bookings` table)
// to whatever DATABASE_URL points at. Delete this route once confirmed
// working; see the build log's operational note #2 for the full pattern
// and why this has to run from Vercel rather than any Claude-side shell.
const SETUP_SECRET = "198e36431dc82d6c5d54cfe41422e7fd";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== SETUP_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    await runMigrations();
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
