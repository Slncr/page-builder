# ADR 0002: Legacy-first routing and explicit opt-in

- Status: Accepted for local integration
- Date: 2026-08-12

## Context

The legacy site's deployment topology and path ownership are not available in
this repository. Making the Page Builder a default or automatic fallback could
route unrelated production traffic into an unproven service.

## Decision

Keep legacy as the default upstream. Route only approved, explicit namespaces
to the Page Builder, protected by a gateway route flag and application feature
flags.

Resolve upstream hostnames at request time so an absent host does not prevent
the gateway from starting. If legacy cannot be resolved or reached, return a
clear `503`; never fail over legacy traffic to the Page Builder. Disabling the
builder route returns its namespaces to legacy for the same URI.

`infra/nginx/page-builder.conf.template` implements the policy through an
opt-in Compose profile. Only the gateway joins the external `site_default`
network and resolves `site-frontend-1` through Docker DNS. The local route map
owns `/page-builder/` and `/api/page-builder/v1/`; production rollout still
requires legacy-owner approval for authentication, headers, timeouts, cache,
and capacity.

## Consequences

Rollout and rollback have a narrow routing blast radius. The Page Builder
cannot silently replace legacy pages, and legacy availability remains visible
rather than being masked by an unsafe fallback.

Path prefixes may require application base-path support or an intentional
rewrite. That behavior must be integration-tested before enabling the route.

## Rejected alternatives

- **Page Builder as the default upstream:** too broad for incremental rollout.
- **Static unresolved upstream blocks:** can prevent nginx from starting.
- **Automatic fallback from legacy to Page Builder:** risks serving incorrect
  content and hiding a legacy outage.
