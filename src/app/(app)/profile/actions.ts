"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios } from "@/lib/auth";

// Vercel's own server-upload path tops out at 4.5MB — stay under that with
// room to spare rather than let a near-the-limit file fail inside put()
// with a less legible error.
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const PHOTO_EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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

  // The photo field is a real file upload now, not a pasted URL. Leave the
  // existing photoUrl completely untouched unless a new file actually came
  // through — re-saving the bio alone must never blank out an existing
  // photo just because the file input was empty on that submit.
  let photoUrl = teacher.photoUrl;
  let photoError: "type" | "size" | "upload" | null = null;

  const photo = formData.get("photo");
  if (photo instanceof File && photo.size > 0) {
    const extension = PHOTO_EXTENSION_BY_TYPE[photo.type];
    if (!extension) {
      photoError = "type";
    } else if (photo.size > MAX_PHOTO_BYTES) {
      photoError = "size";
    } else {
      try {
        const blob = await put(`teacher-photos/${studioId}/${teacher.id}-${Date.now()}.${extension}`, photo, {
          access: "public",
        });
        photoUrl = blob.url;
      } catch (err) {
        // Fails open on the photo specifically: the bio change below still
        // saves, and the teacher gets a clear reason to retry just the
        // photo, rather than losing an unrelated bio edit to an upload
        // hiccup. console.error only — nothing here is sensitive enough to
        // need a dedicated diagnostic route (see operational note #2).
        console.error("Teacher photo upload failed", err);
        photoError = "upload";
      }
    }
  }

  await db
    .update(schema.teachers)
    .set({ bio: bio || null, photoUrl: photoUrl || null })
    .where(eq(schema.teachers.id, teacher.id));

  revalidatePath("/profile");
  // redirect() is called here, outside the try/catch above, so Next's
  // internal redirect mechanism can't get swallowed by the upload's error
  // handling (same established pattern as the Iyzico checkout redirect).
  redirect(`/profile?saved=1${photoError ? `&photoError=${photoError}` : ""}`);
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
