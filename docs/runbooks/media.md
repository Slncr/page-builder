# Media

## Triage

Capture the request ID, principal, media/upload ID, object key prefix, UTC time,
size/type/checksum, HTTP status, and application version. Do not copy signed
URLs or credentials into tickets.

Check:

- `FEATURE_MEDIA_UPLOADS` and authorization;
- API limits and reverse-proxy body/time limits;
- object-store health, capacity, credentials, bucket policy, and encryption;
- presigned URL expiry, method, headers, browser clock, and CORS;
- checksum, content-type sniffing, malware/content scan, and finalize status;
- database metadata versus object existence/version; and
- CDN/cache behavior for finalized immutable objects.

## Contain

Set `FEATURE_MEDIA_UPLOADS=false` to stop new uploads while preserving reads of
existing finalized media. Quarantine suspicious keys and revoke exposed signed
URLs/credentials. Do not make the bucket public or bypass scanning to restore
service.

For local development, MinIO is at `http://localhost:9000` and its console at
`http://localhost:9001`; applications inside Compose use `http://minio:9000`.
The `minio-init` one-shot service creates a private bucket.

## Recover

1. Repair credentials, policy, capacity, network, or validation configuration.
2. Verify a small permitted upload, checksum, finalize operation, authorized
   read, and denied unauthorized read.
3. Verify rejected type, oversized body, forged content type, expired signed
   URL, path manipulation, and malicious-content handling.
4. Reconcile database metadata and object inventory with an idempotent,
   reviewed tool. Never delete unknown objects during an incident.
5. Re-enable uploads for a canary audience and monitor errors, latency,
   quarantine, and orphan growth.

Use immutable object keys for finalized content. Orphan cleanup must observe a
retention grace period, active upload leases, object versions, and database
references before deletion.
