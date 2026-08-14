# Construktor backend

Async FastAPI backend for the versioned Page Builder. PostgreSQL, Redis, and
MinIO are the production targets; SQLite, an in-process cache, and local object
storage keep development and tests self-contained.

## Run locally

Python 3.12 is required.

```bash
cp .env.example .env
python3.12 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
alembic upgrade head
uvicorn app.main:app --reload
```

For a zero-dependency local smoke run, set:

```dotenv
PB_DATABASE_URL=sqlite+aiosqlite:///./page-builder.sqlite3
PB_AUTO_CREATE_SCHEMA=true
PB_REDIS_URL=
PB_OBJECT_STORAGE=local
```

`PB_AUTO_CREATE_SCHEMA` is intended only for local/tests. Production deploys
must run `alembic upgrade head` as a separate release step.

## Main API

All product endpoints are under `/api/v1`.

- `auth/*`: bootstrap registration, login, refresh rotation, logout, session.
- `sites`, `folders`, `pages`: page metadata and soft deletion.
- `pages/{id}/draft`: optimistic writes using `baseVersion`.
- `pages/{id}/lock`: acquire, inspect, heartbeat, and release expiring edit locks.
- `pages/trash`, `pages/{id}/restore`: explicit 30-day trash lifecycle.
- `pages/{id}/revisions`: immutable snapshots and draft restoration.
- `pages/{id}/preview-token`: short-lived signed access to noindex draft previews.
- `pages/batch/publish`: bounded feature-guarded publishing with per-item results.
- `pages/{id}/review`, `publish`, `schedule`, `unpublish`, `rollback`.
- `public/route`: `builder`, `redirect`, `legacy`, or `not_found` resolution.
- `public/pages/by-path`: immutable published JSON with ETag/cache headers.
- `assets` and `assets/{id}/renditions`: metadata plus generated image variants.
- `legacy/inventory`, `legacy/import`: authenticated, idempotent migration operations.
- `templates`, `presets`, `forms`, `redirects`, `settings`, `audit`.
- `users`: Admin-only listing, role assignment, and activation.
- `builder/registry`: versioned block JSON Schemas and inspector hints.
- `sitemap.xml` and auth-or-token `preview/pages/{id}`.

Operational endpoints are `/health/live`, `/health/ready`, and `/metrics`.
Interactive OpenAPI documentation is at `/api/v1/docs`.

## Security model

Passwords use Argon2id. Login creates short-lived access JWTs and rotating
refresh JWTs. Both are returned for Bearer clients and also set as HttpOnly
cookies. Cookie-authenticated mutating requests require the matching
double-submit value in the `X-CSRF-Token` header. Refresh identifiers are
stored as SHA-256 digests, and reuse revokes the user's token family.

Roles are ordered according to the product permission matrix:

`Viewer < Copywriter < Editor < Publisher < Admin`

Every route enforces its minimum role server-side. Publishing, rollback,
routes, account administration, uploads, and other state changes emit audit
records. The `html` block is registry-restricted to Admin authors and is still
sanitized.

Rich content is allowlist-sanitized by `nh3`. Scripts, event attributes,
styles, unsafe URL schemes, iframes, objects, and embeds are removed. Uploads
have a size cap, extension/MIME allowlist, signature checks, generated object
keys, and are served with `nosniff`.

## Page and publication guarantees

Drafts are mutable only through a compare-and-swap SQL update:

1. A client reads `draftVersion`.
2. It sends that value as `baseVersion`.
3. A concurrent change returns `409` with `currentVersion`.

Editors may also acquire the expiring page lock. Other editors receive a
read-only lock response and draft writes return `page_locked`. Heartbeats
extend the lock; the owner can release it, and Admin may explicitly force
acquire or force release. Optimistic version checks remain authoritative.

Draft writes accept `baseVersion` or `If-Match` (`"draft-12"` and `"12"`).
Publish, schedule, rollback, and every batch item require `expectedVersion`.
Scheduled jobs publish the immutable revision pinned when scheduled even when a
newer draft is saved later.

Draft saves create throttled `autosave` revisions and retain only the configured
newest snapshots. Signed revision previews remain valid; draft preview tokens
reject after the draft version changes. Preview tokens work as a query
parameter or `Authorization: Preview <token>`.

Publish, schedule, rollback, batch publishing, upload, and replacement accept
`Idempotency-Key`. Responses are persisted in the database, survive process
restarts, reject key reuse with a different payload, and expire via cleanup.

Revisions have no update/delete API and ORM guards reject mutation. Publish
sanitizes and validates the document, referenced assets/forms, exactly one H1,
SEO metadata, block versions, nesting, image alt text, and block-specific
constraints. It then creates an immutable revision, switches the active route,
and invalidates public caches in one database transaction. Rollback creates a
new revision from the selected old revision; it never changes old snapshots.

