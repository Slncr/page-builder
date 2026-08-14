# Backup and restore

Recovery requires PostgreSQL data and the corresponding object-store objects.
Redis is disposable and is rebuilt from source-of-truth state. Define and test
production RPO/RTO before launch; this repository does not choose them.

## Backup

Record the application image digest, schema revision, UTC snapshot time,
feature flags, bucket/versioning state, and encryption key references.

For local development, create a logical PostgreSQL backup:

```bash
make backup
```

In production:

1. Use managed PostgreSQL snapshots/PITR plus encrypted, access-controlled
   logical exports where required.
2. Enable object versioning and replication or create an immutable inventory
   and backup of the media bucket.
3. Verify checksums, retention locks, encryption, and restore credentials.
4. Store backup metadata separately from the workload account.
5. Alert on age, failure, missing objects, and untested recovery points.

Do not treat a database-only snapshot as a complete backup.

## Restore rehearsal

1. Create an isolated network/account with no public route, scheduler, worker,
   email, webhook, CDN purge, or legacy adapter.
2. Select a PostgreSQL recovery point and object-store inventory from a
   compatible time.
3. Restore object versions under the expected immutable keys.
4. Restore PostgreSQL. For the local logical format:

   ```bash
   CONFIRM_RESTORE=yes BACKUP_FILE=backups/<file>.sql make restore
   ```

5. Deploy the recorded application version, then apply only the migrations
   required to reach the target version.
6. Run integrity queries: page/revision relationships, publication pointers,
   job uniqueness, media key/checksum existence, and principal mappings.
7. Run API smoke tests and sample public renders with all outbound effects
   disabled.
8. Measure elapsed time and recovered data age against RTO/RPO.

## Production recovery

Require incident approval and a written cutover/backout plan. Fence writes,
take a final forensic snapshot when possible, restore into new infrastructure,
validate, then switch traffic. Keep the prior environment read-only until the
recovery is accepted.

Rotate any credentials exposed during the incident and record missing or
reconciled operations after the recovery point.
