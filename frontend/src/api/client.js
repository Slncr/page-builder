import {
  adaptDraftResponse,
  adaptPageDetail,
  adaptPageMetadata,
  adaptPublicPage,
  adaptPublicFeed,
  backendDocumentToNormalized,
  normalizedToBackendDocument,
  pageMetadataToBackend,
} from './adapters.js';
import { canonicalRoutePath, normalizePageLayout } from '../content/pageTypes.js';
import { withBasePath } from '../routing/basePath.js';
import { slugify } from '../utils/slugify.js';

const API_ROOT = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');
const BACKEND_API_ROOT = '/api/v1';
const DEMO_MODE = Boolean(import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE === 'true');
const DEMO_DB_KEY = 'pb-demo-database-v2';
const DEMO_SESSION_KEY = 'pb-demo-session-v1';
const ACCESS_TOKEN_KEY = 'pb-access-token';

let accessToken = typeof sessionStorage === 'undefined'
  ? ''
  : sessionStorage.getItem(ACCESS_TOKEN_KEY) || '';

function browserApiUrl(value) {
  if (typeof value !== 'string' || API_ROOT === BACKEND_API_ROOT) return value;
  if (
    value === BACKEND_API_ROOT
    || value.startsWith(`${BACKEND_API_ROOT}/`)
    || value.startsWith(`${BACKEND_API_ROOT}?`)
  ) {
    return `${API_ROOT}${value.slice(BACKEND_API_ROOT.length)}`;
  }
  return value;
}

