import { NextRequest, NextResponse } from "next/server";
import { runMigrations } from "@/db/migrate";
import { patchProduction } from "@/db/patch-2026-09-04";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// One-time bootstrap endpoint for the Sep 4, 2026 release (templates,
// class-type management, team management). Runs the new migration and a
// small idempotent data patch against the live database from Vercel, since
// nothing in the build environment has network access to it directly — see
// the project build log for why. Removed again once confirmed working.
const SETUP_SECRET = "588db7916e8aad1b4f4c9ea113f5c65d294ab1c06a38c4db";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== SETUP_SECRET) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  try {
    await runMigrations();
    const result = await patchProduction();
    return NextResponse.json({ ok: true, migrated: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
