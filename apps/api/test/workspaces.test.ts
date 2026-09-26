import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { documents } from "../src/db/schema.js";
import { addMember, createTestApp, resetDb, signUp, uploadFile, type TestContext, type TestUser } from "./helpers.js";

describe("workspace membership & deletion", () => {
  let ctx: TestContext;
  let owner: TestUser;
  let ws: string;

  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx);
    owner = await signUp(ctx.app, "Owner");
    ws = (await owner.agent.post("/api/workspaces").send({ name: "Team" })).body.workspace.id;
  });

  it("the last owner can't leave or demote themselves", async () => {
    expect((await owner.agent.delete(`/api/workspaces/${ws}/members/${owner.id}`)).status).toBe(400);
    expect((await owner.agent.patch(`/api/workspaces/${ws}/members/${owner.id}`).send({ role: "editor" })).status).toBe(400);
  });

  it("after promoting someone else, the original owner can leave", async () => {
    const bob = await signUp(ctx.app, "Bob");
    await addMember(owner, bob, ws, "editor");
    await owner.agent.patch(`/api/workspaces/${ws}/members/${bob.id}`).send({ role: "owner" }).expect(204);
    await owner.agent.delete(`/api/workspaces/${ws}/members/${owner.id}`).expect(204);
    expect((await owner.agent.get(`/api/workspaces/${ws}`)).status).toBe(403);
    expect((await bob.agent.get(`/api/workspaces/${ws}`)).body.workspace.role).toBe("owner");
  });

  it("any member can leave; their uploads stay in the workspace", async () => {
    const bob = await signUp(ctx.app, "Bob");
    await addMember(owner, bob, ws, "editor");
    await uploadFile(bob, ws);
    await bob.agent.delete(`/api/workspaces/${ws}/members/${bob.id}`).expect(204);
    expect((await owner.agent.get(`/api/workspaces/${ws}/documents`)).body.documents).toHaveLength(1);
  });

  it("deleting a workspace removes its documents and their blobs", async () => {
    await uploadFile(owner, ws, "one");
    await uploadFile(owner, ws, "two");
    await uploadFile(owner, owner.personalWorkspaceId, "keep me");
    expect(ctx.storage.objects.size).toBe(3);
    await owner.agent.delete(`/api/workspaces/${ws}`).expect(204);
    expect(ctx.storage.objects.size).toBe(1);
    expect(await ctx.db.select().from(documents)).toHaveLength(1);
  });

  it("records activity for the audit log", async () => {
    await uploadFile(owner, ws, "x", "report.pdf");
    const res = await owner.agent.get(`/api/workspaces/${ws}/activity`);
    expect(res.body.events.map((e: { action: string }) => e.action)).toEqual(["document.uploaded", "workspace.created"]);
    expect(res.body.events[0]).toMatchObject({ actorName: "Owner", details: { document: "report.pdf" } });
  });

  it("rejects uploads over the size limit with 413", async () => {
    const big = "x".repeat(26 * 1024 * 1024);
    const res = await uploadFile(owner, ws, big, "big.bin");
    expect(res.status).toBe(413);
    expect(ctx.storage.objects.size).toBe(0);
  });
});
