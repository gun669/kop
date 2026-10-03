import { NextRequest, NextResponse } from "next/server";
import { runMigrations } from "@/db/migrate";
import { wipeAlchemyUluwatuGuests } from "@/db/patch-2026-10-03-wipe-alchemy-uluwatu-guests";

// TEMPORARY, guarded — removed again immediately after a confirmed
// successful run; see the build log's operational note #2.
//
// This run applies migration 0008 (guests.source, guests.member_since —
// both nullable, purely additive) and offers the Alchemy Uluwatu guest
// wipe Gün explicitly confirmed in chat.
//
// The wipe step is itself gated behind a second param so hitting this URL
// first gives a dry-run report (counts only, nothing deleted) before
// anything irreversible happens: ?secret=...            → migrate + dry run
//                                  ?secret=...&confirm=1 → migrate + actual delete
const SECRET = "A_z0UA0Ro07M21-gZ6_ZhSUeVtmOwU9f";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== SECRET) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  await runMigrations();
  const confirm = req.nextUrl.searchParams.get("confirm") === "1";
  const wipe = await wipeAlchemyUluwatuGuests({ dryRun: !confirm });
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), migrated: true, wipe });
}
