# Docshare: File Storage & Sharing

A small full-stack app where a team can **upload documents**, organise them in **shared workspaces** with roles, **invite colleagues** (even ones without an account yet), and **share a single document with an outsider via a link**. Every sensitive action lands in a per-workspace **activity log**.

**Stack:** TypeScript · Express 5 (API) · React 19 + Vite (web) · PostgreSQL 16 + Drizzle ORM (schema and SQL migrations) · MinIO (S3-compatible blob storage) · Vitest + Supertest

---

## Run it (under 5 minutes)

Requirements: Docker with Compose.

```bash
cp .env.example .env
docker compose up --build
```

Open **http://localhost:8080** and create an account.

| What | URL |
|---|---|
| Web app | http://localhost:8080 |
| API (direct) | http://localhost:3000/api/health |
| MinIO console (debug only, bound to 127.0.0.1) | http://localhost:9001 (minioadmin / minioadmin) |

Migrations run automatically when the API container starts.

**Try the full flow:** sign up as Alice → create a workspace → upload a file → **Share** → open the link in a private window (no login needed) → **Members** → invite `bob@example.com` as viewer → open the invite link in another browser → create Bob's account → accept → notice Bob sees no Upload/Share/Delete → back as Alice, check **Activity**.

### Local development (hot reload)

```bash
npm install
docker compose up -d postgres minio minio-init   # infrastructure only
npm run dev:api                                   # http://localhost:3000
npm run dev:web                                   # http://localhost:8080 (proxies /api to :3000)
```

### Tests

```bash
docker compose up -d postgres   # tests use a separate `filestore_test` database, created on first start
npm test
```

38 API tests. They use a real Postgres with an in-memory blob store, and they concentrate on the things that would be embarrassing to get wrong: cross-user access, role enforcement (including editors deleting only their own files), share-link revocation and expiry, invitation misuse, the last-owner rule, blob cleanup, and upload limits.

### Changing the schema

Edit `apps/api/src/db/schema.ts`, then:

```bash
npm run db:generate -- --name <what_changed>   # writes a SQL migration to apps/api/drizzle/
```

The API applies it on next start (or run `npm run db:migrate`).

---

## Architecture

```
Browser ──► nginx (web container, :8080)
              ├─ /            static React build (SPA)
              └─ /api/*  ──►  Express API (:3000)
                                ├─ middleware: logging, helmet, CORS, JSON, cookies, rate limit, authenticate
                                ├─ routers (thin: validate input with zod, call a service, send JSON)
                                ├─ services (business rules + authorization via requireRole)
                                │     ├─► Postgres (Drizzle)       users, sessions, workspaces, members,
                                │     │                             invitations, documents, share_links, activity
                                │     └─► ObjectStorage interface ─► MinIO / S3   (never exposed to the browser)
                                └─ error handler (one place maps errors to HTTP responses)
```

- **One origin.** nginx serves the UI and proxies `/api`, so the session cookie is first-party and there's no CORS in normal use.
- **Storage is behind an interface** (`storage/storage.ts`) with an S3 implementation (MinIO locally, any S3 in prod) and an in-memory one for tests. Services never import the AWS SDK.
- **Authorization lives in one function**, `requireRole(workspaceId, userId, minimumRole)`. Every service that touches workspace data goes through it, including flat routes like `/documents/:id`, which first load the document and then check the caller's role in *its* workspace.
- **Blobs are streamed through the API** after that check. There are no pre-signed or public bucket URLs.

```
apps/api/src/
  server.ts              startup: config → migrations → db + storage → createApp → listen
  app.ts                 middleware, routers, error handler
  config/env.ts          zod-validated environment (the only reader of process.env)
  db/                    schema.ts, client.ts, migrate.ts
  storage/               ObjectStorage interface, s3 + memory implementations
  auth/                  password hashing (argon2id), sessions (create/resolve/destroy, cookie)
  middleware/            authenticate/requireAuth, upload (multer), error handler
  lib/                   tokens, typed errors, param validation, download streaming, logger
  modules/
    auth/                register, login, logout, me
    workspaces/          access.ts (roles), workspaces CRUD, members
    invitations/         create/list/revoke, public preview, accept
    documents/           list, upload, download, delete
    shares/              create/list/revoke links, public info + download
    activity/            record + list audit events
apps/api/drizzle/        generated SQL migrations
apps/api/test/           vitest + supertest
apps/web/src/            React: pages/, pages/workspace/ (tabs + share dialog), components/, api/, lib/
```

### API

| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/register` · `/api/auth/login` · `/api/auth/logout` | public |
| GET | `/api/auth/me` | signed in |
| GET, POST | `/api/workspaces` | signed in |
| GET | `/api/workspaces/:id` (includes your role and `permissions`) | member |
| PATCH, DELETE | `/api/workspaces/:id` | owner |
| GET | `/api/workspaces/:id/members` · `/activity` · `/documents` | member |
| PATCH, DELETE | `/api/workspaces/:id/members/:userId` | owner (or yourself, to leave) |
| GET, POST | `/api/workspaces/:id/invitations` | owner |
| DELETE | `/api/workspaces/:id/invitations/:invitationId` | owner |
| POST | `/api/workspaces/:id/documents` (multipart field `file`) | editor+ |
| GET | `/api/documents/:id/download` | member |
| DELETE | `/api/documents/:id` | editor+ |
| GET, POST | `/api/documents/:id/shares` | editor+ |
| DELETE | `/api/shares/:id` | editor+ |
| GET | `/api/invitations/:token` | public (preview) |
| POST | `/api/invitations/:token/accept` | signed in, email must match |
| GET | `/api/s/:token` · `/api/s/:token/download` | public (anyone with the link) |

---

## Assumptions and decisions

The full list, with reasoning and trade-offs, is in **[docs/DECISIONS.md](docs/DECISIONS.md)**. The short version:

- **Every document belongs to a workspace**; everyone gets a *Personal* workspace on sign-up. One model and one permission check cover "my files" and "team files."
- **Roles:** viewer (read and download) < editor (+ upload, share, delete **their own** uploads) < owner (+ delete anything, members, rename/delete). Ownership is granted only by promotion, never by invite. A workspace always keeps at least one owner.
- **Invitations are by email** and work for people with no account. They're **single-use, expire in 7 days, are revocable, and only the invited email can accept them.** No email is sent; the owner copies the link.
- **Share links** give anonymous, read-only access to **one** document. They use 256-bit tokens, stored hashed, and are **shown once**. They default to a 7-day expiry, are revocable, die with the document, and count downloads.
- **Deletes are hard deletes.** The DB goes first, then the blob; a failed blob delete is logged as an orphan.
- **Any file type up to 25 MB**, always downloaded as an attachment, never rendered inline.

## Security

**Addressed**
- **Authorization:** one `requireRole` gate, enforced server-side on every request. 404 = doesn't exist, 403 = not a member or role too low. IDs are random UUIDs, so a 403 doesn't help anyone enumerate. Tests cover another user trying every endpoint on someone else's workspace and documents, and an editor trying to delete someone else's file.
- **Unguessable secrets:** session, share and invite tokens are 256-bit random values, and **only SHA-256 hashes are stored**. Token and UUID params are format-checked, so malformed values get 404, not a 500 from a Postgres cast error.
- **Sessions:** `HttpOnly` (no JS access), `SameSite=Lax` (cross-site POST/DELETE requests don't carry it, so CSRF on state-changing endpoints is blocked), scoped to `/api`, `Secure` when `COOKIE_SECURE=true`. Revoked on logout (server-side).
- **Passwords:** Argon2id. Login gives the same error and similar timing for unknown emails and wrong passwords.
- **Storage not exposed:** MinIO is bound to localhost and the bucket is private. There are no public or pre-signed URLs. Storage keys are server-generated UUIDs, so the user's filename never touches a path.
- **Stored-XSS via uploads:** every download is `Content-Disposition: attachment` + `nosniff`.
- **Headers:** helmet (CSP, frame-ancestors, nosniff, etc.). HSTS only when served over HTTPS.
- **Abuse:** global rate limit on `/api`, stricter limits on login/register and on public share endpoints. Upload size is capped (413). JSON bodies are capped at 100 KB.
- **Input validation:** zod on every body. Uniform JSON errors with no stack traces or SQL leaked.
- **Open redirect:** the post-login `?next=` parameter only accepts same-app relative paths.

**Known gaps, left on purpose**
- **Account enumeration via registration** (409 on an existing email). Fixing it properly needs email verification.
- **No email verification or password reset.** Whoever registers an email "owns" it, and invite acceptance trusts that.
- **No virus/malware scanning** of uploads, and no content-type allow-list.
- **Rate limiting is in-memory and per API instance.** Use Redis in a multi-instance deployment.
- **Share links are bearer tokens.** Anyone the recipient forwards the link to can use it until it expires or is revoked. Password-protected links are a natural next step.
- **Secrets in `.env`** are local-dev defaults (MinIO root credentials, DB password). The API uses MinIO root credentials instead of a scoped access key.
- **No CSRF token.** It relies on `SameSite=Lax`, JSON bodies and strict CORS. That's adequate for modern browsers; old browsers without SameSite support aren't covered.
- **Orphaned blobs** are possible if storage is down during a delete. They're logged but not retried (a periodic reconciliation job is the fix).

## Product improvement

**Workspace activity log / audit trail, built.** It covers uploads, deletes, share links created and revoked, **every download through a share link**, and membership changes, plus per-link download counts. It answers the question that matters most once you send a file outside the team: *"did they open it, and who shared it?"* Details and reasoning are in **[docs/PRODUCT_IMPROVEMENT.md](docs/PRODUCT_IMPROVEMENT.md)**.

## Working with the coding agent

See **[docs/AGENT_LOG.md](docs/AGENT_LOG.md)**.

## What I'd do next with more time

1. **Stream uploads straight to S3** (pre-signed multipart), and raise the size limit.
2. **Trash with 30-day restore** instead of hard delete, plus a reconciliation job for orphaned blobs.
3. **Email delivery** for invites, **email verification**, and **password reset**.
4. **Password-protected and download-limited share links**; notify the sharer on first download.
5. **Versioning** (upload a new version of the same document, keeping share links pointing at the latest).
6. **Folders and search** within a workspace; pagination on lists and the activity log.
7. **Virus scanning** (ClamAV sidecar) before a document becomes downloadable.
8. Frontend tests (Playwright E2E in CI), and CI running the API tests against Postgres.

## Ai agent used
Anthropic claude opus