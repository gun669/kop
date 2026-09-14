import { NextRequest, NextResponse } from "next/server";
import { runMigrations } from "@/db/migrate";

// Temporary, guarded migration-runner route. Only reachable with the exact
// secret below (freshly generated for this one migration, per this
// project's established pattern) — remove this route again once it's been
// hit once and confirmed working. Do not leave this deployed long-term.
const SECRET = "b6eea6ba0357e163fc16656694e0fd5cd402715793831878";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== SECRET) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
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
