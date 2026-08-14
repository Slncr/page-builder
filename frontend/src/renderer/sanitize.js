import {
  safeMediaUrl,
  safeNavigationUrl,
  sanitizeHtml,
} from '@construktor/renderer';
import { rendererAdapters } from './integrations.js';

const API_ROOT = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

export { safeMediaUrl, sanitizeHtml };

export function safeUrl(value, fallback = '#') {
  const resolved = rendererAdapters.linkResolver(safeNavigationUrl(value, fallback), { fallback });
  return typeof resolved === 'string' ? resolved : resolved.href;
}

export function assetUrl(assetId) {
  return rendererAdapters.assetResolver(assetId);
}

export function publicFormUrl(formId) {
  return formId ? `${API_ROOT}/public/forms/${encodeURIComponent(formId)}/submit` : '';
}

export function linkProps(href, newTab = false) {
  return {
    href: safeUrl(href),
    ...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
  };
}
