# Developer guide

## Required application interfaces

The infrastructure expects:

- `frontend/Dockerfile` serving on `0.0.0.0:5173`;
- `frontend/package.json` scripts named `lint`, `test`, and `build`;
- `backend/Dockerfile` serving on `0.0.0.0:8000`;
- a backend dependency manifest supported by `infra/ci/backend.sh`;
- JSON readiness at `GET /health/ready`; and
- Alembic (`backend/alembic.ini`) or Django (`backend/manage.py`) migrations.

Defaults assume `npm run dev` for the frontend and
`uvicorn app.main:app` for the backend. Override `FRONTEND_COMMAND` or
`BACKEND_COMMAND` in `.env` when the owning implementation differs.

Compose runs migrations once, then starts three backend roles from the same
image: Uvicorn API, `python -m app.cli.scheduler`, and
`python -m app.cli.worker`. The scheduler uses PostgreSQL advisory-lock
leadership; the worker processes rendition and webhook delivery queues.

## Locale contract

The deployment default is single-language Russian. `PB_DEFAULT_LOCALE=ru` is
provided to every backend role, while `VITE_DEFAULT_LOCALE=ru` is provided to
the frontend build and development-server runtime. Keep both values aligned;
they are defaults, not a multilingual-content or language-switching feature.

Vite replaces `VITE_*` values when it builds the browser bundle. A production
frontend Dockerfile must therefore declare the `VITE_DEFAULT_LOCALE` build
argument and expose it as an environment variable before `npm run build`.
Changing only the environment of the final nginx container does not rewrite
already-built assets. Compose also passes the variable at runtime because its
frontend service runs the Vite development server.

The same build-time rule applies to `VITE_BASE_PATH` and `VITE_API_URL`.
Integrated builds use `/page-builder/` and `/api/page-builder/v1`; standalone
development defaults to `/` and `/api/v1`. `BrowserRouter` consumes Vite's
normalized `BASE_URL`, so links, lazy chunks, iframe previews, and SPA fallback
must all use the same base.

## Local setup

```bash
cp .env.example .env
# Replace placeholders and keep feature flags off until needed.
make config
make up
```

To integrate with the already-running legacy site on `site_default`, use the
local `.env` values and start the opt-in profile with `make up-gateway`. This is
the only command that requires the external network and `site-frontend-1`.

`make up` applies migrations through the one-shot `migrate` service. To verify
migration drift independently:

```bash
./infra/ci/backend.sh migration-check
```

That CI-oriented check upgrades an empty database and detects model/schema
drift.

## Quality gates

```bash
./infra/ci/frontend.sh install
./infra/ci/backend.sh install
make lint
make test
make build
make migration-check
make gateway-test
make e2e-install
make e2e
make config
```

Backend CI requires 80% coverage by default; set a higher
`COVERAGE_MIN` as the suite matures. Coverage percentage does not replace
tests for authorization, concurrency, idempotency, migrations, and failure
recovery.

Playwright reads frontend/API base URLs from environment and runs an axe scan.
Tests requiring editor credentials are opt-in. Load tests live under
`infra/load/` and mutating scenarios require `ALLOW_MUTATIONS=1`.

## Change rules

- Add database changes through expand/migrate/contract migrations.
- Keep the prior release compatible during the rollback window.
- Validate feature flags server-side and define their owner, default, expiry,
  dependencies, and removal issue.
- Make write retries idempotent and use optimistic concurrency for drafts.
- Never persist secrets, bearer tokens, signed URLs, or personal content in
  logs and fixtures.
- Keep API changes backward compatible or introduce a new version.
- Update OpenAPI, integration notes, runbooks, acceptance evidence, and load
  paths with behavior changes.

## Debugging the stack

Use `make ps` for health and `make logs` for correlated service logs. Inside
Compose, connect to `postgres:5432`, `redis:6379`, and `minio:9000`; host tools
use their `localhost` ports. Browser code must use a browser-reachable API URL,
not the Compose-only hostname `backend`: use `/api/v1` for direct Vite access
or `/api/page-builder/v1` on the integrated gateway origin.

If `make config` succeeds but startup fails, verify the application
Dockerfiles, commands, health path, migrations, and image-installed healthcheck
runtime (`node` in the frontend build target and `python` in backend).
