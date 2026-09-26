# Assumptions & Decisions

The brief leaves these open on purpose. For each: **what I chose**, **why**, and **what it costs**.

---

## 1. Accounts & authentication

| Decision | Why | Cost / trade-off |
|---|---|---|
| Email + password accounts. Passwords hashed with **Argon2id**. | Self-contained; no external IdP needed to run locally. Argon2id is the current OWASP recommendation. | No SSO, no password reset (would need email delivery). |
| **Server-side sessions** in Postgres, referenced by a random 256-bit token in an `HttpOnly; SameSite=Lax; Path=/api` cookie. Only `SHA-256(token)` is stored. | Logout and "remove this person" take effect immediately (you can't revoke a JWT without building a denylist anyway). HttpOnly keeps the token away from any XSS. Hashing means a DB dump can't be replayed as live sessions. | One DB lookup per request (indexed primary key — cheap at this scale). |
| Sessions last 7 days (`SESSION_TTL_HOURS`). No sliding renewal. | Simple and predictable. | Users sign in weekly. |
| Emails are normalised to lower-case and are the account identity. | Invitations are addressed by email, so email must be a stable, comparable key. | — |
| Registering with an existing email returns **409 "already exists"**. | Honest UX. | This reveals whether an email has an account (enumeration). Login does **not** leak it: unknown email and wrong password return the same 401 and take similar time (dummy hash verify). A production system would move to email-verified sign-up to close this. |

## 2. Workspaces & ownership

- **Every document lives in exactly one workspace.** On sign-up each user gets a **"Personal"** workspace they own.
  *Why:* the brief's first need ("upload a document and keep it somewhere safe") and third need (team workspaces) then share one model, one permission check and one code path. There is no separate "my files" concept to keep consistent.
  *Cost:* moving a document between workspaces isn't supported (it would be re-upload today).
- Anyone signed in can create more workspaces and becomes their **owner**.

## 3. Roles and what each can do

Three fixed roles, checked in exactly one place (`modules/workspaces/access.ts → requireRole`):

| | viewer | editor | owner |
|---|:-:|:-:|:-:|
| See documents, members, activity; download | ✅ | ✅ | ✅ |
| Upload documents | | ✅ | ✅ |
| Delete documents **they uploaded** | | ✅ | ✅ |
| Delete **any** document in the workspace | | | ✅ |
| Create / revoke share links | | ✅ | ✅ |
| Invite, remove members, change roles | | | ✅ |
| Rename / delete the workspace | | | ✅ |

- **Editors can delete only their own uploads; owners can delete anything.** Deletion is permanent (§6), so the blast radius of one editor's mistake, or one compromised editor account, should be limited to their own files, not the whole team's. Owners can still clean up anything, including files left behind by someone who has left, so nothing gets "stuck." The UI mirrors this per row (the Delete button only appears where the server would allow it), but the server check is the one that counts.
- **Viewers cannot create share links.** "View-only" must not quietly mean "can publish to the internet." Sharing outside the team is the most sensitive action in the product, so it needs at least editor.
- **Ownership is only granted by promotion, never by invite.** Invites can be editor or viewer. Making someone an owner is a deliberate second step on someone who is already a member. A leaked or forwarded invite link can never hand over full control of a workspace.
- **Multiple owners are allowed**, and a workspace must always have **at least one owner**: the last owner can't leave or demote themselves (they must promote someone or delete the workspace). This is checked inside a transaction with the owner rows locked (`SELECT … FOR UPDATE`), so two concurrent demotions can't both succeed.
- **Status codes: 404 = doesn't exist, 403 = exists but you can't.** An outsider requesting a real workspace or document gets **403 "You are not a member of this workspace"**. A member with too low a role gets **403 "Requires editor role"**. Something that doesn't exist gets 404.
  - *Why not return 404 to outsiders to hide existence?* That pattern matters when IDs are guessable (sequential integers, slugs). Here every ID is a random UUIDv4 (122 bits), so there's nothing to enumerate, and confirming that one exists leaks nothing useful. In return, users following a stale or wrong link get an honest message ("ask an owner to invite you") instead of a misleading "not found", and errors are easier to debug.
  - The trade-off is written down on purpose: if IDs ever became guessable, this should switch back to 404.
  - Share and invite **tokens** are different: those are bearer secrets, so unknown, expired and revoked tokens all return the same 404 (§4, §5).

## 4. Invitations

- Invites are addressed to an **email address**, not a user, so **people without an account can be invited**.
- **No email is sent.** Creating an invite returns a one-time link that the owner copies and sends through whatever channel they use (Slack, email). Wiring up SMTP adds infrastructure and secrets for little evaluation value; the `inviteUrl` is exactly what an email would contain.
- **Flow for someone without an account:** open link → landing page shows workspace, inviter and role → "Create account" with the email prefilled → redirected back → Accept. For an existing user: sign in → Accept.
- **The accepting account's email must match the invited email.** A forwarded or leaked link can't be used by someone else. If you're signed in as the wrong account, the page says so and offers to switch.
- Invites are **single-use**, **expire after 7 days** (`INVITE_TTL_DAYS`) and are **revocable**. Re-inviting the same email **replaces** the previous link (enforced by a partial unique index: one pending invite per workspace+email).
- You can invite as **editor or viewer only**. Ownership is granted by promoting an existing member, which is a deliberate second step for the most powerful role.
- Unknown, expired, revoked and used tokens all return the same 404, so there's nothing to probe.

## 5. Share links (sharing with people outside the team)

- A link grants **read-only access to one document**: its name, size and type, and a download. Nothing else: not the workspace, not other files, not who shared it.
- **Anyone with the link** can use it, no account needed. That's what "send them a link" means for an outsider.
- **Who can create:** editors and owners (see §3).
- **Unguessable:** 32 random bytes (256 bits), base64url. **Only the SHA-256 is stored**, which means:
  - A database leak doesn't hand out working links.
  - The full URL is **shown once**, at creation. The UI says so and has a Copy button. Need it again? Create a new link. This is the same trade-off as API keys on GitHub or AWS.
- **Expiry:** 1 day, **7 days (default)**, 30 days, or never. A default expiry means forgotten links don't stay live forever.
- **Revocable** at any time. **Deleting the document kills all its links** (FK cascade).
- Each link shows a **download count and last-accessed time**, and every download is written to the activity log.
- Invalid, expired, revoked and deleted-document tokens all look identical (404, "invalid or has expired").
- Public endpoints are rate-limited per IP.

## 6. Deletion

| What | Behaviour | Why |
|---|---|---|
| Document | **Hard delete.** DB row (and its share links via cascade) deleted in a transaction, then the blob is deleted from storage. | "Delete" should mean the file is gone, especially for something that was shared externally. A trash/restore feature is listed under "next". |
| Order of operations | DB first, blob second. If the blob delete fails, it's logged as an orphan. | An orphaned blob is invisible and harmless. The reverse order could leave a row pointing at a missing file, which is a user-visible broken download. |
| Upload failure | Blob is written first, then the row. If the insert fails, the blob is deleted. | Never a row without a file. |
| Workspace | Owner only, with a type-the-name confirmation. Cascades to members, invites, documents, share links and activity; then all blobs are deleted. | Clean, complete removal. |
| Member removed / leaves | Loses access immediately. **Their uploads stay** in the workspace. | Documents belong to the team, not the individual. `uploaded_by` becomes NULL only if the user account itself is deleted. |
| Activity events | Kept when documents are deleted (names are copied into the event). Deleted with the workspace. | An audit trail must outlive what it describes. |

## 7. Files

- **Size limit 25 MB** (`MAX_UPLOAD_BYTES`), enforced by multer (→ 413) and checked in the browser first for a friendly message. nginx allows 30 MB.
- **Any file type is accepted.** The team's documents could be PDFs, spreadsheets, images or zips, and allow-listing types would mostly create support tickets. Instead the risk of hostile content is handled at download time (below).
- **Downloads are always `Content-Disposition: attachment`** with `X-Content-Type-Options: nosniff`, so an uploaded `.html` or `.svg` is downloaded, never rendered on our origin (which would be stored XSS).
- **Filenames:** kept for display only, with path components and control characters stripped and length capped. The storage key is always a server-generated `workspaces/<id>/<uuid>`, so a filename can never influence a storage path. Download headers use RFC 5987 (`filename*=UTF-8''…`) so non-ASCII names like "Résumé.pdf" survive.
- **Uploads are buffered in memory** (multer memory storage) and then written to storage. At a 25 MB limit that's fine and keeps the code simple. For bigger files I'd stream directly to S3 with a custom multer storage engine or pre-signed multipart uploads.
- **Considered and rejected: presigned (direct-to-storage) uploads.** The browser would ask the API for a short-lived presigned POST (signed with the storage key, content type and a `content-length-range` ≤ 25 MB), upload straight to MinIO, then call `/complete` so the API can verify the object and mark the document ready. That takes upload bytes off the API entirely and is how I'd scale to large files. I didn't do it here because it **exposes the storage endpoint to browsers** (MinIO must be publicly reachable with CORS, plus a separate public endpoint for signing). It also adds a pending state, verification and cleanup of abandoned uploads. At a 25 MB limit, "storage is never reachable from outside" is the better trade.
- **Downloads stream through the API.** The browser never sees MinIO: MinIO isn't exposed publicly and there are no pre-signed URLs. Every download passes an authorization check.

## 8. API shape & code structure

- REST + JSON under `/api`. Errors are always `{ "error": { "code", "message" } }`.
- Nested routes where there's a clear parent (`/workspaces/:id/documents`), flat routes where the ID is globally unique (`/documents/:id`, `/shares/:id`). The service always re-derives the workspace from the resource, so a flat route can't skip the membership check.
- **Routers are thin; services hold the rules.** Services don't import Express, and routers don't import Drizzle or the storage SDK. Storage is an interface (`ObjectStorage`) with S3 and in-memory implementations.
- The UI renders buttons from a `permissions` object the API returns, but **every action is re-checked on the server**. The UI hiding a button is a convenience, not security.

## 9. Things I deliberately did not build

- Email delivery (invites are links), password reset, email verification.
- Folders, versioning, search, virus scanning (see "What I'd do next" in the README).
- Pagination: lists are small at this scale; the activity log is capped at 100 rows.
