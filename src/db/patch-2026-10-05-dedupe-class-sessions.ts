import { eq, sql } from "drizzle-orm";
import { db, schema } from "./index";

// One-off cleanup for the duplicate classes Gün hit testing the Iyzico
// sandbox flow (Oct 5, 2026): ensureWeekGenerated()'s lazy "is this week
// empty?" check-then-insert had a race — two concurrent /schedule page
// loads on a genuinely empty week could both see zero sessions and both
// insert the full template, producing exact duplicate class_sessions rows
// (same studio/teacher/class type/room/start time/capacity). Removed the
// automatic trigger itself (src/lib/scheduleTemplates.ts) separately;
// this just cleans up the rows that bug already created.
//
// For each duplicate group (same studioId, teacherId, classTypeId,
// startsAt, room, capacity): keep the row with bookings/sign-ins already
// attached (real guest activity — Gün's own confirmed Iyzico sandbox
// booking landed on one specific duplicate), delete the empty twin(s).
// If more than one row in a group has activity, that's not this bug's
// signature (a real double-booking situation, not a race-condition
// duplicate) — skipped entirely rather than guessed at.
export async function dedupeClassSessions({ dryRun }: { dryRun: boolean }) {
  const groups = await db
    .select({
      studioId: schema.classSessions.studioId,
      teacherId: schema.classSessions.teacherId,
      classTypeId: schema.classSessions.classTypeId,
      startsAt: schema.classSessions.startsAt,
      room: schema.classSessions.room,
      capacity: schema.classSessions.capacity,
      count: sql<number>`count(*)`.as("count"),
      ids: sql<number[]>`array_agg(${schema.classSessions.id} order by ${schema.classSessions.id})`.as("ids"),
    })
    .from(schema.classSessions)
    .groupBy(
      schema.classSessions.studioId,
      schema.classSessions.teacherId,
      schema.classSessions.classTypeId,
      schema.classSessions.startsAt,
      schema.classSessions.room,
      schema.classSessions.capacity
    )
    .having(sql`count(*) > 1`);

  const report = {
    duplicateGroups: groups.length,
    rowsExamined: 0,
    rowsToDelete: [] as number[],
    ambiguousGroups: [] as { ids: number[]; reason: string }[],
  };

  for (const g of groups) {
    report.rowsExamined += g.ids.length;

    const activity = await Promise.all(
      g.ids.map(async (id) => {
        const [b] = await db
          .select({ n: sql<number>`count(*)` })
          .from(schema.bookings)
          .where(eq(schema.bookings.classSessionId, id));
        const [s] = await db
          .select({ n: sql<number>`count(*)` })
          .from(schema.signIns)
          .where(eq(schema.signIns.classSessionId, id));
        return { id, bookings: Number(b?.n ?? 0), signIns: Number(s?.n ?? 0) };
      })
    );

    const withActivity = activity.filter((a) => a.bookings > 0 || a.signIns > 0);

    if (withActivity.length > 1) {
      report.ambiguousGroups.push({
        ids: g.ids,
        reason: `${withActivity.length} of ${g.ids.length} duplicate rows have real bookings/sign-ins — not touched`,
      });
      continue;
    }

    const keepId = withActivity[0]?.id ?? Math.min(...g.ids);
    const toDelete = g.ids.filter((id) => id !== keepId);
    report.rowsToDelete.push(...toDelete);

    if (!dryRun) {
      for (const id of toDelete) {
        await db.delete(schema.classSessions).where(eq(schema.classSessions.id, id));
      }
    }
  }

  return report;
}
