import { sql } from "drizzle-orm";
import type { Express } from "express";
import request from "supertest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { createDb, type Db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { MemoryStorage } from "../src/storage/memory.storage.js";

export interface TestContext {
  app: Express;
  db: Db;
  storage: MemoryStorage;
  close: () => Promise<void>;
}

/**
 * Real Postgres (TEST_DATABASE_URL) + in-memory blob storage.
 * Start the DB with: docker compose up -d postgres
 * Drive the app with supertest: request(ctx.app).get("/api/...")
 */
export async function createTestApp(): Promise<TestContext> {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");

  const config = loadConfig({ ...process.env, NODE_ENV: "test", DATABASE_URL: databaseUrl });
  await runMigrations(databaseUrl);
  const { db, pool } = createDb(databaseUrl);
  const storage = new MemoryStorage();
  const app = createApp({ config, db, storage });

  return { app, db, storage, close: () => pool.end() };
}

/** Wipe all application tables and stored blobs between tests. */
export async function resetDb(ctx: Pick<TestContext, "db" | "storage">): Promise<void> {
  ctx.storage.objects.clear();
  await ctx.db.execute(sql`
    TRUNCATE users, sessions, workspaces, workspace_members,
             workspace_invitations, documents, share_links
    RESTART IDENTITY CASCADE
  `);
}

export interface TestUser {
  agent: ReturnType<typeof request.agent>;
  id: string;
  email: string;
  personalWorkspaceId: string;
}

let counter = 0;

/** Register a fresh user and return a cookie-carrying supertest agent. */
export async function signUp(app: Express, name = "User"): Promise<TestUser> {
  counter += 1;
  const email = `${name.toLowerCase()}${counter}@example.com`;
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").send({ email, name, password: "password123" });
  if (res.status !== 201) throw new Error(`signUp failed: ${res.status} ${JSON.stringify(res.body)}`);
  const ws = await agent.get("/api/workspaces");
  return { agent, id: res.body.user.id, email, personalWorkspaceId: ws.body.workspaces[0].id };
}

/** Owner invites `member` to `workspaceId` with `role`, and member accepts. */
export async function addMember(owner: TestUser, member: TestUser, workspaceId: string, role: "editor" | "viewer") {
  const inv = await owner.agent
    .post(`/api/workspaces/${workspaceId}/invitations`)
    .send({ email: member.email, role });
  if (inv.status !== 201) throw new Error(`invite failed: ${inv.status} ${JSON.stringify(inv.body)}`);
  const token = inviteToken(inv.body.inviteUrl);
  const acc = await member.agent.post(`/api/invitations/${token}/accept`);
  if (acc.status !== 200) throw new Error(`accept failed: ${acc.status} ${JSON.stringify(acc.body)}`);
}

export async function uploadFile(user: TestUser, workspaceId: string, content = "hello world", filename = "notes.txt") {
  return user.agent
    .post(`/api/workspaces/${workspaceId}/documents`)
    .attach("file", Buffer.from(content), { filename, contentType: "text/plain" });
}

export const inviteToken = (url: string) => url.split("/invite/")[1]!;
export const shareToken = (url: string) => url.split("/s/")[1]!;
