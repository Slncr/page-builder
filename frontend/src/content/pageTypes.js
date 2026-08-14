import { createBlock } from '../registry/index.js';
import { slugify } from '../utils/slugify.js';

export const CONTENT_TYPES = [
  {
    value: 'generic',
    label: 'Обычная страница',
    description: 'Универсальный контент с настраиваемым адресом.',
    defaultSectionKey: '',
  },
  {
    value: 'news',
    label: 'Новость',
    description: 'Новость для ленты и раздела «О нас».',
    defaultSectionKey: 'news',
  },
  {
    value: 'article',
    label: 'Статья',
    description: 'Авторский или редакционный материал.',
    defaultSectionKey: 'articles',
  },
  {
    value: 'service',
    label: 'Услуга',
    description: 'Страница услуги с преимуществами и призывом к действию.',
    defaultSectionKey: 'services',
  },
];

export const CONTENT_TYPE_VALUES = CONTENT_TYPES.map(({ value }) => value);

export const SECTION_OPTIONS = [
  { value: '', label: 'Без раздела' },
  { value: 'about', label: 'О компании' },
  { value: 'news', label: 'Новости' },
  { value: 'articles', label: 'Статьи' },
  { value: 'services', label: 'Услуги' },
];

export const PAGE_SHELL_OPTIONS = [
  { value: 'auto', label: 'Автоматически по адресу страницы' },
  { value: 'plain', label: 'Простая страница' },
  { value: 'home', label: 'Главная страница' },
  { value: 'about', label: 'О компании' },
  { value: 'services', label: 'Услуги' },
  { value: 'labs', label: 'Лаборатории' },
  { value: 'doctors', label: 'Врачи' },
  { value: 'branches', label: 'Филиалы' },
];

export const BREADCRUMB_MODE_OPTIONS = [
  { value: 'auto', label: 'Показывать автоматически' },
  { value: 'hidden', label: 'Скрыть' },
];

export const PAGE_LAYOUT_DEFAULTS = Object.freeze({
  shell: 'auto',
  showPageTitle: false,
  breadcrumbs: 'auto',
});

export const LISTING_META_DEFAULTS = Object.freeze({
  excerpt: '',
  coverAssetId: '',
  publishedDisplayAt: '',
  authorName: '',
  authorTitle: '',
  sortOrder: 0,
  featured: false,
  hiddenFromLists: false,
  menuLabel: '',
});

export function normalizeContentType(value) {
  return CONTENT_TYPE_VALUES.includes(value) ? value : 'generic';
}

export function normalizePageLayout(value = {}) {
  const layout = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    shell: PAGE_SHELL_OPTIONS.some((option) => option.value === layout.shell)
      ? layout.shell
      : PAGE_LAYOUT_DEFAULTS.shell,
    showPageTitle: typeof layout.showPageTitle === 'boolean'
      ? layout.showPageTitle
      : PAGE_LAYOUT_DEFAULTS.showPageTitle,
    breadcrumbs: BREADCRUMB_MODE_OPTIONS.some(
      (option) => option.value === layout.breadcrumbs,
    )
      ? layout.breadcrumbs
      : PAGE_LAYOUT_DEFAULTS.breadcrumbs,
  };
}

export function normalizeListingMeta(value = {}) {
  return {
    ...LISTING_META_DEFAULTS,
    ...(value || {}),
    excerpt: value?.excerpt || '',
    coverAssetId: value?.coverAssetId || '',
    publishedDisplayAt: value?.publishedDisplayAt || '',
    authorName: value?.authorName || '',
    authorTitle: value?.authorTitle || '',
    sortOrder: Number(value?.sortOrder) || 0,
    featured: Boolean(value?.featured),
    hiddenFromLists: Boolean(value?.hiddenFromLists),
    menuLabel: value?.menuLabel || '',
  };
}

export function defaultSectionKey(contentType) {
  return CONTENT_TYPES.find(({ value }) => value === normalizeContentType(contentType))
    ?.defaultSectionKey || '';
}

function normalizeCustomPath(value) {
  const path = String(value || '').trim();
  if (!path) return '';
  return path.startsWith('/') ? path : `/${path}`;
}

export function canonicalRoutePath(contentType, slug, customPath = '') {
  const explicitPath = normalizeCustomPath(customPath);
  if (explicitPath) return explicitPath;
  const safeSlug = slugify(slug || '', '');
  const suffix = safeSlug ? `/${safeSlug}` : '';
  switch (normalizeContentType(contentType)) {
    case 'news':
      return `/about/news${suffix}`;
    case 'article':
      return `/about/articles${suffix}`;
    case 'service':
      return `/services${suffix}`;
    default:
      return suffix || '/';
  }
}

export function defaultRoutePath(contentType, slug) {
  return canonicalRoutePath(contentType, slug);
}

function normalizeTemplate(value) {
  return CONTENT_TYPE_VALUES.includes(value) ? value : 'generic';
}

export function createTemplateContent(template, title = '') {
  const heading = title || {
    news: 'Заголовок новости',
    article: 'Заголовок статьи',
    service: 'Название услуги',
  }[template] || 'Заголовок страницы';
  const blocksByTemplate = {
    generic: [
      createBlock('breadcrumbs', { props: { source: 'auto' } }),
      createBlock('heading', { props: { level: 'h1', text: heading } }),
      createBlock('text', {
        props: { html: '<p>Добавьте основной текст страницы.</p>' },
      }),
    ],
    news: [
      createBlock('breadcrumbs', { props: { source: 'auto' } }),
      createBlock('heading', { props: { level: 'h1', text: heading } }),
      createBlock('text', {
        props: { html: '<p>Кратко сформулируйте главное в первом абзаце.</p>' },
      }),
      createBlock('divider'),
      createBlock('text', {
        props: { html: '<p>Раскройте детали новости и добавьте важный контекст.</p>' },
      }),
    ],
    article: [
      createBlock('breadcrumbs', { props: { source: 'auto' } }),
      createBlock('heading', { props: { level: 'h1', text: heading } }),
      createBlock('text', {
        props: { html: '<p>Добавьте вводный абзац статьи.</p>' },
      }),
      createBlock('quote'),
      createBlock('text', {
        props: { html: '<p>Продолжите материал и сформулируйте выводы.</p>' },
      }),
    ],
    service: [
      createBlock('breadcrumbs', { props: { source: 'auto' } }),
      createBlock('heading', { props: { level: 'h1', text: heading } }),
      createBlock('text', {
        props: { html: '<p>Объясните, какую задачу решает эта услуга.</p>' },
      }),
      createBlock('featureList', {
        props: { title: 'Что входит в услугу' },
      }),
      createBlock('faq'),
      createBlock('cta', {
        props: {
          title: 'Обсудим вашу задачу?',
          text: 'Оставьте заявку, и мы свяжемся с вами.',
        },
      }),
    ],
  };
  const blocks = blocksByTemplate[normalizeTemplate(template)];
  return {
    byId: Object.fromEntries(blocks.map((block) => [block.id, block])),
    rootOrder: blocks.map((block) => block.id),
    childrenByParent: Object.fromEntries(blocks.map((block) => [block.id, []])),
  };
}
