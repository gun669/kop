import { redirect } from "next/navigation";
import Link from "next/link";
import {
  getSession,
  getAccessibleStudios,
  getCurrentStudioId,
} from "@/lib/auth";
import { logoutAction, switchStudioAction } from "./actions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const studios = await getAccessibleStudios(session);
  if (studios.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4 text-center">
        <div>
          <p className="text-stone-700">
            {session.name}, your account isn&apos;t linked to any studio yet.
          </p>
          <p className="text-sm text-stone-400 mt-1">Ask an owner to add you.</p>
        </div>
      </div>
    );
  }

  const currentStudioId = await getCurrentStudioId(studios);
  const currentStudio = studios.find((s) => s.id === currentStudioId) ?? studios[0];
  const role = currentStudio.role;

  const navLinks = [
    { href: "/dashboard", label: "Dashboard", roles: ["owner", "manager", "receptionist", "teacher"] },
    { href: "/checkin", label: "Check-in", roles: ["owner", "manager", "receptionist", "teacher"] },
    { href: "/guests", label: "Guests", roles: ["owner", "manager", "receptionist"] },
    { href: "/schedule", label: "Schedule", roles: ["owner", "manager", "teacher"] },
    { href: "/templates", label: "Templates", roles: ["owner", "manager"] },
    { href: "/class-types", label: "Class types", roles: ["owner", "manager"] },
    { href: "/money", label: "Revenue & expenses", roles: ["owner", "manager"] },
    { href: "/bills", label: "Bills", roles: ["owner", "manager"] },
    { href: "/reports", label: "Reports", roles: ["owner", "manager"] },
    { href: "/team", label: "Team", roles: ["owner", "manager"] },
    { href: "/profile", label: "My profile", roles: ["owner", "manager", "teacher"] },
    { href: "/account", label: "My account", roles: ["owner", "manager", "receptionist", "teacher"] },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        {/* w-full + min-w-0 on the shrinking pieces below keep this row from
            ever forcing the page wider than the viewport on mobile — see
            the nav row's own overflow-x-auto for how the links stay
            reachable without taking the whole page sideways with them. */}
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex w-full items-center justify-between gap-3">
            <Link
              href="/dashboard"
              className="shrink-0 text-lg font-semibold tracking-tight text-stone-900"
            >
              KOP
            </Link>

            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              {studios.length > 1 ? (
                <form action={switchStudioAction} className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                  <select
                    name="studioId"
                    defaultValue={currentStudio.id}
                    className="w-28 min-w-0 rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs text-stone-700 sm:w-auto sm:text-sm"
                  >
                    {studios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="shrink-0 rounded-lg border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50"
                  >
                    Go
                  </button>
                </form>
              ) : (
                <span className="hidden truncate text-sm text-stone-500 sm:inline">
                  {currentStudio.name}
                </span>
              )}
              <span className="hidden text-sm text-stone-400 md:inline">
                {session.name} · {role}
              </span>
              <form action={logoutAction} className="shrink-0">
                <button className="text-sm text-stone-500 hover:text-stone-900">Sign out</button>
              </form>
            </div>
          </div>

          {/* Nav scrolls sideways within its own strip when it doesn't fit —
              the page itself never does. -mx-4/px-4 lets the scroll area
              bleed to the screen edges while staying aligned with the
              content above it. */}
          <nav className="-mx-4 mt-2 flex gap-4 overflow-x-auto whitespace-nowrap px-4 pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:whitespace-normal sm:px-0 [&::-webkit-scrollbar]:hidden">
            {navLinks
              .filter((l) => l.roles.includes(role))
              .map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="shrink-0 text-sm text-stone-600 hover:text-stone-900"
                >
                  {l.label}
                </Link>
              ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
