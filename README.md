<div align="center">

# NEXORA CRM

**A premium, bilingual (Persian / English) full-stack CRM for freelancers, developers, designers, consultants and small businesses.**

Persian is the default language with full **RTL** support; English is a first-class **LTR** alternative — switchable instantly without a page reload.

</div>

---

## ✨ Features

- **Dashboard (Overview)** — real KPIs (contacts, new leads, active deals, open pipeline, won revenue, conversion rate, overdue tasks, follow-ups due today) + 6 live charts + today's priorities, stagnant deals, recent activity and critical radar alerts.
- **Follow-up Radar** (signature feature) — explainable, non-AI business rules that surface neglected leads, stagnant deals, overdue tasks, due follow-ups, high-value deals closing quietly, and records with missing information. Every alert explains *why* (localized in both languages) and offers a direct action. Thresholds are configurable per workspace.
- **Leads** — full lifecycle: create → contact → qualify → convert (transactional conversion into Contact + optional Deal) or disqualify with reason. Search, multi-filters, sorting, pagination, bulk actions, tags, duplicates guard.
- **Contacts & Companies** — CRUD, archiving, company↔contact↔deal relationships, detail tabs (deals / tasks / timeline), custom fields, CSV import/export.
- **Deals & Pipeline (Kanban)** — drag & drop between stages (persisted server-side), stage totals, forecasts (weighted pipeline, win rate, won/lost value), lost-reason capture, stage history, per-pipeline stage management.
- **Tasks & Calendar** — priorities, due dates, assignees, recurrence (daily/weekly/monthly spawns next occurrence on completion), Jalali (Persian) calendar rendering in fa mode, day/week/month views, overdue detection.
- **Activities** — calls, meetings, logged emails (clearly marked as *records*, not sends), notes; per-entity timelines; keeps last-activity freshness for the Radar.
- **Automation** — trigger/condition/action rule engine with fixed, validated building blocks (no arbitrary code execution): create task, add tag, assign, notify, update field, log event. Execution history with success/failure/skip. Time-based triggers (task overdue, deal inactive) run on dashboard visits or manual scan with per-day dedupe.
- **Reports & Insights** — leads / sales / productivity analytics computed from real data, date-range + owner + pipeline filters, CSV export.
- **Global search** (`Ctrl+K`) across leads, contacts, companies, deals, tasks — workspace-scoped.
- **Notifications** — in-app center with unread badge, assignment/automation/system events, idempotent (dedupe keys).
- **CSV import/export** — column mapping, preview with row-level validation errors and duplicate detection, skip-duplicates option, sample templates, formula-injection-safe export.
- **Multi-user workspaces** — registration auto-creates a workspace with a localized default pipeline; workspace switcher; member management (Owner/Admin/Member) enforced on the backend; every query is workspace-scoped (cross-workspace access returns 404/401, never data).
- **Settings** — account (name, password change, language, theme), workspace (currency, timezone, Radar thresholds), members, CRM configuration (pipelines/stages, tags, custom fields), data management (CSV, demo data) and an **About** section.
- **Bilingual UX** — complete fa/en catalogs (~700 keys), instant switching, RTL/LTR logical layout everywhere (sidebar, tables, Kanban, dialogs, charts), locale-aware dates (Jalali via `Intl` in fa), numbers, compact money, relative times. User-entered data is never translated.

## 🧰 Technology Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript 5 |
| UI | Tailwind CSS 4 · shadcn/ui (New York) · lucide-react · Vazirmatn font |
| State | TanStack Query (server) · Zustand (UI/session) · react-hook-form + zod |
| Charts / DnD | Recharts · @dnd-kit |
| i18n | i18next + react-i18next (client-side, no reload) |
| Backend | Next.js Route Handlers under `/api/v1` (REST, JSON, stable error codes) |
| Database | Prisma ORM + SQLite (`db/custom.db`) |
| Auth | scrypt password hashing, DB-backed sessions, HttpOnly SameSite cookies, in-memory login rate limiting |

> **Architecture note:** The original specification suggested React+Vite with a Go/PostgreSQL backend. The build environment provides Next.js + Prisma/SQLite, and the spec allows adapting to the actual environment — so the backend is implemented as Next.js API routes with the same REST contract (`/api/v1/...`), workspace-scoped authorization, transactions for conversion, and stable internal enum keys. SQLite stores JSON-shaped data as strings parsed at the app layer (no Prisma enum/Json on SQLite).

## 🚀 Getting Started

```bash
# 1. Install
bun install        # or npm install

# 2. Database (SQLite — no server needed)
bun run db:push    # creates db/custom.db from prisma/schema.prisma

# 3. Develop
bun run dev        # http://localhost:3000

# 4. Quality checks
bun run lint
bunx tsc --noEmit
bun test tests/    # 56 integration tests (isolated temp SQLite, real handlers)
```

