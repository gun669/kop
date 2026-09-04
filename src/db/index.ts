import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// Different Postgres marketplace integrations (Neon, Supabase, etc.) name
// their injected connection string differently depending on how they were
// connected. Accept the common ones so deploys don't silently fail just
// because the env var isn't literally called DATABASE_URL.
const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  "";

// Deliberately not throwing here if connectionString is empty: this module
// gets imported while Next.js is just analyzing the page structure at build
// time — before a database is necessarily connected yet (e.g. the very
// first deploy, before the Postgres integration is added). postgres.js
// doesn't actually open a connection until a query runs, so an empty string
// is safe here; a real error surfaces naturally, at request time, the
// moment a page actually tries to read from the database with none
// configured — which is when it should surface.
const client = postgres(connectionString, { max: 10 });

export const db = drizzle(client, { schema });
export * as schema from "./schema";
