# Rollback

Rollback may mean routing rollback, application rollback, or content rollback.
Choose the smallest action that removes user impact.

## Preconditions

- Identify current and target image digests/commits, schema revision, feature
  flags, and last known-good page revision.
- Confirm the target application can run against the current expanded schema.
- Preserve logs, metrics, failed job payload references, and a UTC timeline.
- Assign separate operators for execution and verification.

## Procedure

1. Apply the [kill switch](kill-switch.md) appropriate to the incident.
2. Stop the scheduler from claiming new work; allow safe in-flight transactions
   to finish or expire.
3. For routing-only rollback, disable the approved builder route and verify
   legacy receives the original URI.
4. For application rollback, deploy the previously verified immutable frontend
   and backend image digests.
5. Do not run a down migration automatically. Expand/contract changes should
   leave the old application compatible. Run a reverse migration only when it
   was explicitly authored, data-loss reviewed, and restore-tested.
6. For content rollback, publish a known-good immutable revision through the
   audited API. Do not rewrite or delete revision history.
7. Restore the scheduler and features gradually only after read-path
   verification.

## Verify

- Health/readiness pass for every instance.
- Authentication and authorization deny and allow expected principals.
- Known public URLs render the expected revision with correct canonical URLs.
- Drafts and media remain intact.
- Queue depth and oldest-job age stabilize without duplicate publications.
- Error rate, latency, database connections, and legacy metrics return to
  baseline.

If schema or data is incompatible with the target release, keep mutation
disabled and follow [backup and restore](backup-restore.md) in an isolated
environment before changing production data.
