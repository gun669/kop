import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePageContext, requireRole } from "@/lib/context";
import { normalizePhone } from "@/lib/phone";
import {
  parseCsvWithHeader,
  autoDetectGuestMapping,
  resolveName,
  cellAt,
  type GuestColumnMapping,
} from "@/lib/csv";
import { confirmImportBatchAction, cancelImportBatchAction } from "../actions";

export const dynamic = "force-dynamic";

const FIELD_LABELS: { key: keyof GuestColumnMapping; label: string; help?: string }[] = [
  { key: "nameCol", label: "Full name column" },
  { key: "firstNameCol", label: "…or first name column", help: "used only if \"Full name\" above is left blank" },
  { key: "lastNameCol", label: "…and last name column" },
  { key: "phoneCol", label: "Phone column" },
  { key: "emailCol", label: "Email column" },
  { key: "notesCol", label: "Notes / tags column" },
  { key: "sourceCol", label: "Source column", help: "e.g. Instagram, Referral, Walk-in — optional" },
  { key: "memberSinceCol", label: "Member since column", help: "optional; only ISO (2026-01-15) or M/D/YYYY dates are recognized" },
];

function ColumnSelect({
  name,
  headers,
  value,
}: {
  name: string;
  headers: string[];
  value: string | null;
}) {
  return (
    <select
      name={name}
      defaultValue={value ?? ""}
      className="w-full rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm"
    >
      <option value="">— none —</option>
      {headers.map((h) => (
        <option key={h} value={h}>
          {h}
        </option>
      ))}
    </select>
  );
}

export default async function GuestImportPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { studio, role } = await requirePageContext();
  requireRole(role, ["owner", "manager"]);

  const batchId = Number(id);
  const [batch] = await db
    .select()
    .from(schema.guestImportBatches)
    .where(and(eq(schema.guestImportBatches.id, batchId), eq(schema.guestImportBatches.studioId, studio.id)))
    .limit(1);
  if (!batch) notFound();

  const { headers, rows } = parseCsvWithHeader(batch.csvText);
  const detected = autoDetectGuestMapping(headers);
  const mapping: GuestColumnMapping = {
    nameCol: sp.nameCol !== undefined ? sp.nameCol || null : detected.nameCol,
    firstNameCol: sp.firstNameCol !== undefined ? sp.firstNameCol || null : detected.firstNameCol,
    lastNameCol: sp.lastNameCol !== undefined ? sp.lastNameCol || null : detected.lastNameCol,
    phoneCol: sp.phoneCol !== undefined ? sp.phoneCol || null : detected.phoneCol,
    emailCol: sp.emailCol !== undefined ? sp.emailCol || null : detected.emailCol,
    notesCol: sp.notesCol !== undefined ? sp.notesCol || null : detected.notesCol,
    sourceCol: sp.sourceCol !== undefined ? sp.sourceCol || null : detected.sourceCol,
    memberSinceCol: sp.memberSinceCol !== undefined ? sp.memberSinceCol || null : detected.memberSinceCol,
  };

  const existing = await db
    .select({ phone: schema.guests.phone })
    .from(schema.guests)
    .where(and(eq(schema.guests.studioId, studio.id), isNotNull(schema.guests.phone)));
  const existingPhones = new Set(existing.map((g) => normalizePhone(g.phone)).filter(Boolean));

  type Status = "new" | "update" | "skip";
  const resolved = rows.map((row) => {
    const name = resolveName(headers, row, mapping);
    const phone = cellAt(headers, row, mapping.phoneCol);
    const email = cellAt(headers, row, mapping.emailCol);
    const normalized = normalizePhone(phone);
    let status: Status = "new";
    if (!name) status = "skip";
    else if (normalized && existingPhones.has(normalized)) status = "update";
    return { name, phone, email, status };
  });

  const counts = {
    new: resolved.filter((r) => r.status === "new").length,
    update: resolved.filter((r) => r.status === "update").length,
    skip: resolved.filter((r) => r.status === "skip").length,
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <Link href="/guests/import" className="text-sm text-stone-500 hover:text-stone-900">
          ← Start over
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-stone-900">
          Preview: {batch.fileName || "your CSV"}
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          {rows.length} row{rows.length === 1 ? "" : "s"} found. Nothing is saved until you confirm below.
        </p>
      </div>

      <form method="get" className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
        <p className="text-sm font-medium text-stone-800">Which columns are which?</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FIELD_LABELS.map((f) => (
            <div key={f.key}>
              <label className="block text-xs text-stone-500">{f.label}</label>
              <ColumnSelect name={f.key} headers={headers} value={mapping[f.key]} />
              {f.help && <p className="mt-0.5 text-xs text-stone-400">{f.help}</p>}
            </div>
          ))}
        </div>
        <button className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50">
          Update preview
        </button>
      </form>

      <div className="flex gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm">
        <div>
          <div className="text-lg font-semibold text-emerald-700">{counts.new}</div>
          <div className="text-xs text-stone-500">New guests</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-stone-700">{counts.update}</div>
          <div className="text-xs text-stone-500">Existing guests updated</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-stone-400">{counts.skip}</div>
          <div className="text-xs text-stone-500">Skipped (no name)</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-50 text-xs text-stone-500">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {resolved.slice(0, 25).map((r, i) => (
              <tr key={i}>
                <td className="px-3 py-2">{r.name || <span className="text-stone-400">—</span>}</td>
                <td className="px-3 py-2 text-stone-500">{r.phone || "—"}</td>
                <td className="px-3 py-2 text-stone-500">{r.email || "—"}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      r.status === "new"
                        ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
                        : r.status === "update"
                          ? "rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600"
                          : "rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600"
                    }
                  >
                    {r.status === "new" ? "New" : r.status === "update" ? "Update" : "Skip"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {resolved.length > 25 && (
          <p className="border-t border-stone-100 px-3 py-2 text-xs text-stone-400">
            +{resolved.length - 25} more row{resolved.length - 25 === 1 ? "" : "s"} not shown here, but included below.
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <form action={confirmImportBatchAction}>
          <input type="hidden" name="studioId" value={studio.id} />
          <input type="hidden" name="batchId" value={batch.id} />
          <input type="hidden" name="nameCol" value={mapping.nameCol ?? ""} />
          <input type="hidden" name="firstNameCol" value={mapping.firstNameCol ?? ""} />
          <input type="hidden" name="lastNameCol" value={mapping.lastNameCol ?? ""} />
          <input type="hidden" name="phoneCol" value={mapping.phoneCol ?? ""} />
          <input type="hidden" name="emailCol" value={mapping.emailCol ?? ""} />
          <input type="hidden" name="notesCol" value={mapping.notesCol ?? ""} />
          <input type="hidden" name="sourceCol" value={mapping.sourceCol ?? ""} />
          <input type="hidden" name="memberSinceCol" value={mapping.memberSinceCol ?? ""} />
          <button className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800">
            Confirm import — add {counts.new}, update {counts.update}
          </button>
        </form>
        <form action={cancelImportBatchAction}>
          <input type="hidden" name="studioId" value={studio.id} />
          <input type="hidden" name="batchId" value={batch.id} />
          <button className="text-sm text-stone-500 hover:text-stone-900">Cancel, discard this file</button>
        </form>
      </div>
    </div>
  );
}
