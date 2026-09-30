import { NextRequest, NextResponse } from "next/server";
import { runMigrations } from "@/db/migrate";

// Temporary, guarded — applies pending migrations to whatever DATABASE_URL
// points at (production, once deployed). Removed again immediately after a
// confirmed successful run; see the build log's operational note #2.
const SECRET = "11fad74cb155f0112f0838480f39796415ab73b99f172d05";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== SECRET) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  await runMigrations();
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString() });
}
