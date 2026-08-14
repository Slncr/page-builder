# Legacy adapter

No legacy site or adapter is integrated by this repository. The nginx template
and `LEGACY_ADAPTER_MODE` define safety boundaries for a future, separately
approved integration.

## Before enabling

Obtain legacy-owner approval for:

- exact route ownership and path-preservation/rewrite behavior;
- identity propagation and server-side authorization;
- request/response schemas, canonical URLs, cache invalidation, and redirects;
- connect/read/total timeouts, retryable operations, circuit breaking, and
  capacity budgets;
- idempotency and reconciliation for every mutation;
- audit fields, correlation IDs, dashboards, alerts, and on-call ownership; and
- kill-switch, rollback, test, and maintenance-window procedures.

Use an API or event contract. Do not access the legacy database directly.

## Triage

Capture both systems' request IDs, original URI/method, adapter mode, gateway
route flag, page/revision, principal, response status, timing, retries, and
deployment versions. Determine whether the failure is routing, DNS/network,
authentication, contract mapping, legacy capacity, or reconciliation.

## Contain

Set `LEGACY_ADAPTER_MODE=disabled` to stop outbound adapter operations. If the
new route is unsafe, set the approved gateway's
`PAGE_BUILDER_ROUTE_ENABLED=0`. The reference policy sends those URIs back to
legacy and leaves all other paths legacy-first.

If legacy DNS or the upstream is unavailable, return `503`. Never send legacy
traffic to Page Builder as an automatic fallback and never enable a default
legacy hostname from `.env.example`.

## Recover

1. Reproduce with sanitized contract fixtures.
2. Correct mapping/configuration with both owners reviewing.
3. Reconcile ambiguous mutations by idempotency key and audit records before
   retrying.
4. Test success, timeout, malformed response, authorization denial, duplicate
   request, partial failure, legacy outage, and kill-switch behavior.
5. Enable in shadow/read-only mode if supported, then a narrow canary.
6. Compare legacy and adapter results and monitor both systems before widening.
