# Construktor Page Builder frontend

A Vite 8 + React administration app for composing and publishing normalized page documents. Routes are relative to `VITE_BASE_PATH`: the integrated editor is `/page-builder/admin/builder`, login is `/page-builder/login`, and published pages stay beneath `/page-builder/` (the `/p/:slug` compatibility route remains available inside that prefix).

## Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

Demo mode is opt-in for local development only. Set `VITE_DEMO_MODE=true` while running the Vite development server to use browser-backed data. Production builds always use the backend even if that variable is accidentally set.

## Environment

- `VITE_API_URL` — API prefix or absolute base URL (default `/api/v1`)
- `VITE_BASE_PATH` — normalized Vite and BrowserRouter mount path (default `/`;
  use `/page-builder/` behind the legacy-first gateway)
- `VITE_DEMO_MODE` — explicitly set `true` for local demo mode (ignored in production)
- `VITE_DEV_API_TARGET` — Vite development proxy target (default `http://localhost:8000`)

The remote adapter implements the backend `/api/v1` contract: cookie or bearer auth with one refresh retry, CSRF headers, sites/pages/drafts, page locks, review and publishing workflows, revisions/restore/rollback, preview tokens, assets/renditions, templates, forms/submissions, redirects, audit, settings, folders, presets, and the server block registry. Draft saves send `{baseVersion, document}`; lock conflicts and optimistic-version conflicts are handled separately.

## Architecture

- `src/registry` is the source of truth for block labels, defaults, inspector schemas, interactivity, and nesting.
- `src/store` is a normalized Zustand store (`byId`, `rootOrder`, `childrenByParent`) using Immer patches. It keeps up to 50 patch or full-snapshot history entries.
- `src/editor` contains the four-region workspace, dnd-kit sorting/nesting, Tiptap inline text, inspector, autosave, device iframe messaging, SEO, revision, and publishing UI.
- `src/renderer` is the public rendering boundary. Its route and interactive blocks are lazy chunks. Rich/custom HTML is sanitized with DOMPurify.
- `src/styles/public.css` is fully scoped beneath `[data-pb-root]`; design tokens use the `--pb-*` namespace and CSS layers.

The exact first-wave registry is implemented (excluding optional MIS): Section, Container, Columns, Spacer, Divider, Heading, Text, Quote, Image, Gallery, Video, File, Button, CTA, Card, Feature List, Accordion, Tabs, Table, List, Form, Embed, Safe HTML, Map, FAQ, Breadcrumbs, and Page List. Hero, Stats, Testimonials, Pricing, Navigation, Footer, and compatibility aliases are also available.

### Editor shortcuts

- `Ctrl/⌘ + S` — save now
- `Ctrl/⌘ + Z` — undo
- `Ctrl/⌘ + Shift + Z` or `Ctrl/⌘ + Y` — redo
- `Ctrl/⌘ + D` — duplicate selected block
- `Alt + Arrow Up/Down` — move selected block
- `Delete` / `Backspace` — remove selected block
- `Escape` — clear selection

Dragging works with pointer and keyboard sensors. Drop in a container’s outlined child area to nest; invalid ancestry, non-container parents, repeated Columns nesting, and depth over five are rejected. The inspector’s parent selector is the keyboard-accessible nesting alternative.

## Verification

```bash
npm test
npm run build
npm run lint
npx playwright install chromium
npm run test:e2e
```

Vitest and Testing Library cover normalized history, registry and API contracts, roles, locks, sanitization, rendering, and accessible interaction. Playwright uses local demo mode at `/page-builder/` by default. For a real deployment set `E2E_BASE_URL`, optionally override `E2E_BASE_PATH`, and provide either `E2E_EMAIL`/`E2E_PASSWORD` or `E2E_ACCESS_TOKEN`.

## Container

```bash
docker build \
  --build-arg VITE_API_URL=/api/page-builder/v1 \
  --build-arg VITE_BASE_PATH=/page-builder/ \
  -t construktor-frontend .
docker run --rm -p 8080:80 construktor-frontend
```

The runtime Nginx configuration serves the bundle and SPA fallback only under
the selected build-time base path.
