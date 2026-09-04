import "dotenv/config";
import { db, schema } from "./index";
import { hashPassword } from "../lib/auth";
import { todayRangeInTimeZone } from "../lib/time";

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[rand(0, arr.length - 1)];
}
function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

// The actual seed logic, callable both from the CLI script below (`npm run
// db:seed`) and from the one-time /api/setup route that runs this against
// the live production database on first deploy (since this sandbox can't
// open a direct connection to it — see /api/setup/route.ts for why).
export async function seed() {
  console.log("Clearing existing data…");
  await db.delete(schema.signIns);
  await db.delete(schema.memberships);
  await db.delete(schema.expenses);
  await db.delete(schema.revenueEntries);
  await db.delete(schema.classSessions);
  await db.delete(schema.classTypes);
  await db.delete(schema.guests);
  await db.delete(schema.teachers);
  await db.delete(schema.studioMembers);
  await db.delete(schema.studios);
  await db.delete(schema.users);

  console.log("Creating studios…");
  const [istanbul] = await db
    .insert(schema.studios)
    .values({
      name: "Istanbul Studio",
      slug: "istanbul",
      city: "Istanbul",
      timezone: "Europe/Istanbul",
      currency: "TRY",
    })
    .returning();

  const [uluwatu] = await db
    .insert(schema.studios)
    .values({
      name: "Alchemy Uluwatu",
      slug: "alchemy-uluwatu",
      city: "Uluwatu",
      timezone: "Asia/Makassar",
      currency: "USD",
    })
    .returning();

  console.log("Creating users…");
  const demoPassword = await hashPassword("kop-demo-2026");

  const [gun] = await db
    .insert(schema.users)
    .values({
      name: "Gün",
      email: "gursoygun@gmail.com",
      passwordHash: demoPassword,
      isSuperOwner: true,
    })
    .returning();

  const [istReceptionist] = await db
    .insert(schema.users)
    .values({
      name: "Istanbul Front Desk",
      email: "reception@istanbulstudio.demo",
      passwordHash: demoPassword,
    })
    .returning();

  const [uluManager] = await db
    .insert(schema.users)
    .values({
      name: "Uluwatu Studio Manager",
      email: "manager@alchemyuluwatu.demo",
      passwordHash: demoPassword,
    })
    .returning();

  await db.insert(schema.studioMembers).values([
    { userId: istReceptionist.id, studioId: istanbul.id, role: "receptionist" },
    { userId: uluManager.id, studioId: uluwatu.id, role: "manager" },
  ]);

  console.log("Creating teachers…");
  const istTeacherNames = ["Elif Yıldız", "Deniz Kaya", "Ayşe Demir"];
  const uluTeacherNames = ["Made Sujana", "Kadek Ayu", "Wayan Putra", "Kai Sørensen", "Nyoman Sari"];

  const istTeachers = await db
    .insert(schema.teachers)
    .values(istTeacherNames.map((name) => ({ studioId: istanbul.id, name, payRateType: "per_class", payRate: "400" })))
    .returning();

  const uluTeachers = await db
    .insert(schema.teachers)
    .values(uluTeacherNames.map((name) => ({ studioId: uluwatu.id, name, payRateType: "per_class", payRate: "18" })))
    .returning();

  console.log("Creating class types…");
  const istClassTypeNames = ["Vinyasa Flow", "Yin Yoga", "Hatha"];
  const uluClassTypeNames = ["Vinyasa Flow", "Yin Yoga", "Ashtanga", "Sound Healing", "Sunrise Flow"];

  const istClassTypes = await db
    .insert(schema.classTypes)
    .values(istClassTypeNames.map((name) => ({ studioId: istanbul.id, name, durationMinutes: 60 })))
    .returning();

  const uluClassTypes = await db
    .insert(schema.classTypes)
    .values(uluClassTypeNames.map((name) => ({ studioId: uluwatu.id, name, durationMinutes: 75 })))
    .returning();

  console.log("Creating guests…");
  const istGuestFirst = ["Zeynep", "Mert", "Elif", "Kerem", "Selin", "Burak", "Aslı", "Emir", "Cem", "Naz", "Yusuf", "Defne", "Barış", "Ece", "Onur", "Pınar", "Kaan", "Sena", "Umut", "Gizem", "Berk", "Melis", "Tolga", "İrem", "Efe"];
  const uluGuestFirst = ["Sophie", "Jack", "Mia", "Liam", "Chloe", "Noah", "Emma", "Oliver", "Ava", "Leo", "Isla", "Finn", "Zoe", "Max", "Ruby", "Sam", "Nina", "Theo", "Lily", "Jasper", "Grace", "Felix", "Ivy", "Oscar", "Freya", "Hugo", "Wren", "Arlo", "Sage", "Kai", "Rosa", "Milo", "Vera", "Dax", "Luna", "Otto", "Aria", "Remy", "Skye", "Beau", "Coco", "Wolf", "Nova", "Rio", "Fox", "Juno", "Sol", "Aya", "Marlow", "Ren", "Wyn", "Ash", "Blue", "Sunny", "Storm", "River", "Sky", "Dune", "Palm", "Reef"];

  const istGuests = await db
    .insert(schema.guests)
    .values(istGuestFirst.map((n, i) => ({ studioId: istanbul.id, name: `${n} ${["Y.", "K.", "D.", "A."][i % 4]}`, phone: `+90 5${rand(30, 59)} ${rand(100, 999)} ${rand(1000, 9999)}` })))
    .returning();

  const uluGuests = await db
    .insert(schema.guests)
    .values(uluGuestFirst.map((n, i) => ({ studioId: uluwatu.id, name: `${n} ${["S.", "T.", "B.", "R.", "M."][i % 5]}`, phone: `+61 4${rand(10, 99)} ${rand(100, 999)} ${rand(100, 999)}` })))
    .returning();

  console.log("Creating memberships…");
  async function makeMemberships(studioId: number, guests: (typeof istGuests)[number][]) {
    const rows = [];
    for (const g of guests) {
      const roll = Math.random();
      if (roll < 0.4) {
        const total = pick([5, 10, 20]);
        rows.push({
          studioId,
          guestId: g.id,
          type: "class_pack" as const,
          totalCredits: total,
          remainingCredits: rand(0, total),
          startsOn: toDateStr(new Date(Date.now() - rand(1, 25) * 86400000)),
          expiresOn: toDateStr(new Date(Date.now() + rand(5, 60) * 86400000)),
        });
      } else if (roll < 0.65) {
        rows.push({
          studioId,
          guestId: g.id,
          type: "unlimited_monthly" as const,
          totalCredits: null,
          remainingCredits: null,
          startsOn: toDateStr(new Date(Date.now() - rand(1, 25) * 86400000)),
          expiresOn: toDateStr(new Date(Date.now() + rand(1, 30) * 86400000)),
        });
      }
      // else: drop-in only, no membership row
    }
    if (rows.length) return db.insert(schema.memberships).values(rows).returning();
    return [];
  }

  const istMemberships = await makeMemberships(istanbul.id, istGuests);
  const uluMemberships = await makeMemberships(uluwatu.id, uluGuests);

  console.log("Creating class sessions (20 days back, 5 days ahead)…");
  async function makeSessions(opts: {
    studioId: number;
    timezone: string;
    teachers: (typeof istTeachers)[number][];
    classTypes: (typeof istClassTypes)[number][];
    rooms: string[];
    perDay: number;
    capacity: number;
    hourStart: number; // local hour, in opts.timezone
    hourSpacing: number;
  }) {
    const sessions: (typeof schema.classSessions.$inferInsert)[] = [];
    for (let dayOffset = -20; dayOffset <= 5; dayOffset++) {
      // Local midnight (as a UTC instant) for "today + dayOffset" in this studio's timezone.
      const refNow = new Date(Date.now() + dayOffset * 86400000);
      const { start: localMidnightUtc } = todayRangeInTimeZone(opts.timezone, refNow);

      for (let i = 0; i < opts.perDay; i++) {
        const localHour = opts.hourStart + i * opts.hourSpacing;
        const startsAt = new Date(localMidnightUtc.getTime() + localHour * 3600000);
        sessions.push({
          studioId: opts.studioId,
          teacherId: pick(opts.teachers).id,
          classTypeId: pick(opts.classTypes).id,
          room: opts.rooms.length > 1 ? pick(opts.rooms) : opts.rooms[0] ?? null,
          startsAt,
          capacity: opts.capacity,
          status: dayOffset < 0 ? "completed" : "scheduled",
        });
      }
    }
    return db.insert(schema.classSessions).values(sessions).returning();
  }

  const istSessions = await makeSessions({
    studioId: istanbul.id,
    timezone: istanbul.timezone,
    teachers: istTeachers,
    classTypes: istClassTypes,
    rooms: ["Studio"],
    perDay: 3,
    capacity: 8,
    hourStart: 8,
    hourSpacing: 4, // 08:00, 12:00, 16:00 local
  });

  const uluSessions = await makeSessions({
    studioId: uluwatu.id,
    timezone: uluwatu.timezone,
    teachers: uluTeachers,
    classTypes: uluClassTypes,
    rooms: ["Shala 1", "Shala 2"],
    perDay: 6,
    capacity: 24,
    hourStart: 7,
    hourSpacing: 2, // 07:00 through 17:00 local, across two shalas
  });

  console.log("Creating sign-ins for past sessions…");
  async function makeSignIns(opts: {
    studioId: number;
    sessions: (typeof istSessions)[number][];
    guests: (typeof istGuests)[number][];
    memberships: (typeof istMemberships)[number][];
    checkedInByUserId: number;
    fillRatio: number;
  }) {
    const membershipsByGuest = new Map<number, typeof opts.memberships>();
    for (const m of opts.memberships) {
      const arr = membershipsByGuest.get(m.guestId) ?? [];
      arr.push(m);
      membershipsByGuest.set(m.guestId, arr);
    }

    const rows: (typeof schema.signIns.$inferInsert)[] = [];
    for (const session of opts.sessions) {
      if (session.status !== "completed") continue;
      const attendeeCount = Math.round(session.capacity * opts.fillRatio * (0.7 + Math.random() * 0.5));
      const shuffled = [...opts.guests].sort(() => Math.random() - 0.5);
      const attendees = shuffled.slice(0, Math.min(attendeeCount, session.capacity));

      for (const guest of attendees) {
        const roll = Math.random();
        const status = roll < 0.85 ? "attended" : roll < 0.95 ? "no_show" : "late_cancel";
        const memberships = membershipsByGuest.get(guest.id) ?? [];
        const membershipId = memberships.length ? pick(memberships).id : null;

        rows.push({
          studioId: opts.studioId,
          classSessionId: session.id,
          guestId: guest.id,
          membershipId,
          status,
          checkedInAt: new Date(session.startsAt.getTime() - rand(1, 20) * 60000),
          checkedInByUserId: opts.checkedInByUserId,
        });
      }
    }
    if (rows.length) {
      // insert in chunks to keep the statement size reasonable
      for (let i = 0; i < rows.length; i += 500) {
        await db.insert(schema.signIns).values(rows.slice(i, i + 500));
      }
    }
    return rows.length;
  }

  const istSignInCount = await makeSignIns({
    studioId: istanbul.id,
    sessions: istSessions,
    guests: istGuests,
    memberships: istMemberships,
    checkedInByUserId: istReceptionist.id,
    fillRatio: 0.75,
  });

  const uluSignInCount = await makeSignIns({
    studioId: uluwatu.id,
    sessions: uluSessions,
    guests: uluGuests,
    memberships: uluMemberships,
    checkedInByUserId: uluManager.id,
    fillRatio: 0.6,
  });

  console.log("Creating expenses & revenue…");
  async function makeMoney(opts: {
    studioId: number;
    enteredByUserId: number;
    rentAmount: number;
    dailyRevenueRange: [number, number];
    dailyExpenseChance: number;
  }) {
    const expenseRows: (typeof schema.expenses.$inferInsert)[] = [];
    const revenueRows: (typeof schema.revenueEntries.$inferInsert)[] = [];

    // Monthly rent, ~30 days ago
    expenseRows.push({
      studioId: opts.studioId,
      category: "rent",
      amount: String(opts.rentAmount),
      note: "Monthly rent",
      occurredOn: toDateStr(new Date(Date.now() - 28 * 86400000)),
      enteredByUserId: opts.enteredByUserId,
    });

    for (let dayOffset = -30; dayOffset <= 0; dayOffset++) {
      const d = new Date(Date.now() + dayOffset * 86400000);
      const dateStr = toDateStr(d);

      // revenue: a couple of membership/drop-in sales most days
      const salesToday = rand(0, 3);
      for (let i = 0; i < salesToday; i++) {
        const source = pick(["membership_sale", "drop_in", "drop_in"] as const);
        const amount = source === "membership_sale" ? rand(...opts.dailyRevenueRange) * 4 : rand(...opts.dailyRevenueRange);
        revenueRows.push({
          studioId: opts.studioId,
          source,
          amount: String(amount),
          note: source === "membership_sale" ? "Class pack / membership" : "Drop-in class",
          occurredOn: dateStr,
          enteredByUserId: opts.enteredByUserId,
        });
      }

      if (Math.random() < opts.dailyExpenseChance) {
        const category = pick(["utilities", "supplies", "marketing", "teacher_pay"]);
        expenseRows.push({
          studioId: opts.studioId,
          category,
          amount: String(rand(20, 200)),
          note: null,
          occurredOn: dateStr,
          enteredByUserId: opts.enteredByUserId,
        });
      }
    }

    if (expenseRows.length) await db.insert(schema.expenses).values(expenseRows);
    if (revenueRows.length) await db.insert(schema.revenueEntries).values(revenueRows);
  }

  await makeMoney({
    studioId: istanbul.id,
    enteredByUserId: istReceptionist.id,
    rentAmount: 45000,
    dailyRevenueRange: [300, 900],
    dailyExpenseChance: 0.35,
  });

  await makeMoney({
    studioId: uluwatu.id,
    enteredByUserId: uluManager.id,
    rentAmount: 3500,
    dailyRevenueRange: [15, 40],
    dailyExpenseChance: 0.45,
  });

  console.log("\nDone.");
  console.log(`Istanbul: ${istTeachers.length} teachers, ${istGuests.length} guests, ${istSessions.length} sessions, ${istSignInCount} sign-ins`);
  console.log(`Uluwatu:  ${uluTeachers.length} teachers, ${uluGuests.length} guests, ${uluSessions.length} sessions, ${uluSignInCount} sign-ins`);
  console.log(`\nLogins (all use password: kop-demo-2026):`);
  console.log(`  ${gun.email}                    — super owner, sees both studios`);
  console.log(`  ${istReceptionist.email}   — Istanbul receptionist`);
  console.log(`  ${uluManager.email}  — Uluwatu manager`);

  return {
    istanbul: { teachers: istTeachers.length, guests: istGuests.length, sessions: istSessions.length, signIns: istSignInCount },
    uluwatu: { teachers: uluTeachers.length, guests: uluGuests.length, sessions: uluSessions.length, signIns: uluSignInCount },
    logins: [gun.email, istReceptionist.email, uluManager.email],
  };
}
