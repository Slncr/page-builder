# Administrator guide

## Access and configuration

Grant the least capability needed and review publisher/admin access regularly.
Identity mapping and authorization must be enforced by the backend. Never use a
shared admin account or place an admin token in frontend configuration.

Runtime controls:

- `FEATURE_PAGE_BUILDER` gates application access.
- `FEATURE_SCHEDULER` gates due-publication processing.
- `FEATURE_MEDIA_UPLOADS` gates new uploads, not reads of existing media.
- `FEATURE_BATCH_PUBLISH` gates bulk publication.
- `LEGACY_ADAPTER_MODE` should remain `disabled` until its contract is tested.
- `PAGE_BUILDER_ROUTE_ENABLED` belongs to the reference gateway deployment and
  is independent of application flags.

Treat environment changes as reviewed deployment changes. Record actor, UTC
time, old/new value, reason, and rollback owner.

## Rollout

1. Restore a production-like backup into an isolated environment.
2. Apply migrations and verify the previous and new versions against the
   expanded schema.
3. Enable internal editing with public routing still disabled.
4. Exercise preview, media, publication, rollback, audit, and recovery.
5. Enable a narrow approved route or audience and monitor error, latency,
   scheduler, queue, database, and legacy metrics.
6. Increase exposure only after an observation window meets written criteria.

## Routine operations

- Review failed/stale publication jobs and scheduler lag.
- Confirm object-store capacity, rejected uploads, and orphan cleanup.
- Check database growth, slow queries, connection saturation, and backup age.
- Review Redis memory/eviction and queue age; Redis is not the source of truth.
- Audit privileged access and denied authorization attempts.
- Test restore and rollback on a fixed schedule.

Do not manually mark a job successful or edit publication rows without an
approved, audited repair procedure.

## Incident entry points

- Disable traffic or mutation: [kill switch](runbooks/kill-switch.md)
- Return to a known-good release: [rollback](runbooks/rollback.md)
- Recover data: [backup and restore](runbooks/backup-restore.md)
- Diagnose delayed publications: [scheduler](runbooks/scheduler.md)
- Diagnose uploads: [media](runbooks/media.md)
- Handle suspected compromise: [security](runbooks/security.md)
- Disable legacy interaction: [legacy adapter](runbooks/legacy-adapter.md)

For every incident, preserve request IDs, deployment/version, feature-flag
state, logs, metrics, and a UTC timeline before cleanup removes evidence.
