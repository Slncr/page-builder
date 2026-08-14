# Contributing

Keep changes small, reviewable, and within the ownership boundary of the
component you are changing.

Before opening a pull request:

1. Update tests, API/schema artifacts, feature-flag documentation, and runbooks
   affected by the behavior.
2. Run `make config`, `make lint`, `make test`, and `make build`.
3. Run `make migration-check` for model or schema changes.
4. Run Playwright/axe for user-visible changes and the relevant approved k6
   smoke scenario for performance-sensitive changes.
5. Review logs, fixtures, screenshots, and generated artifacts for secrets or
   personal data.

Database migrations use expand/migrate/contract and must preserve rollback
compatibility. API writes must be authorized, idempotent when retryable, and
safe under concurrent updates.

Describe risk, rollout flags, migration impact, observability, and rollback in
the pull request template. Report vulnerabilities privately according to
[SECURITY.md](SECURITY.md).
