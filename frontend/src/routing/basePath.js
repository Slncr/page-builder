export function normalizeBasePath(value = '/') {
  const path = `/${String(value || '/').trim().replace(/^\/+|\/+$/g, '')}`;
  return path === '/' ? path : `${path}/`;
}

export const APP_BASE_PATH = normalizeBasePath(import.meta.env.BASE_URL);
export const ROUTER_BASENAME = APP_BASE_PATH === '/'
  ? '/'
  : APP_BASE_PATH.slice(0, -1);

export function withBasePath(value = '/', basePath = APP_BASE_PATH) {
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

export function withoutBasePath(value = '/', basePath = APP_BASE_PATH) {
  const candidate = String(value || '/');
  const normalizedBase = normalizeBasePath(basePath);
  if (normalizedBase === '/') return candidate;

  const basename = normalizedBase.slice(0, -1);
  if (candidate === basename) return '/';
  if (candidate.startsWith(`${basename}/`)) {
    return candidate.slice(basename.length) || '/';
  }
  return candidate;
}
