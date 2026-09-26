import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

/** Unknown /api routes -> JSON 404 (instead of Express's default HTML page). */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
};

/**
 * Single place that turns errors into HTTP responses.
 * Express 5 forwards errors thrown in async handlers here automatically — no try/catch in routes.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", issues: err.issues } });
    return;
  }
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    res.status(status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  // Malformed JSON body, payload too large, etc. raised by body-parser.
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ error: { code: "REQUEST_ERROR", message: (err as Error).message } });
    return;
  }
  logger.error({ err, method: req.method, url: req.originalUrl }, "unhandled error");
  // Never leak internals (stack traces, SQL, storage errors) to the client.
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
};
