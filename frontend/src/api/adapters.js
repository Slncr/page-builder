import {
  backendContentType,
  canonicalRoutePath,
  normalizeContentType,
  normalizeListingMeta,
  normalizePageLayout,
} from '../content/pageTypes.js';

const BACKEND_BLOCK_TYPES = new Set([
  'section',
  'container',
  'columns',
  'spacer',
  'divider',
  'heading',
  'text',
  'quote',
  'image',
  'gallery',
  'video',
  'file',
  'button',
  'cta',
  'card',
  'hero',
  'featureList',
  'stats',
  'testimonials',
  'pricing',
  'accordion',
  'tabs',
  'table',
  'list',
  'form',
  'embed',
  'html',
  'map',
  'faq',
  'breadcrumbs',
  'pageList',
  'navbar',
  'footer',
]);

const TYPE_ALIASES = {
  richText: 'text',
  features: 'featureList',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSET_KEYS = ['assetId', 'backgroundImage', 'image', 'ogImage', 'posterAssetId', 'thumbnailAssetId', 'coverAssetId'];

const clone = (value) => (value == null ? value : structuredClone(value));
const isUuid = (value) => typeof value === 'string' && UUID_PATTERN.test(value);

function requireOptionalAssetUuid(props, key, message, blockId) {
  if (props[key] && !isUuid(props[key])) {
    throw new DocumentAdapterError(message, blockId);
  }
}

export function adaptPageMetadata(page = {}) {
  const contentType = normalizeContentType(page.contentType);
  return {
    ...page,
    contentType,
    sectionKey: page.sectionKey || '',
    listingMeta: normalizeListingMeta(page.listingMeta),
    routePath: canonicalRoutePath(contentType, page.slug, page.routePath || page.path),
  };
}

export function pageMetadataToBackend(page = {}) {
  const listingMeta = normalizeListingMeta(page.listingMeta);
  return {
    title: page.title,
    slug: page.slug,
    routePath: canonicalRoutePath(page.contentType, page.slug, page.routePath),
    contentType: backendContentType(page.contentType),
    sectionKey: page.sectionKey || null,
    listingMeta: {
      ...listingMeta,
      coverAssetId: listingMeta.coverAssetId || null,
      publishedDisplayAt: listingMeta.publishedDisplayAt || null,
    },
  };
}

export class DocumentAdapterError extends Error {
  constructor(message, blockId) {
    super(message);
    this.name = 'DocumentAdapterError';
    this.blockId = blockId;
  }
}

function frontendSeo(pageMeta = {}) {
  return {
    title: pageMeta.seoTitle || '',
    description: pageMeta.metaDescription || '',
    socialImage: pageMeta.ogImage || '',
    noIndex: String(pageMeta.robots || '').startsWith('noindex'),
    canonical: pageMeta.canonical || '',
    ogTitle: pageMeta.ogTitle || '',
    ogDescription: pageMeta.ogDescription || '',
    twitterCard: pageMeta.twitterCard || 'summary_large_image',
    sitemapPriority: pageMeta.sitemapPriority ?? 0.5,
    changeFrequency: pageMeta.changeFrequency || 'monthly',
  };
}

function backendPageMeta(page = {}) {
  const seo = page.seo || {};
  return {
    title: page.title || null,
    seoTitle: seo.title || null,
    metaDescription: seo.description || null,
    canonical: seo.canonical || null,
    robots: seo.noIndex ? 'noindex,follow' : 'index,follow',
    ogTitle: seo.ogTitle || null,
    ogDescription: seo.ogDescription || null,
    ogImage: isUuid(seo.socialImage) ? seo.socialImage : null,
    twitterCard: seo.twitterCard || 'summary_large_image',
    sitemapPriority: Number(seo.sitemapPriority ?? 0.5),
    changeFrequency: seo.changeFrequency || 'monthly',
  };
}

function propsFromBackend(type, input = {}) {
  const props = clone(input);
  if (type === 'tabs') {
    props.tabs = clone(props.tabs || props.items || []);
    delete props.items;
  }
  if (type === 'embed') {
    props.provider = {
      googleMaps: 'google_maps',
      yandexMaps: 'yandex_maps',
    }[props.provider] || props.provider;
  }
  return props;
}

function propsToBackend(type, input = {}, blockId) {
  const props = clone(input);

  if (type === 'heading') {
    const numeric = String(props.level ?? 'h2').replace(/^h/i, '');
    props.level = `h${Math.min(6, Math.max(1, Number(numeric) || 2))}`;
  }
  if (type === 'tabs') {
    props.tabs = clone(props.tabs || props.items || []);
    delete props.items;
  }
  if (type === 'embed') {
    props.provider = {
      googleMaps: 'google_maps',
      yandexMaps: 'yandex_maps',
    }[props.provider] || props.provider;
  }

  for (const key of ASSET_KEYS) {
    if (key in props && !props[key]) delete props[key];
  }
  if (type === 'image' && !props.usePageCover && !isUuid(props.assetId)) {
    throw new DocumentAdapterError('Для блока изображения нужен файл из медиатеки.', blockId);
  }
  if (type === 'file' && !isUuid(props.assetId)) {
    throw new DocumentAdapterError('Для блока файла нужен материал из медиатеки.', blockId);
  }
  if (type === 'gallery') {
    props.assets = (props.assets || [])
      .map((asset) => (typeof asset === 'string' ? { assetId: asset } : clone(asset)))
      .filter((asset) => isUuid(asset.assetId));
    if (!props.assets.length) {
      throw new DocumentAdapterError('Добавьте хотя бы одно изображение из медиатеки.', blockId);
    }
    props.assets = props.assets.map(({ assetId, alt = '' }) => ({ assetId, alt }));
  }
  if (type === 'image') {
    delete props.src;
  }
  if (type === 'file') {
    delete props.url;
  }
  if (type === 'card') {
    requireOptionalAssetUuid(
      props,
      'image',
      'Для изображения карточки нужен файл из медиатеки.',
      blockId,
    );
  }
  if (type === 'hero') {
    requireOptionalAssetUuid(
      props,
      'backgroundImage',
      'Для фона первого экрана нужен файл из медиатеки.',
      blockId,
    );
  }
  if (type === 'section') {
    requireOptionalAssetUuid(
      props,
      'backgroundImage',
      'Для фонового изображения секции нужен файл из медиатеки.',
      blockId,
    );
  }
  if (type === 'video') {
    requireOptionalAssetUuid(
      props,
      'posterAssetId',
      'Для обложки видео нужен файл из медиатеки.',
      blockId,
    );
  }
  if (type === 'form' && !props.formId) delete props.formId;

  return props;
}

export function backendDocumentToNormalized(document = {}) {
  const byId = {};
  const rootOrder = [];
  const childrenByParent = {};

  const visit = (block, parentId = null) => {
    if (!block || typeof block === 'string' || !block.id) return null;
    const type = block.type;
    byId[block.id] = {
      id: block.id,
      type,
      version: String(block.version || '1.0'),
      parentId,
      props: propsFromBackend(type, block.props),
    };
    childrenByParent[block.id] = [];
    for (const child of block.children || []) {
      const childId = visit(child, block.id);
      if (childId) childrenByParent[block.id].push(childId);
    }
    for (const children of Object.values(block.slots || {})) {
      for (const child of children) {
        const childId = visit(child, block.id);
        if (childId && !childrenByParent[block.id].includes(childId)) {
          childrenByParent[block.id].push(childId);
        }
      }
    }
    return block.id;
  };

  for (const block of document.blocks || []) {
    const id = visit(block);
    if (id) rootOrder.push(id);
  }

  return {
    seo: frontendSeo(document.pageMeta),
    locale: document.locale || 'ru',
    layout: normalizePageLayout(document.layout),
    settings: clone(document.settings || {}),
    assetsRefs: clone(document.assetsRefs || []),
    content: { byId, rootOrder, childrenByParent },
  };
}

export function normalizedToBackendDocument(page = {}) {
  const content = page.content || page;
  const byId = content.byId || {};
  const childrenByParent = content.childrenByParent || {};

  const visit = (id) => {
    const source = byId[id];
    if (!source) return [];
    const children = (childrenByParent[id] || []).flatMap(visit);
    const type = TYPE_ALIASES[source.type] || source.type;
    if (!BACKEND_BLOCK_TYPES.has(type)) return children;
    return [{
      id: source.id,
      type,
      version: '1.0',
      props: propsToBackend(type, source.props, source.id),
      children,
      slots: {},
    }];
  };

  const blocks = (content.rootOrder || []).flatMap(visit);
  const assetsRefs = new Set((page.assetsRefs || []).filter(isUuid));
  const collectAssets = (value, key) => {
    if (Array.isArray(value)) {
      value.forEach((item) => collectAssets(item, key));
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([nextKey, item]) => collectAssets(item, nextKey));
    } else if (ASSET_KEYS.includes(key) && isUuid(value)) {
      assetsRefs.add(value);
    }
  };
  blocks.forEach((block) => collectAssets(block));
  if (isUuid(page.seo?.socialImage)) assetsRefs.add(page.seo.socialImage);

  return {
    schemaVersion: '1.0',
    pageMeta: backendPageMeta(page),
    layout: normalizePageLayout(page.layout),
    locale: page.locale || 'ru',
    blocks,
    assetsRefs: [...assetsRefs],
    settings: clone(page.settings || {}),
  };
}

