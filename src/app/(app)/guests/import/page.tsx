import Link from "next/link";
import { requirePageContext, requireRole } from "@/lib/context";
import { uploadImportBatchAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function GuestImportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { studio, role } = await requirePageContext();
  requireRole(role, ["owner", "manager"]);

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <Link href="/guests" className="text-sm text-stone-500 hover:text-stone-900">
          ← Back to Guests
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-stone-900">Import guests from a CSV file</h1>
        <p className="mt-1 text-sm text-stone-500">
          Bring your existing guest list into {studio.name} — from a Wix Contacts export, a spreadsheet, or
          any other CSV. You&apos;ll get to check exactly what will be added or updated before anything is saved.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
        <form action={uploadImportBatchAction} encType="multipart/form-data" className="space-y-3">
          <input type="hidden" name="studioId" value={studio.id} />
          <div>
            <label className="block text-xs text-stone-500">CSV file</label>
            <input
              type="file"
              name="csv"
              accept=".csv,text/csv"
              required
              className="mt-1 block w-full text-sm text-stone-700 file:mr-3 file:rounded-lg file:border file:border-stone-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-stone-700 hover:file:bg-stone-50"
            />
          </div>
          <button className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800">
            Upload &amp; preview
          </button>
        </form>

        <details className="text-xs text-stone-500">
          <summary className="cursor-pointer font-medium text-stone-700">Exporting from Wix</summary>
          <div className="mt-2 space-y-1">
            <p>In your Wix dashboard: Contacts → select all → Export (or Bookings → Customers → Export).</p>
            <p>That downloads a CSV — upload it here as-is, no need to edit it first.</p>
          </div>
        </details>
      </div>

      <p className="text-xs text-stone-400">
        Guests are matched by phone number, the same way check-in matches them — someone already in KOP won&apos;t
        get a duplicate record, and nothing already on file gets overwritten, only filled in where it was blank.
      </p>
    </div>
  );
}
