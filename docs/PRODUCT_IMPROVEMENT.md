# Product Improvement: Workspace Activity Log (audit trail) — built

## What it is
Every workspace has an **Activity** tab showing who did what, and when:

- Documents uploaded and deleted
- Share links created and revoked, and **every download through a share link**
- Members invited, joined, removed, left, role changes; invitations revoked
- Workspace created and renamed

Each share link also shows its own **download count** and **last-accessed time** in the Share dialog.

## Why this one
The riskiest thing this product lets people do is **send a company document to someone outside the team**. The first questions a real user asks afterwards are:

- *"Did they actually open it?"* → share-link download count and activity entries.
- *"Who shared this, and is the link still live?"* → the Share dialog lists every link with creator, expiry and status, and revoke is one click.
- *"Where did that file go?"* → the log shows who deleted it and when (editors can delete only their own uploads, owners anything; see DECISIONS §3).

Versioning, folders and search are nice. Accountability for external sharing is what makes a small team comfortable putting sensitive documents in the tool at all. It also has the best value-to-complexity ratio: one append-only table and one write per action.

## Design
- **Table:** `activity_events (id, workspace_id → cascade, actor_id → set null, action, details jsonb, created_at)`, indexed on `(workspace_id, created_at)`.
- **No foreign key to documents on purpose:** events must outlive the documents they describe, so the relevant names are copied into `details`.
- **Written in the same transaction** as the change it records (`recordActivity(tx, …)`), so the log can't disagree with reality. For example, a failed upload leaves no "uploaded" event.
- **Anonymous actor:** share-link downloads have `actor_id = NULL` and show as "Someone". IP addresses and user agents are **not** stored, to avoid collecting personal data about external recipients.
- **Visibility:** all workspace members, since it's the same information they could mostly see anyway. It's scoped per workspace by the same `requireRole` check as everything else.

## Limits / next steps
- Only the latest 100 events, with no filters. Next: pagination, filtering by document or person, and CSV export.
- Notifications ("email me when my shared link is downloaded") would build naturally on this table.
- Retention policy: events currently live as long as the workspace does.
