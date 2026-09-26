import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { workspaceInvitations } from "../src/db/schema.js";
import { createTestApp, inviteToken, resetDb, signUp, type TestContext, type TestUser } from "./helpers.js";

describe("invitations", () => {
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

  const invite = (email: string, role = "editor") =>
    owner.agent.post(`/api/workspaces/${ws}/invitations`).send({ email, role });

  it("invites someone with no account: preview -> register with that email -> accept -> member", async () => {
    const res = await invite("New.Person@example.com", "viewer");
    expect(res.status).toBe(201);
    const token = inviteToken(res.body.inviteUrl);

    const preview = await request(ctx.app).get(`/api/invitations/${token}`);
    expect(preview.body.invitation).toMatchObject({ workspaceName: "Team", email: "new.person@example.com", role: "viewer" });

    const agent = request.agent(ctx.app);
    await agent.post("/api/auth/register").send({ email: "new.person@example.com", name: "New", password: "password123" }).expect(201);
    const accept = await agent.post(`/api/invitations/${token}/accept`);
    expect(accept.body).toEqual({ workspaceId: ws });

    const w = await agent.get(`/api/workspaces/${ws}`);
    expect(w.body.workspace.role).toBe("viewer");

    // single use
    expect((await agent.post(`/api/invitations/${token}/accept`)).status).toBe(404);
    expect((await request(ctx.app).get(`/api/invitations/${token}`)).status).toBe(404);
  });

  it("a forwarded link can't be accepted by a different account", async () => {
    const token = inviteToken((await invite("intended@example.com")).body.inviteUrl);
    const eve = await signUp(ctx.app, "Eve");
    const res = await eve.agent.post(`/api/invitations/${token}/accept`);
    expect(res.status).toBe(403);
    expect((await eve.agent.get(`/api/workspaces/${ws}`)).status).toBe(403);
  });

  it("accepting requires being signed in", async () => {
    const token = inviteToken((await invite("x@example.com")).body.inviteUrl);
    expect((await request(ctx.app).post(`/api/invitations/${token}/accept`)).status).toBe(401);
  });

  it("revoked and expired invites don't work", async () => {
    const r1 = await invite("a@example.com");
    await owner.agent.delete(`/api/workspaces/${ws}/invitations/${r1.body.invitation.id}`).expect(204);
    expect((await request(ctx.app).get(`/api/invitations/${inviteToken(r1.body.inviteUrl)}`)).status).toBe(404);

    const r2 = await invite("b@example.com");
    await ctx.db
      .update(workspaceInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(workspaceInvitations.id, r2.body.invitation.id));
    expect((await request(ctx.app).get(`/api/invitations/${inviteToken(r2.body.inviteUrl)}`)).status).toBe(404);
  });

  it("re-inviting the same email replaces the old link", async () => {
    const first = inviteToken((await invite("c@example.com")).body.inviteUrl);
    const second = inviteToken((await invite("c@example.com", "viewer")).body.inviteUrl);
    expect((await request(ctx.app).get(`/api/invitations/${first}`)).status).toBe(404);
    expect((await request(ctx.app).get(`/api/invitations/${second}`)).body.invitation.role).toBe("viewer");
    expect((await owner.agent.get(`/api/workspaces/${ws}/invitations`)).body.invitations).toHaveLength(1);
  });

  it("cannot invite an existing member, or invite someone as owner", async () => {
    expect((await invite(owner.email)).status).toBe(409);
    expect((await invite("d@example.com", "owner")).status).toBe(400);
  });
});
