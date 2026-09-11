import { NextRequest, NextResponse } from "next/server";
import { ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// Temporary, guarded, one-time-use route: wipes the seeded demo content
// (fake teachers, class types, schedule, guests, bookings, sign-ins,
// memberships, revenue/expense entries, and the demo-only staff logins)
// so Gün can populate the app with his studios' real data. Deliberately
// keeps the `studios` rows themselves (Kula Bebek / Alchemy Uluwatu —
// real businesses, not demo content) and the `gursoygun@gmail.com` user
// row (his real login). Removed again once confirmed run, same pattern as
// every other one-off production change in this project — see
// claude/kop-build-log.md operational note #2.
const RESET_SECRET = "72482d650267b3347b6539dad9447318";
const KEEP_EMAIL = "gursoygun@gmail.com";
const CONFIRM_TOKEN = "DELETE-DEMO-DATA";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function count(table: any) {
  const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(table);
  return row.c as number;
}

async function snapshot() {
  const [
    studios,
    teachers,
    classTypes,
    classSessions,
    guests,
    bookings,
    signIns,
    memberships,
    expenses,
    revenueEntries,
    scheduleTemplates,
    scheduleTemplateSlots,
    studioMembers,
    users,
  ] = await Promise.all([
    count(schema.studios),
    count(schema.teachers),
    count(schema.classTypes),
    count(schema.classSessions),
    count(schema.guests),
    count(schema.bookings),
    count(schema.signIns),
    count(schema.memberships),
    count(schema.expenses),
    count(schema.revenueEntries),
    count(schema.scheduleTemplates),
    count(schema.scheduleTemplateSlots),
    count(schema.studioMembers),
    count(schema.users),
  ]);

  const studioRows = await db
    .select({ id: schema.studios.id, name: schema.studios.name, slug: schema.studios.slug })
    .from(schema.studios);
  const userRows = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
    .from(schema.users);

  return {
    counts: {
      studios,
      teachers,
      classTypes,
      classSessions,
      guests,
      bookings,
      signIns,
      memberships,
      expenses,
      revenueEntries,
      scheduleTemplates,
      scheduleTemplateSlots,
      studioMembers,
      users,
    },
    studioRows,
    userRows,
  };
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== RESET_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const mode = req.nextUrl.searchParams.get("mode") ?? "preview";

  if (mode === "preview") {
    const before = await snapshot();
    return NextResponse.json({
      mode: "preview",
      note:
        "Dry run only — nothing deleted yet. `keeping` is what survives; everything under `willDelete` gets removed by mode=execute.",
      keeping: {
        studios: before.studioRows,
        user: before.userRows.find((u) => u.email === KEEP_EMAIL) ?? null,
      },
      willDelete: {
        teachers: before.counts.teachers,
        classTypes: before.counts.classTypes,
        classSessions: before.counts.classSessions,
        guests: before.counts.guests,
        bookings: before.counts.bookings,
        signIns: before.counts.signIns,
        memberships: before.counts.memberships,
        expenses: before.counts.expenses,
        revenueEntries: before.counts.revenueEntries,
        scheduleTemplates: before.counts.scheduleTemplates,
        scheduleTemplateSlots: before.counts.scheduleTemplateSlots,
        studioMembers: before.counts.studioMembers,
        otherUsers: before.userRows.filter((u) => u.email !== KEEP_EMAIL),
      },
    });
  }

  if (mode === "execute") {
    const confirm = req.nextUrl.searchParams.get("confirm");
    if (confirm !== CONFIRM_TOKEN) {
      return NextResponse.json(
        { error: `missing or wrong confirm token — append &confirm=${CONFIRM_TOKEN}` },
        { status: 400 }
      );
    }

    try {
      const before = await snapshot();

      // Child-most first — explicit rather than relying on cascade timing.
      await db.delete(schema.bookings);
      await db.delete(schema.signIns);
      await db.delete(schema.memberships);
      await db.delete(schema.expenses);
      await db.delete(schema.revenueEntries);
      await db.delete(schema.scheduleTemplateSlots);
      await db.delete(schema.scheduleTemplates);
      await db.delete(schema.classSessions);
      await db.delete(schema.classTypes);
      await db.delete(schema.guests);
      await db.delete(schema.teachers);
      // Cascades studioMembers for whoever gets deleted here.
      await db.delete(schema.users).where(ne(schema.users.email, KEEP_EMAIL));

      const after = await snapshot();
      return NextResponse.json({ ok: true, before: before.counts, after: after.counts });
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: "unknown mode — use mode=preview or mode=execute" }, { status: 400 });
}
