import { eq } from "drizzle-orm";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../../auth/password.js";
import type { AuthUser } from "../../auth/session.js";
import type { Db } from "../../db/client.js";
import { users, workspaceMembers, workspaces } from "../../db/schema.js";
import { conflict, unauthorized } from "../../lib/errors.js";
import { recordActivity } from "../activity/activity.service.js";

export const RegisterInput = z.object({
  email: z.email().max(254).transform((e) => e.trim().toLowerCase()),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export const LoginInput = z.object({
  email: z.string().transform((e) => e.trim().toLowerCase()),
  password: z.string(),
});

/** Registration creates the user AND a personal workspace they own, atomically. */
export async function register(db: Db, input: z.infer<typeof RegisterInput>): Promise<AuthUser> {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (existing) throw conflict("An account with this email already exists");

    const [user] = await tx
      .insert(users)
      .values({ email: input.email, name: input.name, passwordHash })
      .returning({ id: users.id, email: users.email, name: users.name });
    const [ws] = await tx
      .insert(workspaces)
      .values({ name: "Personal", createdBy: user!.id })
      .returning({ id: workspaces.id });
    await tx.insert(workspaceMembers).values({ workspaceId: ws!.id, userId: user!.id, role: "owner" });
    await recordActivity(tx, { workspaceId: ws!.id, actorId: user!.id, action: "workspace.created", details: { name: "Personal" } });
    return user!;
  });
}

// Verifying against a dummy hash when the email is unknown keeps response time similar,
// so login timing doesn't reveal which emails have accounts.
let dummyHash: Promise<string> | undefined;

export async function login(db: Db, input: z.infer<typeof LoginInput>): Promise<AuthUser> {
  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (!user) {
    dummyHash ??= hashPassword("dummy-password-for-timing");
    await verifyPassword(await dummyHash, input.password);
    throw unauthorized("Invalid email or password");
  }
  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) throw unauthorized("Invalid email or password");
  return { id: user.id, email: user.email, name: user.name };
}
