import type { AuthUser } from "../auth/session.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware when the session cookie is valid. */
      user?: AuthUser;
    }
  }
}

export {};