### Demo data (explicit, never overwrites real records)

- In the app: **Settings → Data management → Create sample data**, or from the empty-dashboard CTA.
- Via API: `POST /api/v1/dev/seed` → creates the demo account **demo@nexora.app / nexora-demo** (only if the email is free) with a coherent demo workspace (companies, contacts, leads, deals in every stage, won/lost history, tasks incl. overdue, activities, tags).
- **Demo seeding is disabled in production** (`NODE_ENV=production` → the endpoint returns 404).

## 🧪 Tests

The suite (`bun test tests/`) exercises the REAL route handlers, REAL Prisma queries and REAL SQLite — only `next/headers` is mocked, with per-request contexts so files can run concurrently:

- `tests/auth.test.ts` — registration, login, session restore (Bearer + cookie), expired-session rejection/cleanup, logout, password rotation (kills other sessions), per-account login rate limiting, locale persistence.
- `tests/workspace-isolation.test.ts` — the critical tenant boundary: a second user must get 404/400/401 (never data) for every read/write/link/convert/export of another workspace's records.
- `tests/workflows.test.ts` — lead lifecycle + transactional conversion, deal stage semantics (won/lost close dates, stage history), task recurrence, activity timeline, dashboard KPI math, radar flag/resolve/no-duplicate behavior, automation execution + per-day dedupe, CSV preview/confirm parity + formula-injection protection, custom-field validation.
- `tests/account-security.test.ts` — the credential-handling contract: invitations are admin-only and leak no credentials, existing accounts' passwords are never overwritten by an invite, no unauthenticated password change, demo seeding unreachable in production (404 + zero records created), no password/hash/echo in register/login responses, invite audit-log hygiene, invite rate limiting.

Tests always run against a **fresh temporary database** (`mkdtemp`) — the development/demo database is never touched.

## 🗄️ Production Deployment (Next.js + Prisma + SQLite)

### Environment

Copy `.env.example` → `.env`. `DATABASE_URL` must point to an **absolute path on persistent storage** (e.g. `file:/var/lib/nexora/custom.db`). Never store the production database inside a container's ephemeral layer or a tmpfs mount — SQLite requires a writable directory with reliable fsync semantics (local disk or a network volume that supports file locking; do not use NFS without locking guarantees).

### Build & run

```bash
bun install
bunx prisma migrate deploy   # applies pending migrations (see Migrations)
bun run build                # next build (standalone output) — also type-checks
bun run start                # NODE_ENV=production bun .next/standalone/server.js
```

`next build` runs the TypeScript checker (this repo does NOT ignore build errors). Put the app behind a TLS-terminating reverse proxy (the bundled Caddyfile is an example): session cookies automatically upgrade to `SameSite=None; Secure` when `X-Forwarded-Proto: https` is present, and the proxy's `X-Forwarded-For` is used (last entry, proxy-appended) for rate limiting.

### Migrations (no data loss)

The initial schema is committed as `prisma/migrations/0_init` and marked applied, so `prisma migrate deploy` is the production-safe path from now on:

```bash
bunx prisma migrate dev        # development: create a migration from schema changes
bun run db:migrate:deploy      # production: apply pending migrations (never resets data)
```

`bun run db:push` exists for local prototyping only — it can lose data and must not be used against production.

### SQLite operations

- **Journal mode:** WAL is enabled (better concurrent read/write behavior). The files `custom.db-wal` / `custom.db-shm` next to the database are normal; keep them together with the DB when copying at the filesystem level (prefer the backup command instead).
- **Health:** `GET /api` returns a minimal JSON liveness response (no internals disclosed).
- **Graceful behavior:** if the database is unavailable, API routes return a generic 500 `SERVER_ERROR` (no stack traces); the frontend shows localized error states with retry.

### Backup & restore

```bash
bun run db:backup                      # snapshot into ./backups (VACUUM INTO — safe on a LIVE db)
bun run db:backup --dir /var/backups/nexora --keep 14
bun run db:restore backups/nexora-XXXX.db --target /var/lib/nexora/custom.db
```

- `db:backup` uses SQLite's `VACUUM INTO`: a consistent, compact snapshot that is safe while the app is running, then verifies `PRAGMA integrity_check` + row counts and prunes old snapshots (retention `--keep`, default 10).
- `db:restore` first verifies the backup, and by default restores **non-destructively** to `<target>.restored` for inspection. Overwriting the live file requires `--force --i-know-the-app-is-stopped` (stop the app first); the swap is temp-file + re-verified, and the previous database is kept as `.pre-restore`.
- **Restore was verified end-to-end** on an isolated target (integrity ok, row counts match). Never test recovery against the production file.
- **Schedule:** daily snapshot (cron: `0 2 * * * cd /app && bun run db:backup --dir /var/backups/nexora --keep 14`), plus a manual snapshot before any migration. Copy snapshots off the machine. Restoration procedure: stop app → `db:restore <snapshot> --target <db> --force --i-know-the-app-is-stopped` → verify row counts in the output → start app.
- Backups live outside `public/` and are never served by the web server.

