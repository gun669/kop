import "dotenv/config";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

const SESSION_COOKIE = "kop_session";
const STUDIO_COOKIE = "kop_studio";

function secretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export type SessionPayload = {
  userId: number;
  name: string;
  email: string;
  isSuperOwner: boolean;
};

export async function createSession(payload: SessionPayload) {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey());

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(STUDIO_COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export type AccessibleStudio = {
  id: number;
  name: string;
  slug: string;
  city: string | null;
  currency: string;
  timezone: string;
  role: "owner" | "manager" | "receptionist" | "teacher";
};

// Studios this user can see. A super owner sees every studio (role
// reported as "owner"); everyone else sees only what studio_members grants.
export async function getAccessibleStudios(
  session: SessionPayload
): Promise<AccessibleStudio[]> {
  if (session.isSuperOwner) {
    const all = await db.select().from(schema.studios);
    return all.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      city: s.city,
      currency: s.currency,
      timezone: s.timezone,
      role: "owner" as const,
    }));
  }

  const rows = await db
    .select({
      id: schema.studios.id,
      name: schema.studios.name,
      slug: schema.studios.slug,
      city: schema.studios.city,
      currency: schema.studios.currency,
      timezone: schema.studios.timezone,
      role: schema.studioMembers.role,
    })
    .from(schema.studioMembers)
    .innerJoin(schema.studios, eq(schema.studioMembers.studioId, schema.studios.id))
    .where(eq(schema.studioMembers.userId, session.userId));

  return rows;
}

export async function getCurrentStudioId(
  accessible: AccessibleStudio[]
): Promise<number | null> {
  if (accessible.length === 0) return null;
  const store = await cookies();
  const raw = store.get(STUDIO_COOKIE)?.value;
  const requested = raw ? Number(raw) : null;
  if (requested && accessible.some((s) => s.id === requested)) {
    return requested;
  }
  return accessible[0].id;
}

export async function setCurrentStudioId(studioId: number) {
  const store = await cookies();
  store.set(STUDIO_COOKIE, String(studioId), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function findUserByEmail(email: string) {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  return rows[0] ?? null;
}
