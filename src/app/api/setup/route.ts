import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { runMigrations } from "@/db/migrate";

// TEMPORARY, guarded — removed again immediately after a confirmed
// successful run; see the build log's operational note #2.
//
// Applies migration 0010 (cancel links, waivers, coupons — purely
// additive: 1 enum, 2 new tables, 4 new columns).
//   ?secret=...            -> dry run: reports what already exists, changes nothing
//   ?secret=...&confirm=1  -> runs the migrations
const SECRET = "cR5770F1KlReSVcXLVyRLGUzdR5gGIuV";

async function inspect() {
  const tables = await db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('coupons','guest_waivers')`
  );
  const columns = await db.execute(
    sql`select table_name || '.' || column_name as col from information_schema.columns where table_schema = 'public' and (table_name, column_name) in (('studios','cancel_window_hours'),('bookings','cancel_token'),('payments','coupon_id'),('payments','discount_amount'))`
  );
  const applied = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
  return {
    appliedMigrations: (applied[0] as { n: number }).n,
    expectedAfter: 11,
    existingNewTables: (tables as unknown as { table_name: string }[]).map((r) => r.table_name),
    existingNewColumns: (columns as unknown as { col: string }[]).map((r) => r.col),
  };
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== SECRET) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const confirm = req.nextUrl.searchParams.get("confirm") === "1";
  const before = await inspect();
  if (!confirm) {
    return NextResponse.json({ ok: true, dryRun: true, before });
  }
  await runMigrations();
  const after = await inspect();
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), before, after });
}
