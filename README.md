# Page Builder

Greenfield Page Builder scaffolding for an independently deployable frontend,
API, persistence layer, media store, and optional background processes.

This repository combines separately owned frontend/backend implementations
with the infrastructure and delivery contract. Compose probes backend readiness
at `/health/ready` and liveness remains available at `/health/live`.

## Local stack

Prerequisites: Docker with Compose v2, Make, and Node.js 22 for browser tests.

```bash
cp .env.example .env
# Replace every change-me value; enable only the features you are testing.
make config
make up
```

Core endpoints:

- Integrated gateway (opt-in profile): `http://localhost:18081`
- Page Builder through gateway: `http://localhost:18081/page-builder/`
- Page Builder API through gateway: `http://localhost:18081/api/page-builder/v1/`
- Frontend direct: `http://localhost:15173/page-builder/` with the local
  integration `.env` (`/` with `.env.example`)
- Backend API: `http://localhost:18080`
- PostgreSQL: `localhost:25432` inside the stack as `postgres:5432`
- Redis: `localhost:26379` inside the stack as `redis:6379`
- MinIO API: `http://localhost:29000`
- MinIO console: `http://localhost:29001`

Override any occupied host port in `.env`; container-to-container addresses and
ports remain unchanged.

The stack is single-language by default: backend behavior and the frontend
bundle both use Russian (`ru`). Keep `PB_DEFAULT_LOCALE=ru` and
`VITE_DEFAULT_LOCALE=ru` aligned; these defaults do not enable multilingual
content or a runtime language switcher.

Compose runs Alembic through a one-shot `migrate` service before the API,
scheduler, or worker can start. Scheduled publishing and media/webhook jobs run
in dedicated processes:

```bash
make up-scheduler
```

The environment template sets every rollout control off. The local `.env`
selects `site-frontend-1:80` on external network `site_default`, enables
the route, and mounts the browser application at `/page-builder/`. Start that
integration explicitly:

```bash
make up-gateway
```

Only `gateway` joins the external network. Ordinary `make config` and
`make up` remain independent of the legacy stack because the gateway is in a
Compose profile. The current backend
natively consumes the `PB_*` scheduler and legacy settings; the generic builder,
upload, and batch flags remain an application contract that must be enforced
server-side before rollout.

## Verification

```bash
make lint
make test
make build
make migration-check
make gateway-test
make e2e
make security-audit
make load-public-smoke
```

CI enforces frontend lint/test/build, backend lint/tests with coverage,
migration drift, Compose and nginx configuration, dependency/configuration
security audits, and Playwright/axe checks.

## Documentation

- [User guide](docs/user-guide.md)
- [Administrator guide](docs/admin-guide.md)
- [Developer guide](docs/developer-guide.md)
- [Architecture](docs/architecture.md)
- [API integration contract](docs/api-integration.md)
- [Acceptance checklist](docs/acceptance-checklist.md)
- [Operational runbooks](docs/runbooks/)
- [Load-test safety and scenarios](infra/load/README.md)

Start a rollout with internal users, explicit feature flags, observable
success criteria, and a tested kill switch. Do not route legacy traffic until
the legacy owner has reviewed and tested the adapter and gateway behavior.
