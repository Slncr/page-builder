import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

async function remoteApi(apiRoot = '/api/v1') {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', apiRoot);
  vi.stubEnv('VITE_DEMO_MODE', 'false');
  return (await import('./client.js')).api;
}

describe('remote API backend contract', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    sessionStorage.clear();
    document.cookie = 'csrf_token=; Max-Age=0; path=/';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses auth endpoints and unwraps the login user', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      accessToken: 'token',
      user: { id: 'user-id', email: 'editor@example.com', displayName: 'Editor' },
    }));
    const api = await remoteApi();
    const user = await api.session.login({ email: 'editor@example.com', password: 'password' });

    expect(user.id).toBe('user-id');
    expect(fetch).toHaveBeenCalledWith('/api/v1/auth/login', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ email: 'editor@example.com', password: 'password' }),
    }));
  });

  it('maps page list query names and adapts wrapped page details', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'one' }], total: 1, page: 1, pageSize: 20 }))
      .mockResolvedValueOnce(jsonResponse({
        page: { id: 'one', siteId: 'site', title: 'One', slug: 'one', status: 'draft' },
        routePath: '/one',
        draft: {
          version: 3,
          updatedAt: '2026-08-12T10:00:00Z',
          document: { schemaVersion: '1.0', pageMeta: {}, blocks: [] },
        },
      }));
    const api = await remoteApi();

    const list = await api.pages.list({ search: 'hello world', status: 'draft' });
    const page = await api.pages.get('one');

    expect(list.items).toHaveLength(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/pages?q=hello+world&status=draft');
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/pages/one');
    expect(page).toMatchObject({ id: 'one', routePath: '/one', version: 3 });
  });

  it('patches draft and metadata with CSRF and exact payloads', async () => {
    document.cookie = 'csrf_token=csrf-value; path=/';
    fetch
      .mockResolvedValueOnce(jsonResponse({
        pageId: 'page-id',
        version: 5,
        updatedAt: '2026-08-12T10:00:00Z',
        document: { schemaVersion: '1.0', pageMeta: {}, blocks: [] },
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'page-id',
        siteId: 'site-id',
        title: 'Updated',
        slug: 'updated',
        draftVersion: 5,
      }));
    const api = await remoteApi();
    await api.pages.save('page-id', {
      baseVersion: 4,
      page: {
        id: 'page-id',
        title: 'Updated',
        slug: 'updated',
        seo: {},
        content: { byId: {}, rootOrder: [], childrenByParent: {} },
      },
    });

    const [draftUrl, draftOptions] = fetch.mock.calls[0];
    expect(draftUrl).toBe('/api/v1/pages/page-id/draft');
    expect(draftOptions).toMatchObject({
      method: 'PATCH',
      headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-value' }),
    });
    expect(JSON.parse(draftOptions.body)).toMatchObject({
      baseVersion: 4,
      document: {
        schemaVersion: '1.0',
        layout: {
          shell: 'auto',
          showPageTitle: false,
          breadcrumbs: 'auto',
        },
        blocks: [],
      },
    });
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/pages/page-id');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      title: 'Updated',
      slug: 'updated',
      routePath: '/updated',
      contentType: 'generic',
      sectionKey: null,
      listingMeta: {
        excerpt: '',
        coverAssetId: null,
        publishedDisplayAt: null,
        authorName: '',
        authorTitle: '',
        sortOrder: 0,
        featured: false,
        hiddenFromLists: false,
        menuLabel: '',
      },
    });
  });

  it('creates typed pages with listing metadata and canonical route', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      id: 'page-id',
      siteId: 'site-id',
      title: 'Launch',
      slug: 'launch',
      draftVersion: 1,
    }, 201));
    const api = await remoteApi();

    const page = await api.pages.create({
      siteId: 'site-id',
      title: 'Launch',
      slug: 'launch',
      contentType: 'news',
      sectionKey: 'news',
      listingMeta: {
        excerpt: 'Details',
        featured: true,
      },
      content: { byId: {}, rootOrder: [], childrenByParent: {} },
    });

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/pages');
    expect(body).toMatchObject({
      siteId: 'site-id',
      title: 'Launch',
      slug: 'launch',
      routePath: '/about/news/launch',
      contentType: 'news',
      sectionKey: 'news',
      listingMeta: {
        excerpt: 'Details',
        featured: true,
        hiddenFromLists: false,
      },
      document: {
        layout: {
          shell: 'auto',
          showPageTitle: false,
          breadcrumbs: 'auto',
        },
      },
    });
    expect(page).toMatchObject({
      contentType: 'news',
      routePath: '/about/news/launch',
    });
  });

  it('uses by-path public fetch and multipart asset uploads', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({
        page: { id: 'page-id', title: 'Public', slug: 'public', path: '/public' },
        revisionId: 'revision',
        document: { schemaVersion: '1.0', pageMeta: {}, blocks: [] },
      }))
      .mockResolvedValueOnce(jsonResponse({ id: 'asset-id', filename: 'image.png' }, 201));
    const api = await remoteApi();

    const publicPage = await api.pages.getPublic('public');
    const form = new FormData();
    form.set('siteId', 'site-id');
    form.set('file', new File(['png'], 'image.png', { type: 'image/png' }));
    await api.resources.create('media', form);

    expect(fetch.mock.calls[0][0]).toBe('/api/v1/public/pages/by-path?path=%2Fpublic');
    expect(publicPage.layout).toEqual({
      shell: 'auto',
      showPageTitle: false,
      breadcrumbs: 'auto',
    });
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/assets');
    expect(fetch.mock.calls[1][1].body).toBe(form);
    expect(fetch.mock.calls[1][1].headers['Content-Type']).toBeUndefined();
  });

  it('loads the public content feed with camelCase filters', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      items: [{
        id: 'news-id',
        title: 'Launch',
        slug: 'launch',
        contentType: 'news',
        sectionKey: 'news',
        listingMeta: { excerpt: 'Details', featured: true },
      }],
      total: 1,
    }));
    const api = await remoteApi();

    const feed = await api.pages.listPublic({
      contentType: 'news',
      sectionKey: 'news',
      limit: 6,
    });

    expect(fetch.mock.calls[0][0]).toBe(
      '/api/v1/public/pages?contentType=news&sectionKey=news&limit=6',
    );
    expect(feed.items[0]).toMatchObject({
      contentType: 'news',
      sectionKey: 'news',
      listingMeta: { excerpt: 'Details', featured: true },
    });
  });

  it('surfaces nested backend validation messages', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      error: {
        code: 'validation_error',
        message: 'Request validation failed',
        details: [{ message: 'siteId is required' }],
      },
    }, 422));
    const api = await remoteApi();

    await expect(api.pages.list()).rejects.toThrow(
      'Request validation failed: siteId is required',
    );
  });

  it('refreshes a cookie session once after a 401 and retries', async () => {
    document.cookie = 'csrf_token=refresh-csrf; path=/';
    fetch
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'invalid_token', message: 'Expired' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 'user-id' } }))
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0, page: 1, pageSize: 20 }));
    const api = await remoteApi();

    await expect(api.pages.list()).resolves.toMatchObject({ items: [] });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/pages?',
      '/api/v1/auth/refresh',
      '/api/v1/pages?',
    ]);
    expect(fetch.mock.calls[1][1].headers['X-CSRF-Token']).toBe('refresh-csrf');
  });

  it('uses distinct lock, validation, review, and release endpoints', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ locked: true, isOwner: true, readOnly: false }))
      .mockResolvedValueOnce(jsonResponse({ valid: false, issues: [{ path: 'blocks', message: 'Missing H1' }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'page-id', status: 'in_review' }))
      .mockResolvedValueOnce(jsonResponse({ locked: false, readOnly: false }));
    const api = await remoteApi();

    await api.pages.lock('page-id', true);
    await api.pages.validate('page-id');
    await api.pages.submitReview('page-id', 'Ready');
    await api.pages.unlock('page-id', true);

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/pages/page-id/lock',
      '/api/v1/pages/page-id/validate',
      '/api/v1/pages/page-id/review',
      '/api/v1/pages/page-id/lock?force=true',
    ]);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ force: true });
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ comment: 'Ready' });
  });

  it('exposes schedule, rollback, preview, duplicate, and trash contracts', async () => {
    fetch.mockImplementation(() => Promise.resolve(jsonResponse({
      id: 'result',
      previewUrl: '/api/v1/preview/pages/page',
    })));
    const api = await remoteApi();

    await api.pages.schedule('page', { runAt: '2026-08-20T09:00:00Z', baseVersion: 3 });
    await api.pages.rollback('page', 'revision', { baseVersion: 3 });
    await api.pages.previewToken('page');
    await api.pages.duplicate('page');
    await api.pages.trash('page');

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/pages/page/schedule',
      '/api/v1/pages/page/rollback/revision',
      '/api/v1/pages/page/preview-token',
      '/api/v1/pages/page/duplicate',
      '/api/v1/pages/page?permanent=false',
    ]);
  });

  it('maps backend preview URLs into the browser gateway namespace', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      token: 'preview-token',
      previewUrl: '/api/v1/preview/pages/page?token=preview-token',
      expiresAt: '2026-08-12T12:00:00Z',
    }));
    const api = await remoteApi('/api/page-builder/v1');

    const preview = await api.pages.previewToken('page');

    expect(fetch.mock.calls[0][0]).toBe('/api/page-builder/v1/pages/page/preview-token');
    expect(preview.previewUrl).toBe(
      '/api/page-builder/v1/preview/pages/page?token=preview-token',
    );
  });

  it('supports scoped resources and asset maintenance endpoints', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'asset', altText: 'Updated' }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ status: 'queued' }, 202))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = await remoteApi();

    await api.resources.list('media', { siteId: 'site', pageSize: 100 });
    await api.resources.update('media', 'asset', { altText: 'Updated' });
    await api.resources.renditions('asset');
    await api.resources.queueRenditions('asset');
    await api.resources.remove('media', 'asset');

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/assets?siteId=site&pageSize=100',
      '/api/v1/assets/asset',
      '/api/v1/assets/asset/renditions',
      '/api/v1/assets/asset/renditions',
      '/api/v1/assets/asset',
    ]);
  });

  it('reuses cached public content after an ETag 304', async () => {
    fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        page: { id: 'page', title: 'Cached', path: '/cached' },
        revisionId: 'revision',
        document: { schemaVersion: '1.0', pageMeta: {}, blocks: [] },
      }), { status: 200, headers: { 'Content-Type': 'application/json', ETag: '"rev-1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const api = await remoteApi();

    const first = await api.pages.getPublic('/cached');
    const second = await api.pages.getPublic('/cached');

    expect(second).toEqual(first);
    expect(fetch.mock.calls[1][1].headers['If-None-Match']).toBe('"rev-1"');
  });
});
