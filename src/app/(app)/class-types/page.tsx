import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePageContext, requireRole } from "@/lib/context";
import { createClassTypeAction, updateClassTypeAction, setClassTypeActiveAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ClassTypesPage() {
  const { studio, role } = await requirePageContext();
  requireRole(role, ["owner", "manager"]);

  const classTypes = await db
    .select()
    .from(schema.classTypes)
    .where(eq(schema.classTypes.studioId, studio.id))
    .orderBy(asc(schema.classTypes.name));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-stone-900">Class types</h1>
        <p className="text-sm text-stone-500">
          The catalog of classes {studio.name} offers — these are what show up when scheduling a class or
          building a template.
        </p>
      </div>

      <form action={createClassTypeAction} className="flex flex-wrap items-end gap-2 rounded-xl border border-stone-200 bg-white p-4">
        <input type="hidden" name="studioId" value={studio.id} />
        <div>
          <label className="block text-xs text-stone-500">Name</label>
          <input name="name" required placeholder="e.g. Vinyasa Flow" className="rounded-lg border border-stone-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-stone-500">Duration (minutes)</label>
          <input type="number" name="durationMinutes" defaultValue={60} min={15} step={5} className="w-28 rounded-lg border border-stone-300 px-3 py-2 text-sm" />
        </div>
        <button className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800">
          Add class type
        </button>
      </form>

      <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
        {classTypes.length === 0 && (
          <li className="px-4 py-3 text-sm text-stone-400">No class types yet — add the first one above.</li>
        )}
        {classTypes.map((c) => (
          <li key={c.id} className={`px-4 py-3 ${!c.active ? "opacity-50" : ""}`}>
            <details>
              <summary className="cursor-pointer text-sm">
                <span className="font-medium text-stone-800">{c.name}</span>{" "}
                <span className="text-stone-500">· {c.durationMinutes} min</span>
                {!c.active && <span className="ml-2 text-xs text-stone-400">inactive</span>}
              </summary>
              <div className="mt-3 space-y-2 rounded-lg bg-stone-50 p-3">
                <form action={updateClassTypeAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="studioId" value={studio.id} />
                  <input type="hidden" name="classTypeId" value={c.id} />
                  <div>
                    <label className="block text-xs text-stone-500">Name</label>
                    <input name="name" defaultValue={c.name} required className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-500">Duration (minutes)</label>
                    <input type="number" name="durationMinutes" defaultValue={c.durationMinutes} min={15} step={5} className="w-24 rounded-lg border border-stone-300 px-2 py-1.5 text-xs" />
                  </div>
                  <button className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-800">
                    Save changes
                  </button>
                </form>
                <form action={setClassTypeActiveAction}>
                  <input type="hidden" name="studioId" value={studio.id} />
                  <input type="hidden" name="classTypeId" value={c.id} />
                  <input type="hidden" name="active" value={(!c.active).toString()} />
                  <button className="text-xs text-stone-600 hover:underline">
                    {c.active ? "Deactivate" : "Reactivate"}
                  </button>
                </form>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
