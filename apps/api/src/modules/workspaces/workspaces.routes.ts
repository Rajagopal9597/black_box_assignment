import { Router } from "express";
import type { AppDeps } from "../../app.js";
import { uuidParam } from "../../lib/validate.js";
import { requireAuth } from "../../middleware/auth.js";
import { listActivity } from "../activity/activity.service.js";
import {
  changeMemberRole,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listMembers,
  listWorkspaces,
  removeMember,
  renameWorkspace,
  RoleInput,
  WorkspaceNameInput,
} from "./workspaces.service.js";

export function workspacesRouter({ db, storage }: AppDeps): Router {
  const router = Router();
  router.use("/workspaces", requireAuth);

  router.get("/workspaces", async (req, res) => {
    res.json({ workspaces: await listWorkspaces(db, req.user!.id) });
  });

  router.post("/workspaces", async (req, res) => {
    const { name } = WorkspaceNameInput.parse(req.body);
    res.status(201).json({ workspace: await createWorkspace(db, req.user!.id, name) });
  });

  router.get("/workspaces/:workspaceId", async (req, res) => {
    res.json({ workspace: await getWorkspace(db, uuidParam(req, "workspaceId"), req.user!.id) });
  });

  router.patch("/workspaces/:workspaceId", async (req, res) => {
    const { name } = WorkspaceNameInput.parse(req.body);
    await renameWorkspace(db, uuidParam(req, "workspaceId"), req.user!.id, name);
    res.status(204).end();
  });

  router.delete("/workspaces/:workspaceId", async (req, res) => {
    await deleteWorkspace(db, storage, uuidParam(req, "workspaceId"), req.user!.id);
    res.status(204).end();
  });

  router.get("/workspaces/:workspaceId/members", async (req, res) => {
    res.json({ members: await listMembers(db, uuidParam(req, "workspaceId"), req.user!.id) });
  });

  router.patch("/workspaces/:workspaceId/members/:userId", async (req, res) => {
    const { role } = RoleInput.parse(req.body);
    await changeMemberRole(db, uuidParam(req, "workspaceId"), req.user!.id, uuidParam(req, "userId"), role);
    res.status(204).end();
  });

  router.delete("/workspaces/:workspaceId/members/:userId", async (req, res) => {
    await removeMember(db, uuidParam(req, "workspaceId"), req.user!.id, uuidParam(req, "userId"));
    res.status(204).end();
  });

  router.get("/workspaces/:workspaceId/activity", async (req, res) => {
    res.json({ events: await listActivity(db, uuidParam(req, "workspaceId"), req.user!.id) });
  });

  return router;
}