Public routing enforces `legacy`, `builder`, and `fallback_legacy`. Legacy
fallback is used only when a real adapter is configured.
`PB_PUBLIC_READ_FAIL_CLOSED=true` returns a service error when content cannot
be resolved safely. Published documents are detached from drafts and carry
revision-specific ETags.

## Scheduler and worker processes

The lifespan runner handles due publication snapshots and retention cleanup.
With PostgreSQL, only the process holding
`pg_try_advisory_lock(hash("construktor:scheduler"))` runs a cycle; SQLite uses
an in-process lock. Jobs are row-locked, idempotent, retried with backoff, and
record success/failure in the audit log. In a high-scale deployment the same
`JobRunner.run_once()` can be invoked from a dedicated scheduler process while
API workers set `PB_SCHEDULER_ENABLED=false`.

Production can run both loops as separate Compose services:

```bash
pb-scheduler
pb-worker
```

Both commands support `--once` for probes and one-shot jobs. `pb-worker`
normalizes uploaded images, strips EXIF, persists 320/640/1024/1600/2048
renditions in the source format plus WebP and AVIF when Pillow supports those
encoders, and processes queued webhook deliveries. Set `PB_WORKER_ENABLED=true`
only when intentionally running that loop inside the API process.
The API default is `PB_SCHEDULER_ENABLED=false`; `pb-scheduler` is the intended
dedicated scheduler service.

Webhook URLs are opt-in per form (`settings.webhookUrl`) and must use an
allowlisted host. Delivery disables redirects and environment proxies, resolves
and rejects private/reserved addresses, restricts schemes and ports, retries
with backoff, and can attach an HMAC signature.

## Storage and cache fallbacks

`ResilientCache` uses Redis when healthy and falls back to a TTL memory cache.
Rate limits use Redis atomic counters when available. `ResilientObjectStorage`
uses MinIO or local storage and switches to the configured local directory if
MinIO cannot initialize. Readiness reports which fallback is active.

Local fallback is designed for development and graceful degradation, not
shared multi-worker durability.

## Legacy integration

Implement `LegacyImporter` in `app/importer.py` with:

- `inventory()` for migration discovery,
- `import_page(source_id)` for an idempotent conversion adapter,
- `resolve(path, locale)` for legacy-safe routing.

Pass the adapter to `create_app(legacy_importer=...)`. The default null adapter
does not claim legacy availability and never publishes imports automatically.
Admin-only inventory/import endpoints persist source identifiers,
fingerprints, warnings, and diagnostics. Repeated fingerprints are no-ops;
changed sources update the same `imported_draft` page and never auto-publish.

## Content and delivery hardening

Forms, templates, and presets support PATCH and deactivation. Templates and
presets have authenticated no-store previews, and presets are validated against
the block registry schema. Assets support replacement, folders, tags, and
persistent upload idempotency. `PB_MEDIA_ENABLED=false` blocks media
administration while published assets remain readable.

Publish validation requires HTTPS allowlisted hosts for video/embed providers.
Social image requirements apply only when Open Graph sharing is configured.
Sitemaps exclude `noindex` documents and emit `priority` and `changefreq`.

Responses include configurable CSP and request IDs. HTTP requests are logged as
structured JSON. Prometheus exposes publish, upload, scheduler, and worker
counters. Readiness reports and verifies the active Alembic revision.

## Public form anti-spam

`SubmissionCreate` accepts the backward-compatible optional `website`
honeypot and `startedAt` timestamp. A populated honeypot is silently accepted
without storage. To require timing checks, set
`form.settings.antispam.enabled=true`; optionally set
`minimumElapsedSeconds` (the configured default is two seconds). Missing,
too-fast, future, and expired timestamps are rejected when timing enforcement
is enabled.

## Adding a block

Add a `BlockDefinition` to `app/registry.py` with its JSON Schema, current
version, UI metadata, nesting capability, and rich-text sanitizer fields.
Older block versions require an explicit migration before they may be accepted.
Both draft saves and publication run registry validation server-side.

The mandatory first-release registry includes every section 9 block except the
optional MIS block: layout, typography, media, actions, content, forms, embed,
sanitized custom HTML, maps, FAQ, breadcrumbs, and page lists.

## Tests

```bash
pytest -q
ruff check .
```

Tests use a temporary SQLite database and disable the scheduler. Critical
coverage includes authentication/RBAC, CSRF, optimistic draft conflicts, edit
locks, XSS sanitization, publish/public ETags, rollback, signed preview,
legacy and operation idempotency, autosave snapshots, trash restore, anti-spam
checks, provider allowlists, SSRF blocking, and image replacement/renditions.
