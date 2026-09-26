import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.js";

// <api root>/drizzle — works from both src/db (tsx) and dist/db (compiled).
const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_FOLDER = path.resolve(here, "../../drizzle");

export async function runMigrations(databaseUrl: string): Promise<void> {
  // Fail loudly: an API running against a database without its tables is worse than one that
  // refuses to start. (This once "skipped" silently because the folder wasn't readable in Docker.)
  const journal = path.join(MIGRATIONS_FOLDER, "meta/_journal.json");
  if (!existsSync(journal)) {
    throw new Error(`[migrate] migrations not found or not readable at ${journal}`);
  }
  const { db, pool } = createDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

// Allow `npm run db:migrate` to run this file directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  runMigrations(url)
    .then(() => console.log("[migrate] done"))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
