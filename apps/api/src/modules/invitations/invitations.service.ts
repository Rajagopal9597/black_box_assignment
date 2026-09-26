import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import type { AuthUser } from "../../auth/session.js";
import type { Db } from "../../db/client.js";
import { users, workspaceInvitations, workspaceMembers, workspaces } from "../../db/schema.js";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import { generateToken, hashToken } from "../../lib/tokens.js";
import { recordActivity } from "../activity/activity.service.js";
import { getRole, requireRole } from "../workspaces/access.js";

/**
 * Invitations are addressed to an EMAIL, not a user, so people without an account can be invited.
 * Flow: owner creates invite -> gets a link (we don't send email; the owner shares it) ->
 * invitee opens /invite/:token -> signs in or registers WITH THAT EMAIL -> accepts -> becomes member.
 *
 * Rules:
 *  - Only editor/viewer can be invited; ownership is granted by promoting an existing member.
 *  - The accepting account's email must match the invite (a forwarded link can't be used by someone else).
 *  - Single-use, expires after INVITE_TTL_DAYS, revocable. Re-inviting the same email replaces the old invite.
 */
export const CreateInviteInput = z.object({
  email: z.email().transform((e) => e.trim().toLowerCase()),
  role: z.enum(["editor", "viewer"]),
});

const pending = () =>
  and(
    isNull(workspaceInvitations.acceptedAt),
    isNull(workspaceInvitations.revokedAt),
    gt(workspaceInvitations.expiresAt, new Date()),
  );

export async function createInvitation(
  db: Db,
  opts: { workspaceId: string; actorId: string; input: z.infer<typeof CreateInviteInput>; ttlDays: number },
) {
  const { workspaceId, actorId, input, ttlDays } = opts;
  await requireRole(db, workspaceId, actorId, "owner");

  const [existingMember] = await db
    .select({ userId: users.id })
    .from(users)
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
    .where(and(eq(users.email, input.email), eq(workspaceMembers.workspaceId, workspaceId)));
  if (existingMember) throw conflict("That person is already a member of this workspace");

  const token = generateToken();
  const invitation = await db.transaction(async (tx) => {
    // Replace any outstanding invite for this email (also frees the partial unique index).
    await tx
      .update(workspaceInvitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(workspaceInvitations.workspaceId, workspaceId),
          eq(workspaceInvitations.email, input.email),
          isNull(workspaceInvitations.acceptedAt),
          isNull(workspaceInvitations.revokedAt),
        ),
      );
    const [inv] = await tx
      .insert(workspaceInvitations)
      .values({
        workspaceId,
        email: input.email,
        role: input.role,
        tokenHash: hashToken(token),
        invitedBy: actorId,
        expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
      })
      .returning({
        id: workspaceInvitations.id,
        email: workspaceInvitations.email,
        role: workspaceInvitations.role,
        expiresAt: workspaceInvitations.expiresAt,
        createdAt: workspaceInvitations.createdAt,
      });
    await recordActivity(tx, {
      workspaceId,
      actorId,
      action: "member.invited",
      details: { email: input.email, role: input.role },
    });
    return inv!;
  });
  // The raw token exists only in this response; the DB keeps its hash.
  return { invitation, token };
}

export async function listPendingInvitations(db: Db, workspaceId: string, actorId: string) {
  await requireRole(db, workspaceId, actorId, "owner");
  return db
    .select({
      id: workspaceInvitations.id,
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      expiresAt: workspaceInvitations.expiresAt,
      createdAt: workspaceInvitations.createdAt,
      invitedByName: users.name,
    })
    .from(workspaceInvitations)
    .leftJoin(users, eq(users.id, workspaceInvitations.invitedBy))
    .where(and(eq(workspaceInvitations.workspaceId, workspaceId), pending()))
    .orderBy(desc(workspaceInvitations.createdAt));
}

export async function revokeInvitation(db: Db, workspaceId: string, actorId: string, invitationId: string) {
  await requireRole(db, workspaceId, actorId, "owner");
  const [inv] = await db
    .update(workspaceInvitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(workspaceInvitations.id, invitationId),
        eq(workspaceInvitations.workspaceId, workspaceId),
        pending(),
      ),
    )
    .returning({ email: workspaceInvitations.email });
  if (!inv) throw notFound("Invitation not found");
  await recordActivity(db, { workspaceId, actorId, action: "member.invite_revoked", details: { email: inv.email } });
}

/** Public preview for the invite landing page. Unknown, expired, used and revoked all look the same (404). */
export async function previewInvitation(db: Db, token: string) {
  const [inv] = await db
    .select({
      workspaceName: workspaces.name,
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      expiresAt: workspaceInvitations.expiresAt,
      invitedByName: users.name,
    })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
    .leftJoin(users, eq(users.id, workspaceInvitations.invitedBy))
    .where(and(eq(workspaceInvitations.tokenHash, hashToken(token)), pending()))
    .limit(1);
  if (!inv) throw notFound("This invitation is invalid or has expired");
  return inv;
}

export async function acceptInvitation(db: Db, token: string, user: AuthUser) {
  return db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(workspaceInvitations)
      .where(and(eq(workspaceInvitations.tokenHash, hashToken(token)), pending()))
      .for("update"); // two concurrent accepts can't both succeed
    if (!inv) throw notFound("This invitation is invalid or has expired");
    if (inv.email !== user.email) {
      throw forbidden(`This invitation was sent to ${inv.email}. Sign in with that email to accept it.`);
    }

    const alreadyMember = await getRole(tx, inv.workspaceId, user.id);
    if (!alreadyMember) {
      await tx.insert(workspaceMembers).values({ workspaceId: inv.workspaceId, userId: user.id, role: inv.role });
      await recordActivity(tx, {
        workspaceId: inv.workspaceId,
        actorId: user.id,
        action: "member.joined",
        details: { member: user.name, role: inv.role },
      });
    }
    await tx
      .update(workspaceInvitations)
      .set({ acceptedAt: new Date() })
      .where(eq(workspaceInvitations.id, inv.id));
    return { workspaceId: inv.workspaceId };
  });
}
