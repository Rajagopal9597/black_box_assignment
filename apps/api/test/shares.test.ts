import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { shareLinks } from "../src/db/schema.js";
import { createTestApp, resetDb, shareToken, signUp, uploadFile, type TestContext, type TestUser } from "./helpers.js";

describe("share links", () => {
  let ctx: TestContext;
  let alice: TestUser;
  let docId: string;

  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx);
    alice = await signUp(ctx.app, "Alice");
    docId = (await uploadFile(alice, alice.personalWorkspaceId, "shared content", "Résumé final.txt")).body.document.id;
  });

  async function createLink(body: object = {}) {
    const res = await alice.agent.post(`/api/documents/${docId}/shares`).send(body);
    expect(res.status).toBe(201);
    return { token: shareToken(res.body.url), shareId: res.body.share.id as string };
  }

  it("lets anyone with the link (no account) see metadata and download, as an attachment", async () => {
    const { token } = await createLink();
    const info = await request(ctx.app).get(`/api/s/${token}`);
    expect(info.status).toBe(200);
    expect(info.body.document).toMatchObject({ name: "Résumé final.txt", sizeBytes: 14 });
    expect(info.body.document).not.toHaveProperty("storageKey");

    const dl = await request(ctx.app).get(`/api/s/${token}/download`);
    expect(dl.status).toBe(200);
    expect(dl.text).toBe("shared content");
    expect(dl.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(dl.headers["content-disposition"]).toContain("filename*=UTF-8''R%C3%A9sum%C3%A9%20final.txt");
    expect(dl.headers["x-content-type-options"]).toBe("nosniff");

    const shares = await alice.agent.get(`/api/documents/${docId}/shares`);
    expect(shares.body.shares[0]).toMatchObject({ downloadCount: 1, status: "active" });
  });

  it("tokens are long, random and stored only as a hash", async () => {
    const { token } = await createLink();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await ctx.db.select().from(shareLinks);
    expect(rows[0]!.tokenHash).not.toContain(token);
    // The list endpoint never returns tokens or hashes
    const list = await alice.agent.get(`/api/documents/${docId}/shares`);
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(JSON.stringify(list.body)).not.toContain(rows[0]!.tokenHash);
  });

  it("a revoked link stops working", async () => {
    const { token, shareId } = await createLink();
    await alice.agent.delete(`/api/shares/${shareId}`).expect(204);
    expect((await request(ctx.app).get(`/api/s/${token}`)).status).toBe(404);
    expect((await request(ctx.app).get(`/api/s/${token}/download`)).status).toBe(404);
  });

  it("an expired link stops working", async () => {
    const { token, shareId } = await createLink({ expiresInDays: 1 });
    await ctx.db.update(shareLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(shareLinks.id, shareId));
    expect((await request(ctx.app).get(`/api/s/${token}/download`)).status).toBe(404);
  });

  it("deleting the document kills its links and removes the blob", async () => {
    const { token } = await createLink({ expiresInDays: null });
    expect(ctx.storage.objects.size).toBe(1);
    await alice.agent.delete(`/api/documents/${docId}`).expect(204);
    expect((await request(ctx.app).get(`/api/s/${token}`)).status).toBe(404);
    expect(ctx.storage.objects.size).toBe(0);
    expect(await ctx.db.select().from(shareLinks)).toHaveLength(0);
  });

  it("guessed or malformed tokens are 404", async () => {
    expect((await request(ctx.app).get(`/api/s/${"a".repeat(43)}`)).status).toBe(404);
    expect((await request(ctx.app).get(`/api/s/../../etc/passwd`)).status).toBe(404);
  });

  it("another user cannot revoke Alice's link", async () => {
    const { token, shareId } = await createLink();
    const mallory = await signUp(ctx.app, "Mallory");
    expect((await mallory.agent.delete(`/api/shares/${shareId}`)).status).toBe(403);
    expect((await request(ctx.app).get(`/api/s/${token}`)).status).toBe(200);
  });
});
