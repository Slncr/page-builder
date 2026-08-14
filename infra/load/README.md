# k6 load-test skeletons

Run these scenarios only in an approved environment with monitoring and a
written stop condition. Defaults align with the current `/api/v1` backend and
remain overridable for deployed gateway paths.

## Public traffic

`public.js` targets 500 requests/second for five minutes by default:

```bash
BASE_URL=https://preview.example.test \
PUBLIC_RPS=500 DURATION=5m \
k6 run infra/load/k6/public.js
```

Use `make load-public-smoke` for the safe one-RPS local check.

## Concurrent editors

The default is 50 editors polling page state. Autosave is off unless explicitly
enabled:

```bash
API_BASE_URL=https://api.preview.example.test \
EDITOR_TOKEN=... EDITOR_PAGE_ID=load-test-page \
EDITOR_VUS=50 DURATION=10m \
k6 run infra/load/k6/editor.js
```

To include compare-and-swap saves of the currently loaded document,
additionally set `EDITOR_AUTOSAVE=1 ALLOW_MUTATIONS=1`. Override
`EDITOR_READ_PATH` and `EDITOR_SAVE_PATH` when testing another API version.

## Media uploads

Uploads are mutating and refuse to start without opt-in:

```bash
API_BASE_URL=https://api.preview.example.test \
EDITOR_TOKEN=... SITE_ID=... ALLOW_MUTATIONS=1 \
UPLOAD_RPS=20 UPLOAD_BYTES=1048576 \
k6 run infra/load/k6/uploads.js
```

The probe creates signature-valid PNG objects. Use a dedicated site/bucket and
delete generated `k6-*` objects after the run.

## Batch publish

The backend exposes per-page validation/publish operations rather than a bulk
endpoint. This scenario submits each configured group with `http.batch`. It
defaults to non-mutating validation:

```bash
API_BASE_URL=https://api.preview.example.test \
ADMIN_TOKEN=... PAGE_IDS=load-1,load-2 \
BATCH_DRY_RUN=1 \
k6 run infra/load/k6/batch-publish.js
```

Set `BATCH_DRY_RUN=0 ALLOW_MUTATIONS=1` only for disposable pages in a
non-production environment. Actual runs create immutable revisions and should
not be repeated against valuable pages. Confirm scheduler job depth, database
locks, error rate, and legacy-site latency before increasing concurrency.

All scenarios attach an `operation` tag and enforce latency/error thresholds.
Archive k6 summaries with the release evidence and record the tested commit,
dataset, environment, and feature-flag state.
