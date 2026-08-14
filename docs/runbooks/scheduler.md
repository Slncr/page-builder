# Scheduler and worker

The optional Compose `scheduler` runs the backend image with its lifecycle job
runner enabled. The backend currently exposes no separate worker entrypoint.

## Triage

For late, duplicate, or stuck publications, capture:

- scheduler enabled state, replica count, leader/lock holder, clock offset, and
  last successful scan;
- scheduled-job depth, oldest age, retries/failures, and scheduler activity;
- job ID, page/revision ID, scheduled UTC time, attempts, lease/lock state, and
  last error;
- database/Redis latency, connection saturation, deployment version, and
  recent migrations.

Confirm whether submission is delayed, queueing is delayed, or execution is
failing. Displayed local time must be converted to the stored UTC instant.

## Contain

Set `FEATURE_SCHEDULER=false` and scale the scheduler to zero if it is claiming
incorrect work. Keep job and audit records intact for diagnosis.

Only one logical scheduler may claim a due job. Multiple replicas require
tested leader election or atomic database claiming. Every handler must be
idempotent because delivery is at least once.

## Recover

1. Correct clock, credentials, capacity, locking, or code while mutation is
   disabled.
2. Test one copied failed job in an isolated environment.
3. Re-enable a single scheduler process.
4. Replay jobs through a supported retry path using their existing
   idempotency keys; never duplicate rows manually.
5. Confirm publication pointers, audit events, and external side effects occur
   once.
6. Observe a full scan interval, then scale only while PostgreSQL advisory-lock
   leadership remains verified.

Local startup, after commands are verified:

```bash
FEATURE_SCHEDULER=true make up-scheduler
```

Alert on scheduler lag, oldest queued job, repeated attempts, dead letters,
lease age, and publish completion latency.
