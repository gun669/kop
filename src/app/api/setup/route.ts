import { NextRequest, NextResponse } from "next/server";
import { runMigrations } from "@/db/migrate";
import { dedupeClassSessions } from "@/db/patch-2026-10-05-dedupe-class-sessions";

// TEMPORARY, guarded — removed again immediately after a confirmed
// successful run; see the build log's operational note #2.
//
// This run applies migration 0009 (bookings.reminder_sent_at — nullable,
// purely additive) and offers cleanup of the duplicate class_sessions rows
// the ensureWeekGenerated() race condition produced (see
// src/db/patch-2026-10-05-dedupe-class-sessions.ts for the full story).
//
// The cleanup step is gated behind a second param, same as every prior
// destructive patch here: ?secret=...            → migrate + dry run (counts only)
//                          ?secret=...&confirm=1  → migrate + actual delete
const SECRET = "r7d0evK4ujM0avYUmHtSyemWpRe3iK3A";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== SECRET) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  await runMigrations();
  const confirm = req.nextUrl.searchParams.get("confirm") === "1";
  const dedupe = await dedupeClassSessions({ dryRun: !confirm });
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), migrated: true, dedupe });
}
