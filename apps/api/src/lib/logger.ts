import { pino } from "pino";

const env = process.env.NODE_ENV ?? "development";

export const logger = pino({
  level: env === "test" ? "silent" : "info",
  ...(env === "development" ? { transport: { target: "pino-pretty" } } : {}),
});
