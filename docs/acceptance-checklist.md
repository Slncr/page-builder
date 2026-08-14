# Acceptance checklist

Every checked item needs evidence linked from the release record. Mark
non-applicable items with an approver and reason rather than silently deleting
them.

## Build and infrastructure

- [ ] Frontend and backend Dockerfiles build reproducibly from reviewed,
      immutable dependencies.
- [ ] `docker compose --env-file .env.example config --quiet` succeeds.
- [ ] Frontend `:5173`, backend `:8000`, PostgreSQL, Redis, and MinIO become
      healthy on a clean local stack.
- [ ] PostgreSQL, Redis, and MinIO named volumes survive a normal restart.
- [ ] No placeholder secret is accepted outside local development.
- [ ] Core features and gateway route default off.
- [ ] Scheduler profile remains disabled unless command, shutdown, idempotency,
      and advisory-lock leadership are implemented and tested.

## CI and code quality

- [ ] Frontend lint, unit tests, and production build pass.
- [ ] Backend Ruff checks and tests pass at or above the agreed coverage gate.
- [ ] An empty database upgrades to head and migration drift check passes.
- [ ] Compose and rendered nginx configuration validation pass.
- [ ] Dependency, secret, and configuration security audits have no unaccepted
      high/critical findings.
- [ ] Playwright smoke and serious/critical axe gates pass in Chromium.
- [ ] Required branch protection makes these checks blocking.

## Functional behavior

- [ ] Authorized users can create, save, reopen, preview, and publish a draft.
- [ ] Unauthorized users are denied by the backend for every privileged action.
- [ ] Concurrent stale edits produce a recoverable conflict without data loss.
- [ ] Publish retries are idempotent and audit history identifies actor,
      revision, time, and outcome.
- [ ] Public reads expose only the intended published revision.
- [ ] Rollback publishes a known-good immutable revision without deleting
      history.
- [ ] Scheduled publication handles UTC/timezone, retry, duplicate delivery,
      and restart.
- [ ] Batch publish enforces capability, batch bounds, idempotency, partial
      results, and safe retry.

## API and browser integration

- [ ] OpenAPI matches the frontend client and external gateway prefix policy.
- [ ] Path preservation or rewrite is explicitly selected and tested.
- [ ] `/page-builder/` assets, HMR, login, admin, preview iframe, and public
      routes remain inside the frontend base path.
- [ ] `/api/page-builder/v1/*` reaches backend `/api/v1/*`, including public
      media, without claiming legacy `/api` or `/assets`.
- [ ] Errors use stable codes and correlation IDs without sensitive detail.
- [ ] CORS, cookies/tokens, CSRF, CSP, and security headers are reviewed for the
      deployed origins.
- [ ] Health/readiness semantics match Compose and CI probes.
- [ ] Accessibility receives keyboard, focus, zoom/reflow, and screen-reader
      review in addition to axe.

## Media

- [ ] Upload type, size, checksum, ownership, rate, and authorization limits are
      server-enforced.
- [ ] Malware/content scanning and quarantine behavior are tested.
- [ ] Bucket is private; signed URLs are scoped and short-lived.
- [ ] Finalized keys are immutable and orphan cleanup has a safe grace period.
- [ ] Database/object inventory reconciliation and media recovery are tested.

## Performance and reliability

- [ ] Public k6 scenario sustains the approved 500 RPS target with recorded
      latency, error, saturation, commit, data, and flag state.
- [ ] Editor concurrency, upload, and batch-publish scenarios meet approved
      thresholds without corruption or duplicate side effects.
- [ ] Rate limits, backpressure, scheduled-job growth, database pool limits,
      and object store failure are exercised.
- [ ] Dashboards and alerts cover request/job latency and errors, saturation,
      scheduler lag, oldest job, storage, and legacy impact.

## Operations and release

- [ ] Kill-switch behavior is rehearsed and owned.
- [ ] Previous application release runs against the expanded schema.
- [ ] Routing, application, content, and data rollback paths are rehearsed.
- [ ] PostgreSQL plus object-store restore meets approved RPO/RTO in isolation.
- [ ] On-call staff have scheduler, media, security, and legacy-adapter
      runbooks.
- [ ] Retention, privacy, audit, and incident-notification requirements are
      approved.

## Legacy integration

- [ ] Legacy owner approves routes, authentication, headers, timeouts, cache,
      canonical URLs, and capacity budget.
- [ ] All unowned paths remain legacy-first.
- [ ] Disabled builder routes return to legacy as designed.
- [ ] Missing legacy DNS/upstream returns `503` and never fails over to the Page
      Builder.
- [ ] Adapter can be disabled independently and does not access the legacy
      database directly.
