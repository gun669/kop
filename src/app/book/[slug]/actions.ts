"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { bookGuestForSession } from "@/lib/booking";

// Public server action behind the guest-facing booking page — no session,
// no studio-access check like the internal app has, since anyone with the
// studio's link is meant to be able to use this. Every input is re-verified
// against the database rather than trusted from the submitted form: the
// studio slug resolves to a real studio, and the class session has to
// actually belong to that studio and still be a live, future, scheduled
// class before bookGuestForSession() is even called.
export async function bookSessionAction(formData: FormData) {
  const slug = String(formData.get("slug") ?? "");
  const classSessionId = Number(formData.get("classSessionId"));
  const day = String(formData.get("day") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  const backTo = (params: Record<string, string>) => {
    const qs = new URLSearchParams({ day, ...params });
    return `/book/${slug}?${qs.toString()}`;
  };

  if (!slug || !classSessionId || !name || !phone) {
    redirect(backTo({ error: "missing" }));
  }

  const [studio] = await db
    .select()
    .from(schema.studios)
    .where(eq(schema.studios.slug, slug))
    .limit(1);
  if (!studio) redirect("/book");

  const [sessionRow] = await db
    .select({
      id: schema.classSessions.id,
      studioId: schema.classSessions.studioId,
      status: schema.classSessions.status,
      startsAt: schema.classSessions.startsAt,
    })
    .from(schema.classSessions)
    .where(eq(schema.classSessions.id, classSessionId))
    .limit(1);

  if (
    !sessionRow ||
    sessionRow.studioId !== studio.id ||
    sessionRow.status !== "scheduled" ||
    sessionRow.startsAt.getTime() <= Date.now()
  ) {
    redirect(backTo({ error: "unavailable" }));
  }

  const result = await bookGuestForSession({
    studioId: studio.id,
    classSessionId,
    name,
    phone,
  });

  if (!result.ok) {
    redirect(backTo({ error: result.reason }));
  }

  redirect(backTo({ confirmed: String(classSessionId) }));
}
