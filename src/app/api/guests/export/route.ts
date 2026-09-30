import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";

// The read-only counterpart to /guests/import — lets an owner/manager pull
// their guest list back out as a CSV, e.g. for a backup or to hand to
// another tool. Ordinary authenticated GET behind the session cookie, not a
// shareable token link like the Reports PDF share links: this is a raw
// export of every guest's contact info, so it should only ever be fetched
// by someone actually signed in with access, not by anyone holding a URL.
function csvEscape(value: string): string {
  if (value === "") return "";
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "not signed in" }, { status: 401 });

  const studioId = Number(new URL(req.url).searchParams.get("studioId"));
  const studios = await getAccessibleStudios(session);
  const studio = studios.find((s) => s.id === studioId);
  if (!studio || !["owner", "manager"].includes(studio.role)) {
    return NextResponse.json({ ok: false, error: "not allowed" }, { status: 403 });
  }

  const guests = await db
    .select()
    .from(schema.guests)
    .where(eq(schema.guests.studioId, studioId))
    .orderBy(schema.guests.name);

  const header = ["Name", "Phone", "Email", "Notes", "Guest since"];
  const rows = guests.map((g) => [
    g.name,
    g.phone ?? "",
    g.email ?? "",
    g.notes ?? "",
    g.createdAt.toISOString().slice(0, 10),
  ]);
  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";

  const dateStamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${studio.slug}-guests-${dateStamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
