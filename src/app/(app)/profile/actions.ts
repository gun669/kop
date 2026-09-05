"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";

// A teacher can only ever edit their own row — there's no studioId/teacherId
// passed in from the client to trust, it's derived from the signed-in user.
async function requireOwnTeacherRecord(studioId: number) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const studios = await getAccessibleStudios(session);
  const studio = studios.find((s) => s.id === studioId);
  if (!studio || studio.role !== "teacher") {
    throw new Error("Only a teacher account has a profile to edit here");
  }

  const [teacher] = await db
    .select()
    .from(schema.teachers)
    .where(and(eq(schema.teachers.studioId, studioId), eq(schema.teachers.userId, session.userId)))
    .limit(1);
  if (!teacher) throw new Error("No teacher profile linked to this account yet");

  return { session, studio, teacher };
}

export async function updateOwnProfileAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const { teacher } = await requireOwnTeacherRecord(studioId);

  const bio = String(formData.get("bio") ?? "").trim();
  const photoUrl = String(formData.get("photoUrl") ?? "").trim();

  await db
    .update(schema.teachers)
    .set({ bio: bio || null, photoUrl: photoUrl || null })
    .where(eq(schema.teachers.id, teacher.id));

  revalidatePath("/profile");
  redirect("/profile?saved=1");
}
