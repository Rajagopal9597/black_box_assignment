import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { sendDocument } from "../../lib/download.js";
import { uuidParam } from "../../lib/validate.js";
import { requireAuth } from "../../middleware/auth.js";
import { createUpload } from "../../middleware/upload.js";
import { deleteDocument, getAuthorizedDocument, listDocuments, uploadDocument } from "./documents.service.js";

export function documentsRouter({ config, db, storage }: AppDeps): Router {
  const router = Router();
  const upload = createUpload(config.MAX_UPLOAD_BYTES);

  router.get("/workspaces/:workspaceId/documents", requireAuth, async (req, res) => {
    res.json({ documents: await listDocuments(db, uuidParam(req, "workspaceId"), req.user!.id) });
  });

  // requireAuth runs BEFORE multer, so anonymous uploads are rejected without reading the body.
  router.post("/workspaces/:workspaceId/documents", requireAuth, upload, async (req, res) => {
    const doc = await uploadDocument(db, storage, uuidParam(req, "workspaceId"), req.user!, req.file);
    res.status(201).json({ document: doc });
  });

  router.get("/documents/:documentId/download", requireAuth, async (req, res) => {
    const doc = await getAuthorizedDocument(db, uuidParam(req, "documentId"), req.user!.id, "viewer");
    await sendDocument(res, storage, doc);
  });

  router.delete("/documents/:documentId", requireAuth, async (req, res) => {
    await deleteDocument(db, storage, uuidParam(req, "documentId"), req.user!.id);
    res.status(204).end();
  });

  return router;
}
