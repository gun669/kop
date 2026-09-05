import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePageContext, requireRole } from "@/lib/context";
import { updateOwnProfileAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;
  const { studio, role, session } = await requirePageContext();
  requireRole(role, ["teacher"]);

  const [teacher] = await db
    .select()
    .from(schema.teachers)
    .where(and(eq(schema.teachers.studioId, studio.id), eq(schema.teachers.userId, session.userId)))
    .limit(1);

  if (!teacher) {
    return (
      <div className="max-w-lg space-y-2">
        <h1 className="text-lg font-semibold text-stone-900">My profile</h1>
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Your account isn&apos;t linked to a teacher profile at {studio.name} yet — ask a manager to add you
          on the Team page.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-stone-900">My profile</h1>
        <p className="text-sm text-stone-500">
          This bio and photo show up wherever {studio.name} lists its teachers — students see it, other
          staff can&apos;t edit it for you.
        </p>
      </div>

      {saved && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved.</p>
      )}

      <form action={updateOwnProfileAction} className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
        <input type="hidden" name="studioId" value={studio.id} />

        <div className="flex items-center gap-3">
          {teacher.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={teacher.photoUrl}
              alt={teacher.name}
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-stone-100 text-lg font-medium text-stone-400">
              {teacher.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="text-sm text-stone-500">{teacher.name}</div>
        </div>

        <div>
          <label className="block text-xs text-stone-500">Photo URL</label>
          <input
            name="photoUrl"
            type="url"
            defaultValue={teacher.photoUrl ?? ""}
            placeholder="https://…"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-stone-500">Bio</label>
          <textarea
            name="bio"
            defaultValue={teacher.bio ?? ""}
            rows={5}
            placeholder="A few sentences about your teaching style and background…"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
        </div>

        <button className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800">
          Save profile
        </button>
      </form>
    </div>
  );
}
