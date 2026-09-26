import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { logger } from "./lib/logger.js";
import { createStorage } from "./storage/index.js";

async function main() {
  const config = loadConfig();

  // Migrations run on boot so `docker compose up` is the only command needed.
  await runMigrations(config.DATABASE_URL);

  const { db, pool } = createDb(config.DATABASE_URL);
  const storage = createStorage(config);
  const app = createApp({ config, db, storage });

  const server = app.listen(config.API_PORT, "0.0.0.0", () => {
    logger.info(`API listening on :${config.API_PORT}`);
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