export function adaptPageDetail(payload) {
  const page = adaptPageMetadata(payload.page || {});
  const draft = payload.draft || {};
  const normalized = backendDocumentToNormalized(draft.document || {});
  return {
    ...page,
    ...normalized,
    id: page.id,
    siteId: page.siteId,
    routePath: payload.routePath || canonicalRoutePath(
      page.contentType,
      page.slug,
      page.routePath || page.path,
    ),
    version: draft.version ?? page.draftVersion ?? 0,
    updatedAt: draft.updatedAt || page.updatedAt,
  };
}

export function adaptPublicPage(payload) {
  const normalized = backendDocumentToNormalized(payload.document || {});
  const page = adaptPageMetadata(payload.page || {});
  return {
    ...page,
    ...normalized,
    id: page.id,
    routePath: canonicalRoutePath(page.contentType, page.slug, page.path || page.routePath),
    version: payload.revisionId,
  };
}

export function adaptDraftResponse(payload, savedPage) {
  return {
    ...adaptPageMetadata(clone(savedPage)),
    version: payload.version,
    updatedAt: payload.updatedAt,
  };
}

export function adaptPublicFeed(payload) {
  const source = payload?.items || payload?.pages || (Array.isArray(payload) ? payload : []);
  const items = source.map((item) => adaptPageMetadata(item.page || item));
  if (Array.isArray(payload)) return items;
  return {
    ...(payload || {}),
    items,
  };
}

export function editorOnlyBlockTypes(page = {}) {
  const content = page.content || page;
  return [...new Set(Object.values(content.byId || {})
    .map((block) => block.type)
    .filter((type) => !BACKEND_BLOCK_TYPES.has(TYPE_ALIASES[type] || type)))];
}

export { BACKEND_BLOCK_TYPES, isUuid };
