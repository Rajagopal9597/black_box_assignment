import cookieParser from "cookie-parser";
import cors from "cors";
import { sql } from "drizzle-orm";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { Config } from "./config/env.js";
import type { Db } from "./db/client.js";
import { logger } from "./lib/logger.js";
import { authenticate } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { documentsRouter } from "./modules/documents/documents.routes.js";
import { invitationsRouter } from "./modules/invitations/invitations.routes.js";
import { sharesRouter } from "./modules/shares/shares.routes.js";
import { workspacesRouter } from "./modules/workspaces/workspaces.routes.js";
import type { ObjectStorage } from "./storage/index.js";

/** Everything the app needs from the outside world. Injected so tests can pass fakes. */
export interface AppDeps {
  config: Config;
  db: Db;
  storage: ObjectStorage;
}

export function createApp(deps: AppDeps): Express {
  const { config, db, storage } = deps;
  const app = express();

  app.set("trust proxy", 1); // behind nginx: real client IP for rate limiting / logs
  app.disable("x-powered-by");

  app.use(pinoHttp({ logger }));
  // HSTS only makes sense (and is only safe to send) when the app is actually served over HTTPS.
  app.use(helmet({ strictTransportSecurity: config.COOKIE_SECURE }));
  app.use(cors({ origin: config.APP_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: config.NODE_ENV === "test" ? 10_000 : 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use("/api", authenticate(db));

  app.get("/api/health", async (_req, res) => {
    const [dbOk, storageOk] = await Promise.all([
      db.execute(sql`select 1`).then(() => true, () => false),
      storage.ping().then(() => true, () => false),
    ]);
    const ok = dbOk && storageOk;
    res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", db: dbOk, storage: storageOk });
  });

  // Each module declares its full paths (e.g. /workspaces/:id/documents), so routers mount at /api.
  app.use("/api", authRouter(deps));
  app.use("/api", workspacesRouter(deps));
  app.use("/api", invitationsRouter(deps));
  app.use("/api", documentsRouter(deps));
  app.use("/api", sharesRouter(deps)); // includes the public /s/:token endpoints

  app.use("/api", notFoundHandler);
  app.use(errorHandler);

  return app;
}
