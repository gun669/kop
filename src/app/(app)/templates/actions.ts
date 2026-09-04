"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";

async function assertManagerAccess(studioId: number) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const studios = await getAccessibleStudios(session);
  const studio = studios.find((s) => s.id === studioId);
  if (!studio || !["owner", "manager"].includes(studio.role)) {
    throw new Error("Not allowed to edit schedule templates");
  }
  return { session, studio };
}

export async function createTemplateAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  await assertManagerAccess(studioId);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const [{ value: existingCount }] = await db
    .select({ value: count() })
    .from(schema.scheduleTemplates)
    .where(eq(schema.scheduleTemplates.studioId, studioId));

  await db.insert(schema.scheduleTemplates).values({
    studioId,
    name,
    // The very first template a studio creates becomes the default
    // automatically, so auto-fill has something to work with right away.
    isDefault: existingCount === 0,
  });

  revalidatePath("/templates");
}

export async function deleteTemplateAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  await assertManagerAccess(studioId);
  const templateId = Number(formData.get("templateId"));

  await db
    .delete(schema.scheduleTemplates)
    .where(and(eq(schema.scheduleTemplates.id, templateId), eq(schema.scheduleTemplates.studioId, studioId)));

  revalidatePath("/templates");
  revalidatePath("/schedule");
}

export async function setDefaultTemplateAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  await assertManagerAccess(studioId);
  const templateId = Number(formData.get("templateId"));

  await db
    .update(schema.scheduleTemplates)
    .set({ isDefault: false })
    .where(eq(schema.scheduleTemplates.studioId, studioId));

  await db
    .update(schema.scheduleTemplates)
    .set({ isDefault: true })
    .where(and(eq(schema.scheduleTemplates.id, templateId), eq(schema.scheduleTemplates.studioId, studioId)));

  revalidatePath("/templates");
  revalidatePath("/schedule");
}

export async function addSlotAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  await assertManagerAccess(studioId);

  const templateId = Number(formData.get("templateId"));
  const weekday = Number(formData.get("weekday"));
  const time = String(formData.get("time"));
  const teacherId = Number(formData.get("teacherId")) || null;
  const classTypeId = Number(formData.get("classTypeId")) || null;
  const room = String(formData.get("room") ?? "").trim() || null;
  const capacity = Number(formData.get("capacity")) || 20;

  await db.insert(schema.scheduleTemplateSlots).values({
    templateId,
    weekday,
    time,
    teacherId,
    classTypeId,
    room,
    capacity,
  });

  revalidatePath("/templates");
}

export async function updateSlotAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  await assertManagerAccess(studioId);

  const slotId = Number(formData.get("slotId"));
  const weekday = Number(formData.get("weekday"));
  const time = String(formData.get("time"));
  const teacherId = Number(formData.get("teacherId")) || null;
  const classTypeId = Number(formData.get("classTypeId")) || null;
  const room = String(formData.get("room") ?? "").trim() || null;
  const capacity = Number(formData.get("capacity")) || 20;

  await db
    .update(schema.scheduleTemplateSlots)
    .set({ weekday, time, teacherId, classTypeId, room, capacity })
    .where(eq(schema.scheduleTemplateSlots.id, slotId));

  revalidatePath("/templates");
}

export async function removeSlotAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  await assertManagerAccess(studioId);
  const slotId = Number(formData.get("slotId"));

  await db.delete(schema.scheduleTemplateSlots).where(eq(schema.scheduleTemplateSlots.id, slotId));

  revalidatePath("/templates");
}
