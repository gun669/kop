import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "./index";

// One-time production data patch for the Sep 4, 2026 release: renames the
// Istanbul studio and backfills a default schedule template for any studio
// that doesn't have one yet (so existing production data — which predates
// the templates feature — gets the same default template a fresh seed
// would produce). Safe to run more than once: every step checks first.
export async function patchProduction() {
  const renamed = await db
    .update(schema.studios)
    .set({ name: "Kula Bebek" })
    .where(and(eq(schema.studios.slug, "istanbul"), eq(schema.studios.name, "Istanbul Studio")))
    .returning({ id: schema.studios.id });

  const studios = await db.select().from(schema.studios);
  const templatesCreated: string[] = [];

  // Same per-studio pattern the seed script uses, applied to every weekday.
  const PATTERNS: Record<string, { perDay: number; capacity: number; hourStart: number; hourSpacing: number; rooms: string[] }> = {
    istanbul: { perDay: 3, capacity: 8, hourStart: 8, hourSpacing: 4, rooms: ["Studio"] },
    "alchemy-uluwatu": { perDay: 6, capacity: 24, hourStart: 7, hourSpacing: 2, rooms: ["Shala 1", "Shala 2"] },
  };

  function pad(n: number) {
    return String(n).padStart(2, "0");
  }

  for (const studio of studios) {
    const [existing] = await db
      .select({ id: schema.scheduleTemplates.id })
      .from(schema.scheduleTemplates)
      .where(eq(schema.scheduleTemplates.studioId, studio.id))
      .limit(1);
    if (existing) continue;

    const pattern = PATTERNS[studio.slug];
    if (!pattern) continue; // unknown studio (e.g. one added after this patch) — skip, use the Templates page instead.

    const teachers = await db
      .select()
      .from(schema.teachers)
      .where(eq(schema.teachers.studioId, studio.id))
      .orderBy(asc(schema.teachers.id));
    const classTypes = await db
      .select()
      .from(schema.classTypes)
      .where(eq(schema.classTypes.studioId, studio.id))
      .orderBy(asc(schema.classTypes.id));
    if (teachers.length === 0 || classTypes.length === 0) continue;

    const [template] = await db
      .insert(schema.scheduleTemplates)
      .values({ studioId: studio.id, name: "Default", isDefault: true })
      .returning();

    const slots = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      for (let i = 0; i < pattern.perDay; i++) {
        const hour = pattern.hourStart + i * pattern.hourSpacing;
        slots.push({
          templateId: template.id,
          weekday,
          time: `${pad(hour)}:00`,
          teacherId: teachers[i % teachers.length].id,
          classTypeId: classTypes[i % classTypes.length].id,
          room: pattern.rooms.length > 1 ? pattern.rooms[i % pattern.rooms.length] : pattern.rooms[0] ?? null,
          capacity: pattern.capacity,
        });
      }
    }
    await db.insert(schema.scheduleTemplateSlots).values(slots);
    templatesCreated.push(studio.name);
  }

  return { renamed: renamed.length > 0, templatesCreated };
}
