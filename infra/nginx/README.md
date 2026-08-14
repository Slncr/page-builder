# Legacy-first gateway

`page-builder.conf.template` is mounted by the opt-in `gateway` Compose profile.
The gateway joins the Page Builder bridge plus one external legacy-origin
network; no other Page Builder service joins that external network.

Policy:

- `/api/page-builder/v1` (and descendants) plus `/page-builder/` may reach the new services only
  when `PAGE_BUILDER_ROUTE_ENABLED=1`.
- `/api/page-builder/v1/*` is explicitly rewritten to backend `/api/v1/*`;
  the UI prefix is preserved.
- `/page-builder` redirects to `/page-builder/` only while the route is enabled.
- Vite assets and HMR stay beneath `/page-builder/`; root `/assets` remains
  legacy-owned.
- All other paths go to the configured legacy origin.
- Disabling the route sends the two opt-in namespaces back to legacy.
- A missing or unhealthy legacy origin returns `503`; it never fails over to
  the page builder.
- Variable-based upstreams use Docker DNS at request time, so an unresolved
  legacy hostname does not prevent nginx from starting.

Render only the template placeholders, preserving nginx's own `$variables`:

```bash
export LEGACY_UPSTREAM_HOST=legacy.internal
export LEGACY_UPSTREAM_PORT=80
export PAGE_BUILDER_ROUTE_ENABLED=0
envsubst '${LEGACY_UPSTREAM_HOST} ${LEGACY_UPSTREAM_PORT} ${PAGE_BUILDER_ROUTE_ENABLED}' \
  < infra/nginx/page-builder.conf.template > /tmp/page-builder.conf
```

Run the isolated route test (it creates and removes temporary containers and a
temporary Docker network):

```bash
make gateway-test
```

For the selected local integration, set:

```dotenv
LEGACY_DOCKER_NETWORK=site_default
LEGACY_UPSTREAM_HOST=site-frontend-1
LEGACY_UPSTREAM_PORT=80
PAGE_BUILDER_ROUTE_ENABLED=1
VITE_BASE_PATH=/page-builder/
VITE_API_URL=/api/page-builder/v1
PB_PUBLIC_ASSET_BASE_URL=/api/page-builder/v1/public/assets
```

Then `make up-gateway` starts the profile. The external network is referenced
only by `gateway`, so ordinary `make config` and `make up` do not require the
legacy site to exist. Do not replace the upstream hostname with a container IP;
Docker DNS resolves the stable container name on `site_default`.
