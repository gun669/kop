"use server";

import { redirect } from "next/navigation";
import { findUserByEmail, verifyPassword, createSession } from "@/lib/auth";

export type LoginState = { error?: string };

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const user = await findUserByEmail(email);
  if (!user) {
    return { error: "No account with that email." };
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return { error: "Wrong password." };
  }

  await createSession({
    userId: user.id,
    name: user.name,
    email: user.email,
    isSuperOwner: user.isSuperOwner,
  });

  redirect("/dashboard");
}
