import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { AppDeps } from "../../app.js";
import { sendDocument } from "../../lib/download.js";
import { tokenParam, uuidParam } from "../../lib/validate.js";
import { requireAuth } from "../../middleware/auth.js";
import {
  CreateShareInput,
  createShareLink,
  getSharedDocumentInfo,
  listShareLinks,
  recordSharedDownload,
  revokeShareLink,
} from "./shares.service.js";

export function sharesRouter({ config, db, storage }: AppDeps): Router {
  const router = Router();

  // --- Managing links (signed-in editors/owners) ---
  router.get("/documents/:documentId/shares", requireAuth, async (req, res) => {
    res.json({ shares: await listShareLinks(db, uuidParam(req, "documentId"), req.user!.id) });
  });

  router.post("/documents/:documentId/shares", requireAuth, async (req, res) => {
    const input = CreateShareInput.parse(req.body ?? {});
    const { share, token } = await createShareLink(db, uuidParam(req, "documentId"), req.user!.id, input);
    // The full URL is only ever returned here — we store just the token's hash.
    res.status(201).json({ share, url: `${config.APP_ORIGIN}/s/${token}` });
  });

  router.delete("/shares/:shareId", requireAuth, async (req, res) => {
    await revokeShareLink(db, uuidParam(req, "shareId"), req.user!.id);
    res.status(204).end();
  });

  // --- Public (anyone with the link, no account) ---
  const publicLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.NODE_ENV === "test" ? 1000 : 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

  router.get("/s/:token", publicLimiter, async (req, res) => {
    res.json({ document: await getSharedDocumentInfo(db, tokenParam(req, "token")) });
  });

  router.get("/s/:token/download", publicLimiter, async (req, res) => {
    const doc = await recordSharedDownload(db, tokenParam(req, "token"));
    await sendDocument(res, storage, doc);
  });

  return router;
}
