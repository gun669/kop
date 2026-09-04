import { redirect } from "next/navigation";
import {
  getSession,
  getAccessibleStudios,
  getCurrentStudioId,
  type AccessibleStudio,
  type SessionPayload,
} from "@/lib/auth";

export type PageContext = {
  session: SessionPayload;
  studios: AccessibleStudio[];
  studio: AccessibleStudio;
  role: AccessibleStudio["role"];
};

// Shared server-side guard for pages inside the (app) group: resolves the
// signed-in user, the studio they're currently viewing, and their role at
// that studio. Redirects to /login if there's no valid session.
export async function requirePageContext(): Promise<PageContext> {
  const session = await getSession();
  if (!session) redirect("/login");

  const studios = await getAccessibleStudios(session);
  if (studios.length === 0) redirect("/login");

  const currentStudioId = await getCurrentStudioId(studios);
  const studio = studios.find((s) => s.id === currentStudioId) ?? studios[0];

  return { session, studios, studio, role: studio.role };
}

export function requireRole(
  role: PageContext["role"],
  allowed: PageContext["role"][]
) {
  if (!allowed.includes(role)) {
    redirect("/dashboard");
  }
}
