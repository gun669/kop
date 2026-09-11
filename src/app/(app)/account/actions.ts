"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession, hashPassword, verifyPassword } from "@/lib/auth";

// Any signed-in role can change their own password — this is deliberately
// not role-gated the way most (app) pages are, since every account
// (owner, manager, receptionist, teacher) needs a way off a shared/demo
// password with nobody else's help. Always acts on the signed-in user's
// own row; there's no userId taken from the form to trust.
export async function changeOwnPasswordAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!currentPassword || !newPassword || !confirmPassword) {
    redirect("/account?error=missing");
  }
  if (newPassword.length < 8) {
    redirect("/account?error=short");
  }
  if (newPassword !== confirmPassword) {
    redirect("/account?error=mismatch");
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  if (!user) redirect("/login");

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    redirect("/account?error=wrong_current");
  }

  const passwordHash = await hashPassword(newPassword);
  await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, user.id));

  redirect("/account?saved=1");
}
