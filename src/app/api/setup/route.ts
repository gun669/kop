import { NextRequest, NextResponse } from "next/server";
import { runMigrations } from "@/db/migrate";

// One-time guarded route for the Sep 5, 2026 release: just runs pending
// migrations (teachers.bio/photo_url, class_types.description/photo_url —
// both nullable, no data backfill needed). Remove this route again the
// moment the JSON response below confirms success.
const SETUP_SECRET = "79279f2d7986b7c1930b8f61b8ee0feeefcd5d1c216c1c3e";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== SETUP_SECRET) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    await runMigrations();
    return NextResponse.json({ ok: true, migrated: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
