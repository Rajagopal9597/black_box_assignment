import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { AppDeps } from "../../app.js";
import { clearSessionCookie, createSession, destroySession, SESSION_COOKIE, setSessionCookie } from "../../auth/session.js";
import { unauthorized } from "../../lib/errors.js";
import { login, LoginInput, register, RegisterInput } from "./auth.service.js";

export function authRouter({ config, db }: AppDeps): Router {
  const router = Router();
  const secure = config.COOKIE_SECURE;

  // Brute-force protection on credential endpoints (per IP).
  const credentialLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: config.NODE_ENV === "test" ? 1000 : 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many attempts, try again later" } },
  });

  router.post("/auth/register", credentialLimiter, async (req, res) => {
    const user = await register(db, RegisterInput.parse(req.body));
    const { token, expiresAt } = await createSession(db, user.id, config.SESSION_TTL_HOURS);
    setSessionCookie(res, token, expiresAt, secure);
    res.status(201).json({ user });
  });

  router.post("/auth/login", credentialLimiter, async (req, res) => {
    const user = await login(db, LoginInput.parse(req.body));
    const { token, expiresAt } = await createSession(db, user.id, config.SESSION_TTL_HOURS);
    setSessionCookie(res, token, expiresAt, secure);
    res.json({ user });
  });

  router.post("/auth/logout", async (req, res) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === "string") await destroySession(db, token);
    clearSessionCookie(res, secure);
    res.status(204).end();
  });

  router.get("/auth/me", (req, res) => {
    if (!req.user) throw unauthorized();
    res.json({ user: req.user });
  });

  return router;
}
