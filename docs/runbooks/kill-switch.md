# Kill switch

Use this runbook for incorrect public routing, unsafe publication, runaway
background work, or a Page Builder security incident. Production commands
depend on the deployment platform; the variables below are the control
contract.

## Contain

1. Declare an incident, record UTC time/version/flags, and assign an incident
   lead.
2. For wrong public routing, set `PAGE_BUILDER_ROUTE_ENABLED=0` and recreate
   only the gateway service. Both Page Builder namespaces then return to the
   legacy upstream with their original request URI.
3. Set `FEATURE_PAGE_BUILDER=false` to reject new builder activity.
4. Set `FEATURE_SCHEDULER=false`, then scale the scheduler to zero if due jobs
   could mutate state.
5. Independently set `FEATURE_BATCH_PUBLISH=false` and
   `FEATURE_MEDIA_UPLOADS=false` when those paths are implicated.
6. Set `LEGACY_ADAPTER_MODE=disabled` to stop outbound legacy interaction.

For suspected data corruption, stop the scheduler and mutating features before
spending time on route changes. Do not delete jobs, revisions, or media during
containment.

## Verify

- Builder-prefixed requests follow the approved disabled behavior.
- New draft, upload, publish, and batch requests are rejected server-side.
- Scheduler lag may increase, but no new jobs start and in-flight jobs settle
  or are explicitly cancelled.
- Legacy traffic does not fail over to the Page Builder.
- API/database/object-store write rates return to the expected baseline.

Capture request IDs and query audit/job state to identify in-flight operations.

## Recover

Identify the last known-good revision and deployment. Follow the
[rollback runbook](rollback.md) if code/schema changed. Repair or reconcile
data with an reviewed, idempotent script and preserve evidence.

Re-enable one control at a time in a canary environment: application read
access, editing, media, scheduler, publishing/batch, then gateway routing.
Observe each stage and document the decision owner.
