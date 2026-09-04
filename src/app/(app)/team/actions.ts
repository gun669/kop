"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, getAccessibleStudios, findUserByEmail, hashPassword } from "@/lib/auth";

async function assertManagerAccess(studioId: number) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const studios = await getAccessibleStudios(session);
  const studio = studios.find((s) => s.id === studioId);
  if (!studio || !["owner", "manager"].includes(studio.role)) {
    throw new Error("Not allowed to manage the team");
  }
  return { session, studio };
}

type Role = "owner" | "manager" | "receptionist" | "teacher";

export async function addTeamMemberAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  await assertManagerAccess(studioId);

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "teacher") as Role;

  if (!name || !email) {
    redirect(`/team?error=${encodeURIComponent("Name and email are required.")}`);
  }

  let user = await findUserByEmail(email);

  if (user) {
    const [alreadyMember] = await db
      .select()
      .from(schema.studioMembers)
      .where(and(eq(schema.studioMembers.userId, user.id), eq(schema.studioMembers.studioId, studioId)))
      .limit(1);
    if (alreadyMember) {
      redirect(`/team?error=${encodeURIComponent(`${email} already has access to this studio.`)}`);
    }
  } else {
    if (!password || password.length < 8) {
      redirect(`/team?error=${encodeURIComponent("Set a password of at least 8 characters for a new person.")}`);
    }
    const [created] = await db
      .insert(schema.users)
      .values({ name, email, passwordHash: await hashPassword(password) })
      .returning();
    user = created;
  }

  await db.insert(schema.studioMembers).values({ userId: user.id, studioId, role });

  // Role "teacher" needs a row in `teachers` too, so they show up in the
  // schedule/template pickers — without this, giving someone a login as a
  // teacher wouldn't actually let anyone assign them to a class.
  if (role === "teacher") {
    const [existingTeacher] = await db
      .select()
      .from(schema.teachers)
      .where(and(eq(schema.teachers.studioId, studioId), eq(schema.teachers.userId, user.id)))
      .limit(1);
    if (!existingTeacher) {
      await db.insert(schema.teachers).values({ studioId, userId: user.id, name, email });
    }
  }

  revalidatePath("/team");
  revalidatePath("/schedule");
  revalidatePath("/templates");
  redirect("/team");
}

export async function removeTeamMemberAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  const { session } = await assertManagerAccess(studioId);

  const memberId = Number(formData.get("memberId"));
  const memberUserId = Number(formData.get("memberUserId"));

  if (memberUserId === session.userId) {
    redirect(`/team?error=${encodeURIComponent("You can't remove your own access.")}`);
  }

  await db
    .delete(schema.studioMembers)
    .where(and(eq(schema.studioMembers.id, memberId), eq(schema.studioMembers.studioId, studioId)));

  revalidatePath("/team");
}
