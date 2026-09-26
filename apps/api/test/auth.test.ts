import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sessions } from "../src/db/schema.js";
import { createTestApp, resetDb, signUp, type TestContext } from "./helpers.js";

describe("auth", () => {
  let ctx: TestContext;
  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx));

  it("register sets an HttpOnly, SameSite session cookie scoped to /api and creates a personal workspace", async () => {
    const res = await request(ctx.app)
      .post("/api/auth/register")
      .send({ email: "Alice@Example.com", name: "Alice", password: "password123" });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("alice@example.com");
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/sid=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/api/);

    const me = await request(ctx.app).get("/api/workspaces").set("Cookie", cookie);
    expect(me.body.workspaces).toHaveLength(1);
    expect(me.body.workspaces[0]).toMatchObject({ name: "Personal", role: "owner" });
  });

  it("stores only a hash of the session token", async () => {
    const res = await request(ctx.app)
      .post("/api/auth/register")
      .send({ email: "a@example.com", name: "A", password: "password123" });
    const raw = /sid=([^;]+)/.exec(String(res.headers["set-cookie"]))![1]!;
    const rows = await ctx.db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(raw);
    expect(rows[0]!.tokenHash).toHaveLength(64);
  });

  it("rejects duplicate emails (case-insensitive)", async () => {
    await signUp(ctx.app, "Bob");
    const first = await request(ctx.app).post("/api/auth/register").send({ email: "dup@example.com", name: "x", password: "password123" });
    expect(first.status).toBe(201);
    const second = await request(ctx.app).post("/api/auth/register").send({ email: "DUP@example.com", name: "y", password: "password123" });
    expect(second.status).toBe(409);
  });

  it("validates input", async () => {
    const res = await request(ctx.app).post("/api/auth/register").send({ email: "nope", name: "", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("gives the same error for wrong password and unknown email", async () => {
    const u = await signUp(ctx.app, "Carol");
    const wrongPw = await request(ctx.app).post("/api/auth/login").send({ email: u.email, password: "wrong-password" });
    const noUser = await request(ctx.app).post("/api/auth/login").send({ email: "ghost@example.com", password: "whatever" });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body).toEqual(noUser.body);
  });

  it("logout invalidates the session server-side (a stolen cookie stops working)", async () => {
    const login = await request(ctx.app)
      .post("/api/auth/register")
      .send({ email: "d@example.com", name: "D", password: "password123" });
    const cookie = String(login.headers["set-cookie"]);
    expect((await request(ctx.app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);
    await request(ctx.app).post("/api/auth/logout").set("Cookie", cookie).expect(204);
    expect((await request(ctx.app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("protected endpoints return 401 without a session", async () => {
    expect((await request(ctx.app).get("/api/workspaces")).status).toBe(401);
    expect((await request(ctx.app).get("/api/documents/00000000-0000-0000-0000-000000000000/download")).status).toBe(401);
  });
});
