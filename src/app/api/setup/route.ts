import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { runMigrations } from "@/db/migrate";
import { seed } from "@/db/seed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// One-time bootstrap endpoint: creates the database tables and loads demo
// data on the live (Vercel + Neon) database. This exists because the build
// environment used to develop this app has no network path to the database
// at all (a locked-down sandbox), so `drizzle-kit push` / the seed script
// can't be run against production from there — Vercel itself, where this
// route actually executes, does have that network path.
//
// Guarded by a one-time secret so a stranger can't hit it and wipe/reseed
// the database. Safe to call more than once: migrations are idempotent, and
// seeding is skipped if a studio already exists.
const SETUP_SECRET = "958bbf30afaa54a81d00d4f429a587bd15a857992cf17d9b";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== SETUP_SECRET) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  try {
    await runMigrations();

    const existing = await db.select({ id: schema.studios.id }).from(schema.studios).limit(1);
    if (existing.length > 0) {
      return NextResponse.json({
        ok: true,
        migrated: true,
        seeded: false,
        message: "Tables are up to date. Demo data already exists, so seeding was skipped.",
      });
    }

    const result = await seed();
    return NextResponse.json({
      ok: true,
      migrated: true,
      seeded: true,
      message: "Database tables created and demo data loaded.",
      result,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
