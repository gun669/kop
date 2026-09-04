import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./index";

// Applies any SQL migration files under /drizzle that haven't been applied
// yet to whatever database DATABASE_URL points at. Safe to call repeatedly —
// Drizzle tracks what's already applied in a __drizzle_migrations table and
// skips it.
export async function runMigrations() {
  await migrate(db, { migrationsFolder: "./drizzle" });
}
