const SAFE_NAVIGATION_URL = /^(https?:|mailto:|tel:|\/|#)/i;
const SAFE_MEDIA_URL = /^(https?:|\/)/i;
const ADMIN_MOUNTS = Object.freeze(['/page-builder', '/_page-builder']);

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function normalizeBasePath(value = '/') {
  const path = `/${String(value || '/').trim().replace(/^\/+|\/+$/g, '')}`;
  return path === '/' ? path : `${path}/`;
}

export function publicSiteUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//')) {
    return candidate;
  }
  for (const mount of ADMIN_MOUNTS) {
    if (candidate === mount || candidate === `${mount}/`) return '/';
    if (
      candidate.startsWith(`${mount}/`)
      || candidate.startsWith(`${mount}?`)
      || candidate.startsWith(`${mount}#`)
    ) {
      return candidate.slice(mount.length) || '/';
    }
  }
  return candidate;
}

function withBasePath(value, basePath) {
  const candidate = String(value || '/');
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return candidate;
  const normalizedBase = normalizeBasePath(basePath);
  if (normalizedBase === '/') return candidate;
  const basename = normalizedBase.slice(0, -1);
  if (
    candidate === basename
    || candidate.startsWith(`${basename}/`)
    || candidate.startsWith(`${basename}?`)
    || candidate.startsWith(`${basename}#`)
  ) {
    return candidate;
  }
  return `${basename}${candidate}`;
}

export function safeNavigationUrl(value, fallback = '#') {
  const candidate = String(value || '').trim();
  return SAFE_NAVIGATION_URL.test(candidate) ? candidate : fallback;
}

export function safeMediaUrl(value) {
  const candidate = String(value || '').trim();
  return SAFE_MEDIA_URL.test(candidate) ? candidate : '';
}

export function createIntegrationAdapters({
  apiBaseUrl = '/api/v1',
  basePath = '/',
  fetchImpl = (...args) => fetch(...args),
  pageFeedResolver = null,
} = {}) {
  const apiRoot = trimTrailingSlash(apiBaseUrl) || '/api/v1';

  return {
    assetResolver(assetId) {
      return assetId
        ? `${apiRoot}/public/assets/${encodeURIComponent(assetId)}`
        : '';
    },

    linkResolver(value, context = {}) {
      const fallback = context.fallback || '#';
      const href = publicSiteUrl(safeNavigationUrl(value, fallback));
      return publicSiteUrl(withBasePath(href, basePath));
    },

    async formSubmitter(submission, context = {}) {
      const endpoint = context.action
        || (context.formId
          ? `${apiRoot}/public/forms/${encodeURIComponent(context.formId)}/submit`
          : '');
      if (!endpoint) throw new Error('Form integration is not configured.');

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submission),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload?.error?.message
          || payload?.message
          || 'The form could not be submitted.',
        );
      }
      return payload || {};
    },

    async pageFeedResolver(query = {}) {
      if (typeof pageFeedResolver === 'function') {
        return pageFeedResolver(query);
      }
      return { items: query.items || [] };
    },

    integrationSlots: Object.freeze({}),
  };
}

export const defaultIntegrationAdapters = Object.freeze(createIntegrationAdapters());
export const defaultAssetResolver = defaultIntegrationAdapters.assetResolver;
export const defaultFormSubmitter = defaultIntegrationAdapters.formSubmitter;
export const defaultLinkResolver = defaultIntegrationAdapters.linkResolver;
export const defaultIntegrationSlots = defaultIntegrationAdapters.integrationSlots;
