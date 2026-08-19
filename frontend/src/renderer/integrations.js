import { createIntegrationAdapters } from '@construktor/renderer';
import { api } from '../api/client.js';

const API_ROOT = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

const baseAdapters = createIntegrationAdapters({
  apiBaseUrl: API_ROOT,
  // Document links belong to the integrated public site, not the admin mount.
  basePath: '/',
  pageFeedResolver: async ({
    sourceType = 'manual',
    source = '',
    sort = 'newest',
    limit = 6,
    contentType = '',
    sectionKey = '',
  }) => {
    if (sourceType === 'manual') {
      return { items: [] };
    }
    const feed = await api.pages.listPublic({
      contentType: sourceType === 'folder' ? (source || contentType) : contentType,
      section: sourceType === 'tag' ? (source || sectionKey) : '',
      pageSize: limit,
    });
    let items = feed.items || [];
    if (sort === 'oldest') {
      items = [...items].reverse();
    } else if (sort === 'title') {
      items = [...items].sort((left, right) => String(left.title).localeCompare(String(right.title), 'ru'));
    }
    return {
      items: items.map((page) => ({
        title: page.title,
        description: page.listingMeta?.excerpt || '',
        href: page.routePath || `/${page.slug}`,
        coverAssetId: page.listingMeta?.coverAssetId || '',
      })),
    };
  },
});

export const rendererAdapters = baseAdapters;

export const resolveRendererAsset = rendererAdapters.assetResolver;
