import { requirePageContext } from "@/lib/context";
import { changeOwnPasswordAction } from "./actions";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  missing: "Fill in all three fields.",
  short: "New password needs to be at least 8 characters.",
  mismatch: "New password and confirmation don't match.",
  wrong_current: "Current password is wrong.",
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const { session } = await requirePageContext();

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-stone-900">My account</h1>
        <p className="text-sm text-stone-500">
          Signed in as {session.name} ({session.email}).
        </p>
      </div>

      {saved && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Password changed.
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {ERROR_MESSAGES[error] ?? "Something went wrong — try again."}
        </p>
      )}

      <form
        action={changeOwnPasswordAction}
        className="space-y-3 rounded-xl border border-stone-200 bg-white p-4"
      >
        <div>
          <label className="block text-xs text-stone-500">Current password</label>
          <input
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-stone-500">New password</label>
          <input
            name="newPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-stone-500">Confirm new password</label>
          <input
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
        </div>
        <button className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800">
          Change password
        </button>
      </form>
    </div>
  );
}
