import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePageContext, requireRole } from "@/lib/context";
import { addTeamMemberAction, removeTeamMemberAction } from "./actions";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  receptionist: "Receptionist",
  teacher: "Teacher",
};

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { session, studio, role } = await requirePageContext();
  requireRole(role, ["owner", "manager"]);

  const members = await db
    .select({
      id: schema.studioMembers.id,
      role: schema.studioMembers.role,
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.studioMembers)
    .innerJoin(schema.users, eq(schema.studioMembers.userId, schema.users.id))
    .where(eq(schema.studioMembers.studioId, studio.id))
    .orderBy(asc(schema.users.name));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-stone-900">Team — {studio.name}</h1>
        <p className="text-sm text-stone-500">
          People with access to this studio. Adding someone as a teacher also creates their teacher
          profile, so they show up when scheduling classes.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <form action={addTeamMemberAction} className="flex flex-wrap items-end gap-2 rounded-xl border border-stone-200 bg-white p-4">
        <input type="hidden" name="studioId" value={studio.id} />
        <div>
          <label className="block text-xs text-stone-500">Name</label>
          <input name="name" required placeholder="Full name" className="rounded-lg border border-stone-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-stone-500">Email</label>
          <input type="email" name="email" required placeholder="name@example.com" className="rounded-lg border border-stone-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-stone-500">Initial password</label>
          <input type="text" name="password" placeholder="min. 8 characters" className="rounded-lg border border-stone-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-stone-500">Role</label>
          <select name="role" defaultValue="teacher" className="rounded-lg border border-stone-300 px-3 py-2 text-sm">
            <option value="teacher">Teacher</option>
            <option value="receptionist">Receptionist</option>
            <option value="manager">Manager</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <button className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800">
          Add person
        </button>
      </form>
      <p className="-mt-4 text-xs text-stone-400">
        If the email already has a KOP login (e.g. from another studio), the password field is ignored —
        they just get added to {studio.name} with the role you pick.
      </p>

      <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
        {members.map((m) => (
          <li key={m.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <div>
              <div className="font-medium text-stone-800">
                {m.name} {m.userId === session.userId && <span className="text-xs text-stone-400">(you)</span>}
              </div>
              <div className="text-xs text-stone-400">{m.email}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
                {ROLE_LABELS[m.role] ?? m.role}
              </span>
              {m.userId !== session.userId && (
                <form action={removeTeamMemberAction}>
                  <input type="hidden" name="studioId" value={studio.id} />
                  <input type="hidden" name="memberId" value={m.id} />
                  <input type="hidden" name="memberUserId" value={m.userId} />
                  <button className="text-xs text-red-600 hover:underline">Remove access</button>
                </form>
              )}
            </div>
          </li>
        ))}
        {members.length === 0 && (
          <li className="px-4 py-3 text-sm text-stone-400">No one else has access to {studio.name} yet.</li>
        )}
      </ul>
    </div>
  );
}