function setAccessToken(value = '') {
  accessToken = value;
  if (typeof sessionStorage === 'undefined') return;
  if (value) sessionStorage.setItem(ACCESS_TOKEN_KEY, value);
  else sessionStorage.removeItem(ACCESS_TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

function csrfCookie() {
  return typeof document === 'undefined'
    ? ''
    : document.cookie
      .split('; ')
      .find((entry) => entry.startsWith('csrf_token='))
      ?.split('=')
      .slice(1)
      .join('=');
}

let refreshPromise = null;

async function refreshSession() {
  if (!refreshPromise) {
    const csrfToken = csrfCookie();
    refreshPromise = fetch(`${API_ROOT}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRF-Token': decodeURIComponent(csrfToken) } : {}),
      },
      body: '{}',
    }).then((response) => {
      if (!response.ok) throw new ApiError('Срок действия сеанса истёк.', response.status);
      return response.json();
    }).then((result) => {
      setAccessToken(result.accessToken || '');
      return result;
    }).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function request(path, options = {}) {
  const {
    retry401 = true,
    captureEtag = false,
    ...fetchOptions
  } = options;
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const isForm = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;
  const csrfToken = typeof document === 'undefined'
    ? ''
    : csrfCookie();
  const response = await fetch(`${API_ROOT}${path}`, {
    credentials: 'include',
    ...fetchOptions,
    headers: {
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(fetchOptions.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken
        ? { 'X-CSRF-Token': decodeURIComponent(csrfToken) }
        : {}),
      ...fetchOptions.headers,
    },
    body: fetchOptions.body && typeof fetchOptions.body !== 'string' && !isForm
      ? JSON.stringify(fetchOptions.body)
      : fetchOptions.body,
  });

  if (response.status === 304) return { notModified: true };
  const data = response.status === 204
    ? null
    : await response.json().catch(() => null);

  if (!response.ok) {
    if (
      response.status === 401
      && retry401
      && !path.startsWith('/auth/login')
      && !path.startsWith('/auth/refresh')
      && !path.startsWith('/auth/logout')
    ) {
      await refreshSession();
      return request(path, { ...options, retry401: false });
    }
    const error = data?.error || data;
    const details = error?.details;
    const detailMessages = Array.isArray(details)
      ? details.map((detail) => detail?.message).filter(Boolean)
      : [];
    const message = error?.message || `Не удалось выполнить запрос. Код ответа: ${response.status}`;
    throw new ApiError(
      detailMessages.length ? `${message}: ${detailMessages.join('; ')}` : message,
      response.status,
      {
        ...data,
        ...(error || {}),
        error,
      },
    );
  }
  return captureEtag ? { data, etag: response.headers.get('ETag') } : data;
}

const now = () => new Date().toISOString();

function starterPage() {
  return {
    id: 'welcome',
    title: 'Добро пожаловать',
    slug: 'dobro-pozhalovat',
    routePath: '/dobro-pozhalovat',
    status: 'draft',
    contentType: 'generic',
    sectionKey: '',
    listingMeta: {
      excerpt: 'Страница, собранная в визуальном конструкторе Construktor.',
      coverAssetId: '',
      publishedDisplayAt: '',
      authorName: '',
      authorTitle: '',
      sortOrder: 0,
      featured: false,
      hiddenFromLists: false,
      menuLabel: 'Добро пожаловать',
    },
    locale: 'ru',
    layout: normalizePageLayout(),
    version: 1,
    updatedAt: now(),
    publishedAt: null,
    seo: {
      title: 'Добро пожаловать в Construktor',
      description: 'Страница, собранная в визуальном конструкторе Construktor.',
      socialImage: '',
      noIndex: false,
    },
    content: {
      byId: {
        hero: {
          id: 'hero',
          type: 'hero',
          parentId: null,
          props: {
            eyebrow: 'ВИЗУАЛЬНЫЙ КОНСТРУКТОР СТРАНИЦ',
            title: 'Создавайте продуманные страницы быстрее.',
            body: '<p>Собирайте доступные адаптивные страницы из готовых блоков.</p>',
            primaryLabel: 'Начать',
            primaryHref: '#features',
            secondaryLabel: 'Подробнее',
            secondaryHref: '#details',
            align: 'center',
          },
        },
        features: {
          id: 'features',
          type: 'features',
          parentId: null,
          props: {
            title: 'Всё необходимое',
            items: [
              { title: 'Структурированность', text: 'Нормализованный контент и предсказуемое отображение.' },
              { title: 'Доступность', text: 'Интерактивные компоненты с управлением с клавиатуры.' },
              { title: 'Адаптивность', text: 'Проверяйте макет на основных размерах экрана.' },
            ],
          },
        },
      },
      rootOrder: ['hero', 'features'],
      childrenByParent: { hero: [], features: [] },
    },
  };
}

function readDemoDb() {
  if (typeof localStorage === 'undefined') {
    return { pages: [starterPage()], histories: {}, resources: {} };
  }
  const stored = localStorage.getItem(DEMO_DB_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      localStorage.removeItem(DEMO_DB_KEY);
    }
  }
  const database = { pages: [starterPage()], histories: {}, resources: {} };
  localStorage.setItem(DEMO_DB_KEY, JSON.stringify(database));
  return database;
}

function writeDemoDb(database) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DEMO_DB_KEY, JSON.stringify(database));
  }
}

function copy(value) {
  return value == null ? value : structuredClone(value);
}

function demoUser() {
  if (typeof sessionStorage === 'undefined') return null;
  const value = sessionStorage.getItem(DEMO_SESSION_KEY);
  return value ? JSON.parse(value) : null;
}

const demo = {
  session: {
    async me() {
      return demoUser();
    },
    async login({ login, email, password }) {
      const identifier = login || email;
      if (!identifier || !password) {
        throw new ApiError('Укажите логин и пароль.', 422);
      }
      const user = {
        id: 'demo-admin',
        name: 'Демо-администратор',
        username: identifier.includes('@') ? null : identifier,
        email: identifier.includes('@') ? identifier : 'admin@example.com',
        role: 'Admin',
      };
      sessionStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(user));
      return user;
    },
    async logout() {
      sessionStorage.removeItem(DEMO_SESSION_KEY);
    },
  },
  sites: {
    async list() {
      return [{ id: 'demo-site', slug: 'demo', name: 'Демо-сайт', defaultLocale: 'ru' }];
    },
  },
  pages: {
    async list({
      search = '',
      status = 'all',
      contentType = '',
      sectionKey = '',
    } = {}) {
      const query = search.trim().toLowerCase();
      return copy(readDemoDb().pages
        .filter((page) => status === 'all' || page.status === status)
        .filter((page) => !contentType || page.contentType === contentType)
        .filter((page) => !sectionKey || page.sectionKey === sectionKey)
        .filter((page) => !query
          || page.title.toLowerCase().includes(query)
          || page.slug.toLowerCase().includes(query))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    },
    async get(id) {
      const page = readDemoDb().pages.find((item) => item.id === id);
      if (!page) throw new ApiError('Страница не найдена.', 404);
      return copy(page);
    },
    async getPublic(slug) {
      const page = readDemoDb().pages.find((item) => (
        item.slug === slug
        || item.id === slug
        || item.routePath === slug
        || item.routePath === `/${slug}`
      ));
      if (!page) throw new ApiError('Страница не найдена.', 404);
      return copy(page);
    },
    async listPublic(query = {}) {
      const {
        contentType = '',
        sectionKey = '',
        section = '',
        limit,
        pageSize,
      } = query;
      const resolvedSection = section || sectionKey;
      const resolvedLimit = pageSize ?? limit;
      const items = readDemoDb().pages
        .filter((page) => page.status === 'published')
        .filter((page) => !page.listingMeta?.hiddenFromLists)
        .filter((page) => !contentType || page.contentType === contentType)
        .filter((page) => !resolvedSection || page.sectionKey === resolvedSection)
        .sort((left, right) => (
          Number(left.listingMeta?.sortOrder || 0) - Number(right.listingMeta?.sortOrder || 0)
          || String(right.listingMeta?.publishedDisplayAt || right.publishedAt || '')
            .localeCompare(String(left.listingMeta?.publishedDisplayAt || left.publishedAt || ''))
        ));
      return {
        items: copy(resolvedLimit ? items.slice(0, Number(resolvedLimit)) : items),
        total: items.length,
      };
    },
    async publicFeed(query) {
      return demo.pages.listPublic(query);
    },
    async create(input) {
      const database = readDemoDb();
      const id = crypto.randomUUID();
      const page = {
        id,
        title: input.title || 'Страница без названия',
        slug: slugify(input.slug || input.title || ''),
        routePath: canonicalRoutePath(
          input.contentType,
          slugify(input.slug || input.title || ''),
          input.routePath,
        ),
        status: 'draft',
        contentType: input.contentType || 'generic',
        sectionKey: input.sectionKey || '',
        listingMeta: {
          excerpt: '',
          coverAssetId: '',
          publishedDisplayAt: '',
          authorName: '',
          authorTitle: '',
          sortOrder: 0,
          featured: false,
          hiddenFromLists: false,
          menuLabel: '',
          ...(input.listingMeta || {}),
        },
        locale: input.locale || 'ru',
        layout: normalizePageLayout(input.layout),
        version: 1,
        updatedAt: now(),
        publishedAt: null,
        seo: { title: '', description: '', socialImage: '', noIndex: false },
        content: input.content || { byId: {}, rootOrder: [], childrenByParent: {} },
      };
      database.pages.push(page);
      database.histories[id] = [];
      writeDemoDb(database);
      return copy(page);
    },
    async save(id, payload) {
      const database = readDemoDb();
      const index = database.pages.findIndex((item) => item.id === id);
      if (index < 0) throw new ApiError('Страница не найдена.', 404);
      const current = database.pages[index];
      if (!payload.force && Number(payload.baseVersion) !== Number(current.version)) {
        throw new ApiError('Страница была изменена в другом сеансе.', 409, {
          serverVersion: current.version,
          serverPage: copy(current),
        });
      }
      database.histories[id] ||= [];
      database.histories[id].unshift({
        id: crypto.randomUUID(),
        version: current.version,
        createdAt: now(),
        label: 'Автосохранение',
        page: copy(current),
      });
      database.histories[id] = database.histories[id].slice(0, 30);
      const updated = {
        ...current,
        ...payload.page,
        id,
        version: current.version + 1,
        updatedAt: now(),
      };
      database.pages[index] = updated;
      writeDemoDb(database);
      return copy(updated);
    },
    async publish(id, payload) {
      const database = readDemoDb();
      const index = database.pages.findIndex((item) => item.id === id);
      if (index < 0) throw new ApiError('Страница не найдена.', 404);
      const current = database.pages[index];
      if (payload?.baseVersion && payload.baseVersion !== current.version) {
        throw new ApiError('Сохраните последнюю версию перед публикацией.', 409, {
          serverVersion: current.version,
          serverPage: copy(current),
        });
      }
      const published = {
        ...current,
        status: 'published',
        publishedAt: now(),
        updatedAt: now(),
        version: current.version + 1,
      };
      database.pages[index] = published;
      writeDemoDb(database);
      return copy(published);
    },
    async history(id) {
      return copy(readDemoDb().histories[id] || []);
    },
    async restore(id, historyId) {
      const database = readDemoDb();
      const entry = (database.histories[id] || []).find((item) => item.id === historyId);
      if (!entry) throw new ApiError('Версия не найдена.', 404);
      const index = database.pages.findIndex((item) => item.id === id);
      const restored = {
        ...entry.page,
        version: database.pages[index].version + 1,
        updatedAt: now(),
      };
      database.pages[index] = restored;
      writeDemoDb(database);
      return copy(restored);
    },
    async lock() {
      return { locked: true, isOwner: true, readOnly: false };
    },
    async getLock() {
      return { locked: false, isOwner: false, readOnly: false };
    },
    async heartbeat() {
      return { locked: true, isOwner: true, readOnly: false };
    },
    async unlock() {
      return { locked: false, isOwner: false, readOnly: false };
    },
    async validate() {
      return { valid: true, issues: [] };
    },
    async submitReview(id, comment) {
      return demo.pages.updateStatus(id, 'in_review', { reviewStatus: 'pending', reviewComment: comment });
    },
    async approveReview(id, comment) {
      return demo.pages.updateStatus(id, 'approved', { reviewStatus: 'approved', reviewComment: comment });
    },
    async rejectReview(id, comment) {
      return demo.pages.updateStatus(id, 'draft', { reviewStatus: 'rejected', reviewComment: comment });
    },
    async updateStatus(id, status, extra = {}) {
      const database = readDemoDb();
      const index = database.pages.findIndex((page) => page.id === id);
      if (index < 0) throw new ApiError('Страница не найдена.', 404);
      database.pages[index] = { ...database.pages[index], ...extra, status, updatedAt: now() };
      writeDemoDb(database);
      return copy(database.pages[index]);
    },
    async schedule(id, payload) {
      return demo.pages.updateStatus(id, 'scheduled', { scheduledAt: payload.runAt });
    },
    async unpublish(id) {
      return demo.pages.updateStatus(id, 'draft', { publishedAt: null });
    },
    async rollback(id, revisionId) {
      return demo.pages.restore(id, revisionId);
    },
    async previewToken(id) {
      return {
        token: 'demo-preview',
        previewUrl: withBasePath(`/admin/builder/preview/${id}`),
        expiresAt: now(),
      };
    },
    async duplicate(id) {
      const source = await demo.pages.get(id);
      return demo.pages.create({ ...source, title: `${source.title} (копия)`, slug: `${source.slug}-kopiya` });
    },
    async trash(id) {
      const database = readDemoDb();
      database.pages = database.pages.filter((page) => page.id !== id);
      writeDemoDb(database);
      return null;
    },
  },
  resources: {
    async list(kind) {
      const database = readDemoDb();
      return copy(database.resources[kind] || []);
    },
    async create(kind, value) {
      const database = readDemoDb();
      database.resources[kind] ||= [];
      let normalized = value;
      if (kind === 'media' && value instanceof FormData) {
        const file = value.get('file');
        normalized = {
          name: file?.name || 'Демо-файл',
          url: file ? URL.createObjectURL(file) : '',
          alt: value.get('altText') || '',
        };
      } else if (kind === 'forms') {
        normalized = {
          ...value,
          recipient: value.settings?.recipient || '',
          status: 'active',
        };
      } else if (kind === 'redirects') {
        normalized = {
          ...value,
          from: value.sourcePath,
          to: value.destination,
          code: value.statusCode,
        };
      }
      const item = { id: crypto.randomUUID(), createdAt: now(), ...normalized };
      database.resources[kind].unshift(item);
      writeDemoDb(database);
      return copy(item);
    },
    async update(_kind, _id, value) {
      return copy(value);
    },
    async remove() {
      return null;
    },
    async exportSubmissions() {
      return new Blob(['id,formId,createdAt,status\n'], { type: 'text/csv' });
    },
  },
  registry: {
    async get() {
      return { registryVersion: 'demo', blocks: [] };
    },
  },
};

const publicCache = new Map();

export function normalizePublicFeedQuery(query = {}) {
  const normalized = {};
  if (query.site) normalized.site = query.site;
  if (query.contentType) normalized.contentType = query.contentType;
  const section = query.section ?? query.sectionKey;
  if (section) normalized.section = section;
  const pageSize = query.pageSize ?? query.limit;
  if (pageSize != null && pageSize !== '') normalized.pageSize = pageSize;
  if (query.page) normalized.page = query.page;
  if (query.pathPrefix) normalized.pathPrefix = query.pathPrefix;
  if (query.featured != null && query.featured !== '') normalized.featured = query.featured;
  return normalized;
}

async function requestPublicFeed(query = {}) {
  const params = new URLSearchParams(
    Object.entries(normalizePublicFeedQuery(query)).filter(([, value]) => value !== '' && value != null),
  );
  const suffix = params.toString();
  return adaptPublicFeed(await request(
    `/public/pages${suffix ? `?${suffix}` : ''}`,
    { retry401: false },
  ));
}

const remote = {
  session: {
    me: () => request('/auth/me'),
    login: async (credentials) => {
      const result = await request('/auth/login', { method: 'POST', body: credentials });
      setAccessToken(result.accessToken || '');
      return result.user;
    },
    logout: async () => {
      try {
        await request('/auth/logout', { method: 'POST', body: {} });
      } finally {
        setAccessToken('');
      }
    },
  },
  sites: {
    list: () => request('/sites'),
  },
  pages: {
    list: async (query = {}) => {
      const params = new URLSearchParams();
      if (query.search) params.set('q', query.search);
      if (query.status && query.status !== 'all') params.set('status', query.status);
      if (query.siteId) params.set('siteId', query.siteId);
      if (query.contentType) params.set('contentType', query.contentType);
      if (query.sectionKey) params.set('sectionKey', query.sectionKey);
      if (query.page) params.set('page', query.page);
      if (query.pageSize) params.set('pageSize', query.pageSize);
      const result = await request(`/pages?${params}`);
      const items = (result.items || result).map(adaptPageMetadata);
      return Array.isArray(result) ? items : { ...result, items };
    },
    get: async (id) => adaptPageDetail(await request(`/pages/${encodeURIComponent(id)}`)),
    getPublic: async (path) => {
      const routePath = String(path || '/').startsWith('/') ? String(path || '/') : `/${path}`;
      const cached = publicCache.get(routePath);
      const response = await request(
        `/public/pages/by-path?${new URLSearchParams({ path: routePath })}`,
        {
          headers: cached?.etag ? { 'If-None-Match': cached.etag } : {},
          captureEtag: true,
          retry401: false,
        },
      );
      if (response.notModified && cached) return cached.page;
      const page = adaptPublicPage(response.data);
      publicCache.set(routePath, { page, etag: response.etag });
      return page;
    },
    listPublic: requestPublicFeed,
    publicFeed: requestPublicFeed,
    resolvePublic: (path, site) => request(`/public/resolve?${new URLSearchParams({
      path,
      ...(site ? { site } : {}),
    })}`, { retry401: false }),
    create: async (input) => {
      const document = normalizedToBackendDocument({
        ...input,
        locale: input.locale || 'ru',
        content: input.content,
      });
      const routePath = canonicalRoutePath(input.contentType, input.slug, input.routePath);
      const metadata = pageMetadataToBackend(input);
      const page = await request('/pages', {
        method: 'POST',
        body: {
          siteId: input.siteId,
          folderId: input.folderId || null,
          ...metadata,
          routePath,
          document,
        },
      });
      return {
        ...adaptPageMetadata({ ...input, ...page }),
        ...backendDocumentToNormalized(document),
        routePath,
        version: page.draftVersion || 1,
      };
    },
    save: async (id, payload) => {
      const document = normalizedToBackendDocument(payload.page);
      const draft = await request(`/pages/${encodeURIComponent(id)}/draft`, {
        method: 'PATCH',
        body: { baseVersion: payload.baseVersion, document },
      });
      const metadata = (await request(`/pages/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: pageMetadataToBackend(payload.page),
      })) || {};
      return adaptDraftResponse(draft, {
        ...payload.page,
        ...metadata,
        contentType: metadata.contentType ?? payload.page.contentType,
        sectionKey: metadata.sectionKey ?? payload.page.sectionKey,
        listingMeta: metadata.listingMeta ?? payload.page.listingMeta,
      });
    },
    publish: async (id, payload) => {
      const result = await request(`/pages/${encodeURIComponent(id)}/publish`, {
        method: 'POST',
        body: {
          expectedVersion: payload.baseVersion,
          routePath: payload.routePath || undefined,
          message: payload.message || undefined,
        },
      });
      return {
        ...(payload.page || {}),
        ...result.page,
        version: result.page.draftVersion,
        updatedAt: result.page.updatedAt,
        revision: result.revision,
      };
    },
    history: async (id) => (await request(`/pages/${encodeURIComponent(id)}/revisions`))
      .map((revision) => ({
        ...revision,
        version: revision.number,
        label: revision.message || {
          autosave: 'Автосохранение',
          publish: 'Публикация',
          restore: 'Восстановление',
          rollback: 'Откат',
          scheduled: 'Запланированная публикация',
        }[revision.kind] || 'Сохранённая версия',
      })),
    restore: async (id, revisionId) => {
      const current = await remote.pages.get(id);
      const draft = await request(
        `/pages/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/restore`,
        { method: 'POST', body: { baseVersion: current.version } },
      );
      return adaptPageDetail({
        page: current,
        draft,
        routePath: current.routePath,
      });
    },
    createFromTemplate: (input) => request('/pages/from-template', {
      method: 'POST',
      body: input,
    }),
    lock: (id, force = false) => request(`/pages/${encodeURIComponent(id)}/lock`, {
      method: 'POST',
      body: { force },
    }),
    getLock: (id) => request(`/pages/${encodeURIComponent(id)}/lock`),
    heartbeat: (id) => request(`/pages/${encodeURIComponent(id)}/lock/heartbeat`, {
      method: 'POST',
      body: {},
    }),
    unlock: (id, force = false) => request(
      `/pages/${encodeURIComponent(id)}/lock?${new URLSearchParams({ force })}`,
      { method: 'DELETE' },
    ),
    validate: (id) => request(`/pages/${encodeURIComponent(id)}/validate`, { method: 'POST', body: {} }),
    submitReview: (id, comment = '') => request(`/pages/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      body: { comment },
    }),
    approveReview: (id, comment = '') => request(`/pages/${encodeURIComponent(id)}/review/approve`, {
      method: 'POST',
      body: { comment },
    }),
    rejectReview: (id, comment) => request(`/pages/${encodeURIComponent(id)}/review/reject`, {
      method: 'POST',
      body: { comment },
    }),
    schedule: (id, payload) => request(`/pages/${encodeURIComponent(id)}/schedule`, {
      method: 'POST',
      body: {
        runAt: payload.runAt,
        expectedVersion: payload.baseVersion,
        routePath: payload.routePath || undefined,
        message: payload.message || undefined,
      },
    }),
    unpublish: (id) => request(`/pages/${encodeURIComponent(id)}/unpublish`, {
      method: 'POST',
      body: {},
    }),
    rollback: (id, revisionId, payload) => request(
      `/pages/${encodeURIComponent(id)}/rollback/${encodeURIComponent(revisionId)}`,
      {
        method: 'POST',
        body: {
          expectedVersion: payload.baseVersion,
          routePath: payload.routePath || undefined,
          message: payload.message || undefined,
        },
      },
    ),
    previewToken: async (id) => {
      const preview = await request(`/pages/${encodeURIComponent(id)}/preview-token`, {
        method: 'POST',
        body: {},
      });
      return { ...preview, previewUrl: browserApiUrl(preview.previewUrl) };
    },
    duplicate: (id) => request(`/pages/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
      body: {},
    }),
    trash: (id, permanent = false) => request(
      `/pages/${encodeURIComponent(id)}?${new URLSearchParams({ permanent })}`,
      { method: 'DELETE' },
    ),
  },
  resources: {
    list: async (kind, query = {}) => {
      const path = {
        media: 'assets',
        submissions: 'forms/submissions',
      }[kind] || kind;
      const suffix = new URLSearchParams(
        Object.entries(query).filter(([, value]) => value !== '' && value != null),
      ).toString();
      const result = await request(`/${path}${suffix ? `?${suffix}` : ''}`);
      const items = result.items || result;
      if (kind === 'media') {
        return {
          ...result,
          items: items.map((asset) => ({
            ...asset,
            name: asset.filename,
            alt: asset.altText,
            url: `${API_ROOT}/public/assets/${asset.id}`,
          })),
        };
      }
      if (kind === 'redirects') {
        return items.map((item) => ({
          ...item,
          from: item.sourcePath,
          to: item.destination,
          code: item.statusCode,
        }));
      }
      if (kind === 'forms') {
        return items.map((item) => ({
          ...item,
          recipient: item.settings?.recipient || '',
          status: item.isActive ? 'active' : 'inactive',
        }));
      }
      return result;
    },
    create: (kind, value) => {
      if (kind === 'media') {
        return request('/assets', { method: 'POST', body: value });
      }
      if (kind === 'settings') {
        return request('/settings', { method: 'PUT', body: value });
      }
      return request(`/${encodeURIComponent(kind)}`, { method: 'POST', body: value });
    },
    update: (kind, id, value) => request(
      `/${kind === 'media' ? 'assets' : encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: value },
    ),
    remove: (kind, id) => request(
      `/${kind === 'media' ? 'assets' : encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),
    renditions: (assetId) => request(`/assets/${encodeURIComponent(assetId)}/renditions`),
    queueRenditions: (assetId) => request(`/assets/${encodeURIComponent(assetId)}/renditions`, {
      method: 'POST',
      body: {},
    }),
    exportSubmissions: async (formId) => {
      const query = formId ? `?${new URLSearchParams({ formId })}` : '';
      const response = await fetch(`${API_ROOT}/forms/submissions/export${query}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new ApiError('Не удалось экспортировать ответы.', response.status);
      return response.blob();
    },
  },
  registry: {
    get: () => request('/builder/registry'),
  },
  folders: {
    list: (siteId) => request(`/folders?${new URLSearchParams({ siteId })}`),
    create: (value) => request('/folders', { method: 'POST', body: value }),
    remove: (id) => request(`/folders/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  presets: {
    list: (siteId) => request(`/presets?${new URLSearchParams({ siteId })}`),
    create: (value) => request('/presets', { method: 'POST', body: value }),
  },
  submissions: {
    list: (query = {}) => request(`/forms/submissions?${new URLSearchParams(query)}`),
    export: (formId) => remote.resources.exportSubmissions(formId),
  },
  assets: {
    get: (id) => request(`/assets/${encodeURIComponent(id)}`),
    patch: (id, value) => request(`/assets/${encodeURIComponent(id)}`, { method: 'PATCH', body: value }),
    remove: (id) => request(`/assets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    renditions: (id) => request(`/assets/${encodeURIComponent(id)}/renditions`),
    queueRenditions: (id) => request(`/assets/${encodeURIComponent(id)}/renditions`, { method: 'POST', body: {} }),
  },
  redirects: {
    remove: (id) => request(`/redirects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
};

export const api = DEMO_MODE ? demo : remote;
export const isDemoMode = DEMO_MODE;
