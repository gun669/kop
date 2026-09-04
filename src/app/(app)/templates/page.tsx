import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePageContext, requireRole } from "@/lib/context";
import {
  createTemplateAction,
  deleteTemplateAction,
  setDefaultTemplateAction,
  addSlotAction,
  updateSlotAction,
  removeSlotAction,
} from "./actions";

export const dynamic = "force-dynamic";

const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default async function TemplatesPage() {
  const { studio, role } = await requirePageContext();
  requireRole(role, ["owner", "manager"]);

  const [templates, teachers, classTypes] = await Promise.all([
    db
      .select()
      .from(schema.scheduleTemplates)
      .where(eq(schema.scheduleTemplates.studioId, studio.id))
      .orderBy(asc(schema.scheduleTemplates.createdAt)),
    db
      .select()
      .from(schema.teachers)
      .where(eq(schema.teachers.studioId, studio.id)),
    db
      .select()
      .from(schema.classTypes)
      .where(eq(schema.classTypes.studioId, studio.id)),
  ]);

  const templateIds = templates.map((t) => t.id);
  const allSlots =
    templateIds.length > 0
      ? await db
          .select({
            id: schema.scheduleTemplateSlots.id,
            templateId: schema.scheduleTemplateSlots.templateId,
            weekday: schema.scheduleTemplateSlots.weekday,
            time: schema.scheduleTemplateSlots.time,
            teacherId: schema.scheduleTemplateSlots.teacherId,
            classTypeId: schema.scheduleTemplateSlots.classTypeId,
            room: schema.scheduleTemplateSlots.room,
            capacity: schema.scheduleTemplateSlots.capacity,
            teacherName: schema.teachers.name,
            classTypeName: schema.classTypes.name,
          })
          .from(schema.scheduleTemplateSlots)
          .leftJoin(schema.teachers, eq(schema.scheduleTemplateSlots.teacherId, schema.teachers.id))
          .leftJoin(schema.classTypes, eq(schema.scheduleTemplateSlots.classTypeId, schema.classTypes.id))
      : [];

  const slotsByTemplate = new Map<number, typeof allSlots>();
  for (const s of allSlots) {
    const arr = slotsByTemplate.get(s.templateId) ?? [];
    arr.push(s);
    slotsByTemplate.set(s.templateId, arr);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-stone-900">Schedule templates</h1>
        <p className="text-sm text-stone-500">
          Save a weekly pattern once. The template marked <span className="font-medium">default</span>{" "}
          auto-fills any future week that's still empty — you'll only need to touch a week to handle an
          exception. Save other named templates (e.g. a low-season week) and apply one to a specific week
          any time from the Schedule page.
        </p>
      </div>

      <form action={createTemplateAction} className="flex gap-2">
        <input type="hidden" name="studioId" value={studio.id} />
        <input
          name="name"
          required
          placeholder="New template name, e.g. Default"
          className="flex-1 max-w-xs rounded-lg border border-stone-300 px-3 py-2 text-sm"
        />
        <button className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800">
          Create template
        </button>
      </form>

      {templates.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No templates yet for {studio.name}. Create one above, then add its weekly slots below.
        </p>
      )}

      <div className="space-y-4">
        {templates.map((t) => {
          const slots = (slotsByTemplate.get(t.id) ?? []).slice().sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time));
          return (
            <div key={t.id} className="rounded-xl border border-stone-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-stone-800">{t.name}</span>
                  {t.isDefault && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      Default — auto-fills future weeks
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {!t.isDefault && (
                    <form action={setDefaultTemplateAction}>
                      <input type="hidden" name="studioId" value={studio.id} />
                      <input type="hidden" name="templateId" value={t.id} />
                      <button className="text-xs font-medium text-stone-600 hover:underline">
                        Make default
                      </button>
                    </form>
                  )}
                  <form action={deleteTemplateAction}>
                    <input type="hidden" name="studioId" value={studio.id} />
                    <input type="hidden" name="templateId" value={t.id} />
                    <button className="text-xs text-red-600 hover:underline">Delete template</button>
                  </form>
                </div>
              </div>

              <ul className="divide-y divide-stone-100">
                {slots.length === 0 && (
                  <li className="px-4 py-3 text-sm text-stone-400">No slots yet — add the first one below.</li>
                )}
                {slots.map((s) => (
                  <li key={s.id} className="px-4 py-3">
                    <details>
                      <summary className="cursor-pointer text-sm">
                        <span className="font-medium text-stone-800">{WEEKDAY_LABELS[s.weekday]}</span>{" "}
                        <span className="text-stone-700">{s.time}</span>{" "}
                        <span className="text-stone-700">{s.classTypeName ?? "Class"}</span>
                        <div className="pl-0 text-xs text-stone-400">
                          {s.teacherName ?? "TBA"} {s.room ? `· ${s.room}` : ""} · cap {s.capacity}
                        </div>
                      </summary>
                      <div className="mt-3 space-y-2 rounded-lg bg-stone-50 p-3">
                        <form action={updateSlotAction} className="space-y-2">
                          <input type="hidden" name="studioId" value={studio.id} />
                          <input type="hidden" name="slotId" value={s.id} />
                          <div className="flex gap-2">
                            <select name="weekday" defaultValue={s.weekday} className="flex-1 rounded-lg border border-stone-300 px-2 py-1.5 text-xs">
                              {WEEKDAY_LABELS.map((label, i) => (
                                <option key={i} value={i}>{label}</option>
                              ))}
                            </select>
                            <input type="time" name="time" defaultValue={s.time} required className="w-28 rounded-lg border border-stone-300 px-2 py-1.5 text-xs" />
                          </div>
                          <select name="teacherId" defaultValue={s.teacherId ?? ""} className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs">
                            <option value="">No teacher assigned</option>
                            {teachers.map((tc) => (
                              <option key={tc.id} value={tc.id}>{tc.name}</option>
                            ))}
                          </select>
                          <select name="classTypeId" defaultValue={s.classTypeId ?? ""} className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs">
                            <option value="">Class type</option>
                            {classTypes.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                          <div className="flex gap-2">
                            <input name="room" defaultValue={s.room ?? ""} placeholder="Room / shala" className="flex-1 rounded-lg border border-stone-300 px-2 py-1.5 text-xs" />
                            <input type="number" name="capacity" defaultValue={s.capacity} min={1} className="w-20 rounded-lg border border-stone-300 px-2 py-1.5 text-xs" />
                          </div>
                          <button className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-800">
                            Save changes
                          </button>
                        </form>
                        <form action={removeSlotAction}>
                          <input type="hidden" name="studioId" value={studio.id} />
                          <input type="hidden" name="slotId" value={s.id} />
                          <button className="text-xs text-red-600 hover:underline">Remove this slot</button>
                        </form>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>

              <details className="border-t border-stone-100 px-4 py-3">
                <summary className="cursor-pointer text-sm text-stone-500">+ Add a slot</summary>
                <form action={addSlotAction} className="mt-2 space-y-2">
                  <input type="hidden" name="studioId" value={studio.id} />
                  <input type="hidden" name="templateId" value={t.id} />
                  <div className="flex gap-2">
                    <select name="weekday" defaultValue={0} className="flex-1 rounded-lg border border-stone-300 px-2 py-1.5 text-xs">
                      {WEEKDAY_LABELS.map((label, i) => (
                        <option key={i} value={i}>{label}</option>
                      ))}
                    </select>
                    <input type="time" name="time" required defaultValue="09:00" className="w-28 rounded-lg border border-stone-300 px-2 py-1.5 text-xs" />
                  </div>
                  <select name="teacherId" className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs">
                    <option value="">No teacher assigned</option>
                    {teachers.map((tc) => (
                      <option key={tc.id} value={tc.id}>{tc.name}</option>
                    ))}
                  </select>
                  <select name="classTypeId" className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs">
                    <option value="">Class type</option>
                    {classTypes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <input name="room" placeholder="Room / shala" className="flex-1 rounded-lg border border-stone-300 px-2 py-1.5 text-xs" />
                    <input type="number" name="capacity" defaultValue={20} min={1} className="w-20 rounded-lg border border-stone-300 px-2 py-1.5 text-xs" />
                  </div>
                  <button className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-800">
                    Add slot
                  </button>
                </form>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}
