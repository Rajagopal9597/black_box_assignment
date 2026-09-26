import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addMember, createTestApp, resetDb, signUp, uploadFile, type TestContext, type TestUser } from "./helpers.js";

/** The "can one user reach another user's files?" suite. */
describe("authorization across users and roles", () => {
  let ctx: TestContext;
  let alice: TestUser;
  let mallory: TestUser;
  let docId: string;
  let ws: string;

  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx);
    alice = await signUp(ctx.app, "Alice");
    mallory = await signUp(ctx.app, "Mallory");
    ws = alice.personalWorkspaceId;
    docId = (await uploadFile(alice, ws, "secret")).body.document.id;
  });

  it("an outsider gets 403 for everything in someone else's workspace, and nothing changes", async () => {
    const m = mallory.agent;
    expect((await m.get(`/api/workspaces/${ws}`)).status).toBe(403);
    expect((await m.get(`/api/workspaces/${ws}/documents`)).status).toBe(403);
    expect((await m.get(`/api/workspaces/${ws}/members`)).status).toBe(403);
    expect((await m.get(`/api/workspaces/${ws}/activity`)).status).toBe(403);
    expect((await m.get(`/api/documents/${docId}/download`)).status).toBe(403);
    expect((await m.delete(`/api/documents/${docId}`)).status).toBe(403);
    expect((await m.post(`/api/documents/${docId}/shares`).send({})).status).toBe(403);
    expect((await m.get(`/api/documents/${docId}/shares`)).status).toBe(403);
    expect((await uploadFile(mallory, ws)).status).toBe(403);
    expect((await m.post(`/api/workspaces/${ws}/invitations`).send({ email: mallory.email, role: "editor" })).status).toBe(403);
    expect((await m.delete(`/api/workspaces/${ws}`)).status).toBe(403);
    const body = (await m.get(`/api/documents/${docId}/download`)).body;
    expect(body.error.message).toMatch(/not a member/);
    // Alice's document is untouched
    expect((await alice.agent.get(`/api/documents/${docId}/download`)).text).toBe("secret");
  });

  it("resources that don't exist are 404", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await mallory.agent.get(`/api/workspaces/${missing}`)).status).toBe(404);
    expect((await mallory.agent.get(`/api/documents/${missing}/download`)).status).toBe(404);
  });

  it("an outsider's workspace list doesn't include other people's workspaces", async () => {
    const res = await mallory.agent.get("/api/workspaces");
    expect(res.body.workspaces.map((w: { id: string }) => w.id)).toEqual([mallory.personalWorkspaceId]);
  });

  it("viewer: can read and download, cannot change anything", async () => {
    const viewer = await signUp(ctx.app, "Viewer");
    await addMember(alice, viewer, ws, "viewer");
    const v = viewer.agent;
    expect((await v.get(`/api/workspaces/${ws}/documents`)).body.documents).toHaveLength(1);
    expect((await v.get(`/api/documents/${docId}/download`)).text).toBe("secret");
    expect((await v.get(`/api/workspaces/${ws}`)).body.workspace.permissions).toMatchObject({
      canUpload: false,
      canShare: false,
      canManageMembers: false,
    });
    expect((await uploadFile(viewer, ws)).status).toBe(403);
    expect((await v.delete(`/api/documents/${docId}`)).status).toBe(403);
    expect((await v.post(`/api/documents/${docId}/shares`).send({})).status).toBe(403);
    expect((await v.post(`/api/workspaces/${ws}/invitations`).send({ email: "x@example.com", role: "viewer" })).status).toBe(403);
    expect((await v.patch(`/api/workspaces/${ws}`).send({ name: "hacked" })).status).toBe(403);
  });

  it("editor: can upload and share, cannot manage members or the workspace", async () => {
    const editor = await signUp(ctx.app, "Editor");
    await addMember(alice, editor, ws, "editor");
    const e = editor.agent;
    expect((await uploadFile(editor, ws)).status).toBe(201);
    expect((await e.post(`/api/documents/${docId}/shares`).send({})).status).toBe(201);
    expect((await e.get(`/api/workspaces/${ws}`)).body.workspace.permissions).toMatchObject({
      canDeleteOwnDocuments: true,
      canDeleteAnyDocument: false,
    });
    expect((await e.post(`/api/workspaces/${ws}/invitations`).send({ email: "x@example.com", role: "viewer" })).status).toBe(403);
    expect((await e.patch(`/api/workspaces/${ws}/members/${alice.id}`).send({ role: "viewer" })).status).toBe(403);
    expect((await e.delete(`/api/workspaces/${ws}/members/${alice.id}`)).status).toBe(403);
    expect((await e.delete(`/api/workspaces/${ws}`)).status).toBe(403);
  });

  it("editors can delete only their own uploads; owners can delete anything", async () => {
    const editor = await signUp(ctx.app, "Editor");
    await addMember(alice, editor, ws, "editor");
    const ownDoc = (await uploadFile(editor, ws, "mine")).body.document.id;
    const otherEditorDoc = (await uploadFile(editor, ws, "also mine")).body.document.id;

    // editor -> someone else's (the owner's) document: refused, file still there
    const res = await editor.agent.delete(`/api/documents/${docId}`);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/only delete documents they uploaded/);
    expect((await alice.agent.get(`/api/documents/${docId}/download`)).text).toBe("secret");

    // editor -> own document: allowed
    expect((await editor.agent.delete(`/api/documents/${ownDoc}`)).status).toBe(204);

    // owner -> editor's document: allowed
    expect((await alice.agent.delete(`/api/documents/${otherEditorDoc}`)).status).toBe(204);
  });

  it("removed members lose access immediately", async () => {
    const editor = await signUp(ctx.app, "Editor");
    await addMember(alice, editor, ws, "editor");
    await alice.agent.delete(`/api/workspaces/${ws}/members/${editor.id}`).expect(204);
    expect((await editor.agent.get(`/api/documents/${docId}/download`)).status).toBe(403);
  });

  it("malformed ids are 404, not 500", async () => {
    expect((await alice.agent.get("/api/documents/not-a-uuid/download")).status).toBe(404);
    expect((await alice.agent.get("/api/workspaces/1 OR 1=1")).status).toBe(404);
  });
});