## 📧 Email-Dependent Account Flows — Current Behavior

**No email provider is configured. No email is ever sent — and none is ever claimed to be sent.** Every credential flow therefore works directly, with its exposure documented and enforced by tests (`tests/account-security.test.ts`):

| Flow | Endpoint | Who can call it | What actually happens |
|---|---|---|---|
| Self-registration | `POST /api/v1/auth/register` | Public (rate-limited 8 / 10 min / IP) | Creates the caller's **own** account + workspace. No email involved. |
| Login | `POST /api/v1/auth/login` | Public (rate-limited per IP **and** per account) | Issues an HttpOnly session. No email involved. |
| Password change | `POST /api/v1/auth/password` | Authenticated user only (throttled 10 / 5 min) | Self-service: requires the **current** password, kills all other sessions. |
| Member invitation | `POST /api/v1/workspaces/members` | Workspace **Owner/Admin** only (throttled 30 / 5 min / workspace) | **Administrator-only provisioning** — the admin types a temporary password into the form (the UI labels it “Temporary password” and discloses that email is not configured). The server never generates a credential, the response contains only membership data, and if the email already exists the submitted password is **ignored** (existing accounts are never modified by an invite). The invited user gets an in-app notification only. |
| Password reset by email | — | **Does not exist** | There is no forgot-password endpoint. When no email provider is available, account recovery is a manual, administrator-assisted operation (an Owner/Admin can change a member's access by provisioning per the row above; the UI instructs users to contact their administrator). |
| Demo seeding | `POST /api/v1/dev/seed` | Public in **development** only | Returns **404** when `NODE_ENV=production` (test-enforced: zero accounts/records created). Creates only the well-known demo account. |

Guarantees held for **all** of the above (regression-tested): no `passwordHash`, session token, or submitted password ever appears in an API response or audit-log detail; unauthenticated or unauthorized callers can never provision an account or change another user's password.

### Future email delivery (configuration checklist)

Email flows (real invitations, password reset) must not be enabled until all of the following are true. No provider is assumed and no credentials are predefined — the operator chooses the provider and fills `.env` accordingly (see `.env.example`, email section):

1. **Provider chosen & credentials configured via environment variables** (e.g. `EMAIL_PROVIDER`, `EMAIL_FROM`, provider-specific `EMAIL_*` secrets in `.env` — never in code or git).
2. **Sending domain verified** with the provider (SPF/DKIM) so mail is not delivered as spam.
3. **Token-based flows implemented server-side**: invitations/password-reset links use single-use, hashed, expiring tokens stored in the DB — raw tokens appear only in the email body, never in API responses or logs.
4. **Delivery honestly reported**: the UI/notifications state only what the provider actually accepted/delivered; failures surface as errors, not as “email sent”.
5. **Rate limits extended** to the new public request endpoints (reset-request must be throttled and must not reveal whether an account exists).

## 🔁 Continuous Integration

`.github/workflows/ci.yml` defines a single deterministic quality gate that runs on every push and pull request:

1. `bun install --frozen-lockfile` (bun.lock is the dependency source of truth)
2. `bunx prisma generate`
3. `bun run lint`
4. `bunx tsc --noEmit`
5. `bun test tests/` — full suite against a **throwaway SQLite file** (`/tmp/nexora-ci-test.db`; the test bootstrap additionally creates its own fresh temp database, so CI can never touch a development database)
6. `bun run build` — the production build, with its own throwaway `DATABASE_URL` (no database is created or migrated)

No step uses `continue-on-error` or relaxed compiler/lint flags; failures fail the check and are visible on the commit/PR. CI state: **the workflow is configured but has not yet executed** — this repository has no GitHub remote yet. On the first push to GitHub the run will appear under the Actions tab; treat the first green run as the actual build verification (see Known Limitations).

## 🔐 Authentication & Workspaces

- Register (auto-creates workspace + localized default pipeline), login, logout, session persistence (30 days, sliding), password change (invalidates other sessions).
- Sessions are HttpOnly cookies; tokens are stored hashed (sha256) in the DB; language is a preference, never a credential.
- Roles: **Owner** / **Admin** (configuration, members) / **Member** (records). All authorization is enforced server-side; IDs from other workspaces are indistinguishable from nonexistent ones.
- Member invitations are the documented administrator-only provisioning alternative — see [Email-Dependent Account Flows](#-email-dependent-account-flows--current-behavior).

## 🌍 Localization Architecture

- `src/i18n/locales/{fa,en}.json` — single, consistent key catalog; interpolation via `{{param}}`.
- Radar explanations are templates rendered from structured params (`radar.rules.<KEY>.explanation`) so the same issue renders correctly in both languages.
- Statuses/stages use stable internal keys (`NEW`, `qualification`, …); display labels are translated; user-created labels (custom stages, tags, notes, names) are preserved verbatim.
- fa → `<html lang="fa" dir="rtl">` + Jalali calendar via `Intl.DateTimeFormat("fa-IR")`; en → `ltr` + Gregorian. Preference precedence: explicit local choice → account preference → Persian default; synced to the account when signed in.

## 📁 Project Structure

```
src/
├── app/
│   ├── api/v1/…          # REST backend (auth, workspaces, leads, contacts, companies,
│   │                     #  deals, pipelines, tasks, activities, radar, dashboard,
│   │                     #  reports, automation, notifications, search, csv, …)
│   ├── layout.tsx        # RTL default, Vazirmatn, providers
│   └── page.tsx          # SPA entry: auth gate + shell + view router
├── components/shared/    # DataTable, StatCard, dialogs, filters, badges, states
├── features/             # auth, shell + 12 feature views (dashboard, radar, leads, …)
├── i18n/                 # i18next setup + fa/en catalogs
├── lib/
│   ├── server/           # auth, api helpers, radar engine, automation engine, csv, tags
│   ├── client-api.ts     # typed fetch wrapper (stable error codes)
│   └── format.ts         # locale-aware dates/numbers/money
├── store/                # zustand app store (view router, workspace, locale)
└── types/api.ts          # the API contract shared by backend & frontend
prisma/schema.prisma      # 21 models, workspace-scoped, indexed
```

## 🔒 Security Notes

scrypt + timing-safe verification · HttpOnly/SameSite cookies (env-aware) · hashed session tokens · expired-session cleanup · per-IP **and per-account** rate limiting on login (proxy-appended XFF used, spoof-resistant) · throttled password change **and** member-invitation provisioning · every client-supplied reference (contactId/companyId/dealId/leadId, ownerId/assigneeId, automation targets) is validated against the workspace server-side · zod validation on every mutation · allowlisted sort fields · bounded pagination (max 100/page) · parameterized Prisma queries (no raw SQL) · workspace scoping on every read/write (cross-workspace ids are indistinguishable from nonexistent ones — 404) · CSV formula-injection protection · automation rules run fixed, validated building blocks only (no arbitrary code) with enum-whitelisted field updates · demo seeding disabled in production · SQL query logging disabled outside development · stable machine-readable error codes (no stack traces/internals leaked) · audit log for sensitive actions · **repository hygiene: `.env`, the SQLite database, WAL/SHM files and `backups/` are git-ignored and removed from the git index — CRM data and configuration are never pushed to a remote.**

> **Tested, not just intended:** the workspace-isolation guarantees above are enforced by `tests/workspace-isolation.test.ts`, which makes real cross-workspace requests and asserts exact status codes.

## ⚠️ Known Limitations

- Email delivery is not configured. Member invitations therefore provision accounts directly with an admin-chosen temporary password (documented in the UI, admin-only, test-enforced) and **no password-reset endpoint exists** — see [Email-Dependent Account Flows](#-email-dependent-account-flows--current-behavior) for the full posture and the future-provider checklist.
- Logged emails are records only — no SMTP integration.
- Login rate limiting is in-memory (per process) — sufficient for a single-node deployment; use a shared store if you scale horizontally.
- Attachments/file storage is not implemented (core CRM prioritized per spec).
- Custom-field values are accepted on contact create/update APIs; invalid SELECT/MULTI_SELECT/URL/NUMBER/DATE values are silently dropped (documented lenient behavior), while `required` fields enforce presence. UI management is available in Settings → CRM configuration.
- **Production build gate.** `bun run build` is executed by the CI workflow on every push — check the **Actions** tab for the latest result; a green run is the production-build verification. Type-safety is additionally verified via `tsc --noEmit` (the same checker `next build` runs). Exact commands: [Build & run](#build--run).
- Git history: the published history starts from a single fresh initial commit — `.env` and SQLite database files are git-ignored and have never been part of this repository's history. No credential rotation is required (no secrets were ever stored in `.env`).

## 🗺️ Roadmap

File attachments · email integration (real sends) · saved views UI in all list headers · AI-assisted summaries behind a provider abstraction (opt-in) · WebSocket live collaboration.

## 📸 Screenshots

Not included in this repository (kept out of the public snapshot). Run the app locally (`bun run dev`) to see every module live: dashboard fa/en, Kanban RTL, Radar, Calendar, Reports.

---

**Built by Alireza Rajaee** — [github.com/alirezarajaee](https://github.com/alirezarajaee)

Persian: ساخته‌شده توسط علیرضا رجائی
