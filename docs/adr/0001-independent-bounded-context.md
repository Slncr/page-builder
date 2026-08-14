# ADR 0001: Independent Page Builder bounded context

- Status: Proposed
- Date: 2026-08-12

## Context

The Page Builder is greenfield, while an existing legacy site may continue to
own most public routes. Coupling the new editor directly to legacy deployment,
database internals, or rendering code would make rollback and ownership
unclear.

## Decision

Build the Page Builder as an independently deployable bounded context with:

- a frontend and versioned backend API;
- its own PostgreSQL schema/database;
- Redis for disposable coordination, cache, and optional queueing;
- S3-compatible object storage for media;
- an optional scheduler process built from the backend image, with no separate
  worker until the backend exposes one; and
- explicit adapters at identity, routing, publication, and legacy boundaries.

No component reads or writes a legacy database directly. Cross-system changes
use documented APIs or events and idempotency keys.

## Consequences

Deployment, scaling, backup, and rollback can be exercised without modifying
the legacy runtime. The cost is additional operational ownership and explicit
contracts for identity, routing, canonical URLs, and publication.

Some data may be duplicated across systems. Ownership and reconciliation rules
must be documented before enabling each adapter.

## Revisit when

Validated traffic, latency, recovery, or compliance requirements show that a
different persistence or deployment boundary is necessary.
