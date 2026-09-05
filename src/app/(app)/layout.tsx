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
    { href: "/schedule", label: "Schedule", roles: ["owner", "manager", "teacher"] },
    { href: "/templates", label: "Templates", roles: ["owner", "manager"] },
    { href: "/class-types", label: "Class types", roles: ["owner", "manager"] },
    { href: "/money", label: "Revenue & expenses", roles: ["owner", "manager"] },
    { href: "/team", label: "Team", roles: ["owner", "manager"] },
    { href: "/profile", label: "My profile", roles: ["teacher"] },
  ];

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-semibold tracking-tight text-stone-900">
              KOP
            </Link>
            <nav className="flex gap-4">
              {navLinks
                .filter((l) => l.roles.includes(role))
                .map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="text-sm text-stone-600 hover:text-stone-900"
                  >
                    {l.label}
                  </Link>
                ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {studios.length > 1 ? (
              <form action={switchStudioAction} className="flex items-center gap-2">
                <select
                  name="studioId"
                  defaultValue={currentStudio.id}
                  className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700"
                >
                  {studios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-lg border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50"
                >
                  Switch
                </button>
              </form>
            ) : (
              <span className="text-sm text-stone-500">{currentStudio.name}</span>
            )}
            <span className="hidden text-sm text-stone-400 sm:inline">
              {session.name} · {role}
            </span>
            <form action={logoutAction}>
              <button className="text-sm text-stone-500 hover:text-stone-900">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
