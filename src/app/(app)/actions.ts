"use server";

import { redirect } from "next/navigation";
import { destroySession, setCurrentStudioId } from "@/lib/auth";

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function switchStudioAction(formData: FormData) {
  const studioId = Number(formData.get("studioId"));
  if (studioId) {
    await setCurrentStudioId(studioId);
  }
  const redirectTo = String(formData.get("redirectTo") ?? "/dashboard");
  redirect(redirectTo);
}
