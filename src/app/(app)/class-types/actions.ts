"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";

async function assertManagerAccess(studioId: number) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const studios = await getAccessibleStudios(session);
  const studio = studios.find((s) => s.id === studioId);
  if (!studio || !["owner", "manager"].includes(studio.role)) {
    throw new Error("Not allowed to edit class types");
  }
  return { session, studio };
}

export async function createClassTypeAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  await assertManagerAccess(studioId);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const durationMinutes = Number(formData.get("durationMinutes")) || 60;

  await db.insert(schema.classTypes).values({ studioId, name, durationMinutes });

  revalidatePath("/class-types");
  revalidatePath("/schedule");
  revalidatePath("/templates");
}

export async function updateClassTypeAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  await assertManagerAccess(studioId);

  const classTypeId = Number(formData.get("classTypeId"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const durationMinutes = Number(formData.get("durationMinutes")) || 60;

  await db
    .update(schema.classTypes)
    .set({ name, durationMinutes })
    .where(and(eq(schema.classTypes.id, classTypeId), eq(schema.classTypes.studioId, studioId)));

  revalidatePath("/class-types");
  revalidatePath("/schedule");
  revalidatePath("/templates");
}

export async function setClassTypeActiveAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  await assertManagerAccess(studioId);

  const classTypeId = Number(formData.get("classTypeId"));
  const active = String(formData.get("active")) === "true";

  await db
    .update(schema.classTypes)
    .set({ active })
    .where(and(eq(schema.classTypes.id, classTypeId), eq(schema.classTypes.studioId, studioId)));

  revalidatePath("/class-types");
  revalidatePath("/schedule");
  revalidatePath("/templates");
}
