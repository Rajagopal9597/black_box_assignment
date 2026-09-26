import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { tokenParam, uuidParam } from "../../lib/validate.js";
import { requireAuth } from "../../middleware/auth.js";
import {
  acceptInvitation,
  CreateInviteInput,
  createInvitation,
  listPendingInvitations,
  previewInvitation,
  revokeInvitation,
} from "./invitations.service.js";

export function invitationsRouter({ config, db }: AppDeps): Router {
  const router = Router();

  // --- Owner-side management (inside a workspace) ---
  router.get("/workspaces/:workspaceId/invitations", requireAuth, async (req, res) => {
    const invitations = await listPendingInvitations(db, uuidParam(req, "workspaceId"), req.user!.id);
    res.json({ invitations });
  });

  router.post("/workspaces/:workspaceId/invitations", requireAuth, async (req, res) => {
    const { invitation, token } = await createInvitation(db, {
      workspaceId: uuidParam(req, "workspaceId"),
      actorId: req.user!.id,
      input: CreateInviteInput.parse(req.body),
      ttlDays: config.INVITE_TTL_DAYS,
    });
    res.status(201).json({ invitation, inviteUrl: `${config.APP_ORIGIN}/invite/${token}` });
  });

  router.delete("/workspaces/:workspaceId/invitations/:invitationId", requireAuth, async (req, res) => {
    await revokeInvitation(db, uuidParam(req, "workspaceId"), req.user!.id, uuidParam(req, "invitationId"));
    res.status(204).end();
  });

  // --- Invitee side (token from the link) ---
  router.get("/invitations/:token", async (req, res) => {
    res.json({ invitation: await previewInvitation(db, tokenParam(req, "token")) });
  });

  router.post("/invitations/:token/accept", requireAuth, async (req, res) => {
    res.json(await acceptInvitation(db, tokenParam(req, "token"), req.user!));
  });

  return router;
}
