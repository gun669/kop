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
  process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  throw new Error(
    "No database connection string found. Set DATABASE_URL (or POSTGRES_URL) in your environment."
  );
}

// A single shared connection pool for the app.
const client = postgres(connectionString, { max: 10 });

export const db = drizzle(client, { schema });
export * as schema from "./schema";
