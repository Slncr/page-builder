# Security incident

Use the organization's incident-response process first. This runbook adds
Page Builder containment points; it is not a substitute for legal, privacy, or
forensic procedures.

## Examples

Treat suspected authorization bypass, secret/token exposure, malicious media,
unexpected admin/publish activity, cross-tenant access, data exfiltration, or
dependency compromise as a security incident.

## Contain

1. Notify the security incident lead through the private channel and record a
   UTC timeline.
2. Preserve logs, audit events, image digests, configuration, database/object
   snapshots, request IDs, and affected principal/resource IDs with controlled
   access.
3. Apply the [kill switch](kill-switch.md). Stop implicated adapters, uploads,
   batch publication, and scheduler.
4. Revoke affected sessions/tokens and rotate exposed credentials from a clean
   environment. Rotate downstream credentials as well.
5. Quarantine suspicious media or workloads without destroying evidence.
6. Block known indicators at the narrowest reliable boundary.

Do not announce details publicly, delete evidence, run unreviewed cleanup, or
place secrets/personal data in chat and issue trackers.

## Investigate and eradicate

Determine entry point, affected identities/resources/tenants, first/last known
activity, persistence, and downstream effects. Compare audit events with
identity-provider, gateway, database, Redis, object-store, CI, and deployment
logs.

Patch the root cause, rebuild from trusted sources, review dependency and image
provenance, invalidate caches/signed URLs, and reconcile publication/media
state. Add a regression test for the failed control.

## Recover

Restore into a clean environment if integrity is uncertain. Validate
authentication, server-side authorization, tenant boundaries, CSRF/CORS,
upload controls, audit completeness, and denied-path logging. Re-enable one
capability at a time with security approval and enhanced monitoring.

Complete required notifications, credential-owner follow-up, data-subject
assessment, and a blameless post-incident review. Track every corrective action
to an owner and deadline.
