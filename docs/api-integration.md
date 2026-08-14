# API integration notes

This document describes the implemented local gateway contract. Production
identity, ownership, and rollout approval remain separate decisions.

## Origins and paths

- Standalone browser API prefix: `/api/v1`.
- Integrated browser API prefix: `/api/page-builder/v1`, on the same gateway
  origin as `/page-builder/`.
- Internal backend prefix: `/api/v1`.
- Readiness: unauthenticated `GET /health/ready`, returning `200` JSON only when
  the database can serve requests. Liveness is `GET /health/live`.

Nginx rewrites `/api/page-builder/v1/*` to `/api/v1/*`. It does not claim root
`/api`, so legacy API traffic remains on the legacy frontend origin. Public
media URLs use `/api/page-builder/v1/public/assets/*` in the integrated flow.

The frontend adapter uses the backend `/api/v1` contract directly. The gateway
changes only the external prefix; it does not alias individual endpoints.
Backend-generated preview URLs are translated by the browser adapter from the
internal `/api/v1` prefix to the configured browser API prefix.

## HTTP contract

- Use JSON with UTF-8, ISO-8601 UTC timestamps, stable resource identifiers,
  and explicit pagination bounds.
- Accept or generate `X-Request-ID` and return it in errors and logs.
- Use bearer authentication only over TLS. Do not place tokens in query
  strings or browser storage accessible to unrelated origins.
- Mutating retryable requests accept `Idempotency-Key`.
- Revision updates use `If-Match` or an explicit `baseRevision`; stale writes
  return `409` or `412` with the current revision identifier.
- Validation errors return machine-readable field paths and stable error codes.
- Rate-limit responses return `429` and `Retry-After`.

An error body should contain `code`, `message`, `requestId`, and optional
field-level `details`. Do not expose stack traces, SQL, credentials, or object
store internals.

## Proposed resource surface

The minimum resource set is pages, immutable revisions, drafts, publications,
media, and jobs. Candidate operations include:

- list/get/create pages;
- load and autosave an editor draft;
- validate, preview, publish, unpublish, and roll back a revision;
- request an upload, finalize it after checksum/scanning, and delete unused
  media;
- submit and inspect a batch-publish job; and
- inspect publication/job status.

The k6 defaults under `infra/load/k6/` follow the current `/api/v1` draft,
asset, validation, and publish operations. Override their path variables when
testing a gateway or another API version.

## Authorization

Map identity-provider subjects to stable internal principals. Enforce
authorization in the API, never only in frontend controls.

Suggested capabilities are read public content, edit drafts, upload media,
publish, batch publish, administer users/settings, and audit. Prefer explicit
capabilities over assuming role names have identical meaning in the legacy
system.

## Media

Prefer short-lived presigned uploads to object storage for large files. The API
creates an upload intent with size/type constraints, binds it to an owner, and
finalizes only after checksum and malware/content validation. Public URLs refer
to finalized immutable objects, not temporary upload keys.

## Legacy adapter

An adapter must document authentication, timeouts, retries, idempotency,
canonical URL ownership, cache invalidation, error mapping, and reconciliation.
It must be possible to disable outbound calls independently of public routing.
No direct legacy-database access is permitted by the proposed boundary.

## Frontend integration

Only public configuration may use `VITE_*` variables; these values are embedded
in browser assets. Secrets remain server-side. Configure CORS with exact
origins, credentials only when needed, and a minimal method/header allowlist.

Generate a typed client from the committed OpenAPI artifact or verify a
handwritten client with contract tests. CI should fail when an incompatible
schema change is introduced without a version or coordinated consumer update.

## Acceptance evidence

Retain an OpenAPI diff, authorization matrix, error examples, concurrency
conflict test, idempotency test, CORS test, media abuse tests, and a gateway
path-preservation/rewrite test for the release.
