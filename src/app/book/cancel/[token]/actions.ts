"use server";

import { redirect } from "next/navigation";
import { cancelBookingByToken } from "@/lib/cancel";

// Public (token-gated) server action behind /book/cancel/[token]. The token
// is the only credential — it's unguessable and tied to one booking.
export async function cancelBookingAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const result = await cancelBookingByToken(token);
  if (!result.ok) redirect(`/book/cancel/${encodeURIComponent(token)}?error=${result.reason}`);
  const qs = new URLSearchParams({ done: "1" });
  if (result.late) qs.set("late", "1");
  if (result.creditForfeited) qs.set("credit", "1");
  redirect(`/book/cancel/${encodeURIComponent(token)}?${qs.toString()}`);
}
