import DOMPurify from 'dompurify';
import { safeMediaUrl, safeNavigationUrl } from './integrations.js';

export function sanitizeHtml(value = '') {
  return DOMPurify.sanitize(value, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['style'],
  });
}

export function resolveAsset(value, assetResolver, context = {}) {
  const direct = safeMediaUrl(value);
  if (direct) return direct;
  if (!value || typeof assetResolver !== 'function') return '';
  return safeMediaUrl(assetResolver(value, context));
}

export function resolveLink(value, linkResolver, context = {}) {
  const fallback = context.fallback || '#';
  const resolved = typeof linkResolver === 'function'
    ? linkResolver(value, context)
    : value;
  if (resolved && typeof resolved === 'object') {
    return {
      ...resolved,
      href: safeNavigationUrl(resolved.href, fallback),
    };
  }
  return { href: safeNavigationUrl(resolved, fallback) };
}

export function linkProps(value, linkResolver, context = {}, newTab = false) {
  const resolved = resolveLink(value, linkResolver, context);
  const externalWindow = newTab || resolved.target === '_blank';
  return {
    ...resolved,
    ...(externalWindow
      ? { target: '_blank', rel: resolved.rel || 'noopener noreferrer' }
      : {}),
  };
}

export { safeMediaUrl, safeNavigationUrl };
