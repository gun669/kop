import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePageContext, requireRole } from "@/lib/context";
import { localDateKey } from "@/lib/time";
import { describeCoupon } from "@/lib/coupons";
import { createCouponAction, toggleCouponAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CouponsPage() {
  const { studio, role } = await requirePageContext();
  requireRole(role, ["owner", "manager"]);
  const todayKey = localDateKey(new Date(), studio.timezone);

  const coupons = await db
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.studioId, studio.id))
    .orderBy(desc(schema.coupons.createdAt));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-stone-900">Coupon codes</h1>
        <p className="text-sm text-stone-500">
          Guests type a code on the public booking page to discount the online drop-in price. Codes
          only apply when online payment is switched on for this studio.
        </p>
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-stone-900">New coupon</h2>
        <form action={createCouponAction} className="space-y-2">
          <input type="hidden" name="studioId" value={studio.id} />
          <div className="flex flex-wrap gap-2">
            <input
              name="code"
              required
              placeholder="Code (e.g. WELCOME20)"
              className="w-48 rounded-lg border border-stone-300 px-3 py-2 text-sm uppercase"
            />
            <select name="discountType" className="rounded-lg border border-stone-300 px-2 py-2 text-sm">
              <option value="percent">Percent off (%)</option>
              <option value="fixed">Fixed amount off ({studio.currency})</option>
            </select>
            <input
              name="value"
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="Amount"
              className="w-28 rounded-lg border border-stone-300 px-2 py-2 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-stone-600">
            <label className="flex items-center gap-2">
              Expires
              <input name="expiresOn" type="date" className="rounded-lg border border-stone-300 px-2 py-2 text-sm" />
            </label>
            <label className="flex items-center gap-2">
              Max uses
              <input
                name="maxUses"
                type="number"
                min="1"
                placeholder="Unlimited"
                className="w-28 rounded-lg border border-stone-300 px-2 py-2 text-sm"
              />
            </label>
          </div>
          <button className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white hover:bg-stone-800">
            Create coupon
          </button>
        </form>
      </div>

      <div className="rounded-xl border border-stone-200 bg-white">
        <div className="border-b border-stone-100 px-4 py-2 text-sm font-medium text-stone-700">
          All coupons
        </div>
        {coupons.length === 0 ? (
          <p className="px-4 py-6 text-sm text-stone-400">No coupons yet.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {coupons.map((c) => {
              const expired = c.expiresOn !== null && c.expiresOn < todayKey;
              const usedUp = c.maxUses !== null && c.usedCount >= c.maxUses;
              const status = !c.active ? "Off" : expired ? "Expired" : usedUp ? "Used up" : "Active";
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <p className="font-mono font-medium text-stone-900">{c.code}</p>
                    <p className="text-xs text-stone-500">
                      {describeCoupon(c, studio.currency)} · used {c.usedCount}
                      {c.maxUses !== null ? ` of ${c.maxUses}` : ""}
                      {c.expiresOn ? ` · expires ${c.expiresOn}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        status === "Active" ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-500"
                      }`}
                    >
                      {status}
                    </span>
                    <form action={toggleCouponAction}>
                      <input type="hidden" name="studioId" value={studio.id} />
                      <input type="hidden" name="couponId" value={c.id} />
                      <button className="rounded-lg border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">
                        {c.active ? "Turn off" : "Turn on"}
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
