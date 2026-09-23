"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";

// A teacher can only ever edit their own row — there's no studioId/teacherId
// passed in from the client to trust, it's derived from the signed-in user.
// Not teacher-only: an owner/manager who also teaches (and has a linked
// teachers row, see createMyTeacherProfileAction below) edits their own
// bio/photo here too.
async function requireOwnTeacherRecord(studioId: number) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const studios = await getAccessibleStudios(session);
  const studio = studios.find((s) => s.id === studioId);
  if (!studio || !["owner", "manager", "teacher"].includes(studio.role)) {
    throw new Error("Not allowed to edit a profile here");
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

// Lets an owner/manager who also teaches classes create their own teacher
// profile in one click, instead of needing a manual DB fix — the existing
// "Add team member" flow on /team can't do this for them, since it only
// creates a teachers row for a *new* login and blocks re-adding someone
// who already has studio access under a different role.
export async function createMyTeacherProfileAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const studios = await getAccessibleStudios(session);
  const studio = studios.find((s) => s.id === studioId);
  if (!studio || !["owner", "manager"].includes(studio.role)) {
    throw new Error("Not allowed to create a teacher profile here");
  }

  const [existing] = await db
    .select()
    .from(schema.teachers)
    .where(and(eq(schema.teachers.studioId, studioId), eq(schema.teachers.userId, session.userId)))
    .limit(1);
  if (!existing) {
    await db.insert(schema.teachers).values({
      studioId,
      userId: session.userId,
      name: session.name,
      email: session.email,
    });
    revalidatePath("/profile");
    revalidatePath("/schedule");
    revalidatePath("/templates");
  }

  redirect("/profile");
}
