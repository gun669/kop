import { and, eq, gte, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { buildIcsCalendar } from "@/lib/ics";

export const dynamic = "force-dynamic";

// Public, token-gated — no session, same pattern as /book and the report
// share-link route: Google/Apple Calendar poll this URL unattended on
// their own schedule, so cookie-based auth was never an option here. The
// token lives on the teacher's own row (teachers.icsToken) and reveals
// nothing beyond that one teacher's own class times.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const [teacher] = await db
    .select()
    .from(schema.teachers)
    .where(eq(schema.teachers.icsToken, token))
    .limit(1);

  if (!teacher) {
    return new Response("Calendar not found.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const [studio] = await db
    .select()
    .from(schema.studios)
    .where(eq(schema.studios.id, teacher.studioId))
    .limit(1);

  if (!studio) {
    return new Response("Calendar not found.", { status: 404 });
  }

  // A generous-but-bounded window rather than "every session ever" — a
  // calendar app re-fetches this on its own schedule, so old classes
  // aging out of the window just stop appearing next sync rather than
  // needing anything cleaned up server-side.
  const windowStart = new Date(Date.now() - 14 * 86_400_000);
  const windowEnd = new Date(Date.now() + 180 * 86_400_000);

  const sessions = await db
    .select({
      id: schema.classSessions.id,
      startsAt: schema.classSessions.startsAt,
      room: schema.classSessions.room,
      classTypeName: schema.classTypes.name,
      durationMinutes: schema.classTypes.durationMinutes,
    })
    .from(schema.classSessions)
    .leftJoin(schema.classTypes, eq(schema.classSessions.classTypeId, schema.classTypes.id))
    .where(
      and(
        eq(schema.classSessions.teacherId, teacher.id),
        eq(schema.classSessions.status, "scheduled"),
        gte(schema.classSessions.startsAt, windowStart),
        lt(schema.classSessions.startsAt, windowEnd)
      )
    )
    .orderBy(schema.classSessions.startsAt);

  const ics = buildIcsCalendar(
    `${teacher.name} — ${studio.name}`,
    sessions.map((s) => {
      const durationMinutes = s.durationMinutes ?? 60;
      return {
        uid: `kop-session-${s.id}@kop-app`,
        startsAt: s.startsAt,
        endsAt: new Date(s.startsAt.getTime() + durationMinutes * 60_000),
        summary: s.classTypeName ?? "Class",
        location: s.room ?? undefined,
        description: studio.name,
      };
    })
  );

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8; method=PUBLISH",
      "Cache-Control": "no-store",
    },
  });
}
