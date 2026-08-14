# End-to-end checks

These tests treat the applications as black boxes; they do not import code from
`frontend/` or `backend/`.

```bash
npm ci
npx playwright install chromium
E2E_FRONTEND_BASE_URL=http://127.0.0.1:5173 \
E2E_API_BASE_URL=http://127.0.0.1:8000 \
npm test
```

Environment variables:

- `E2E_FRONTEND_BASE_URL` — browser origin, default
  `http://127.0.0.1:5173`.
- `E2E_API_BASE_URL` — backend origin, default
  `http://127.0.0.1:8000`.
- `E2E_GATEWAY_BASE_URL` — optional integrated gateway origin. When set, tests
  require `/page-builder` → `/page-builder/` and verify the prefixed UI/API.
- `E2E_PUBLIC_PATH` — public page checked by Playwright and axe, default `/`.
- `E2E_API_HEALTH_PATH` — readiness path, default `/health/ready`.
- `E2E_EDITOR_PATH` — optional editor path; the editor test is skipped when
  unset.
- `E2E_EDITOR_TOKEN` — optional bearer token for the editor test.

The axe gate blocks serious and critical WCAG A/AA findings. Review moderate
findings from the report rather than treating this automated scan as a complete
accessibility audit.
