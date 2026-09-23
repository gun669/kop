import { runMigrations } from "@/db/migrate";

// Temporary, guarded migration route — see build log operational note #2.
// Applies migration 0006 (report_share_links table, teachers.ics_token
// column) to production, then gets removed again immediately after.
const SECRET = "1a2377db70bf5e54e5ff2b5363f975a7cac880a2acdcafeb";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("secret") !== SECRET) {
    return new Response("Not found", { status: 404 });
  }

  await runMigrations();

  return Response.json({ ok: true, ranAt: new Date().toISOString() });
}
