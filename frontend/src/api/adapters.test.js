import { describe, expect, it } from 'vitest';
import {
  DocumentAdapterError,
  adaptPageDetail,
  adaptPublicFeed,
  backendDocumentToNormalized,
  normalizedToBackendDocument,
  pageMetadataToBackend,
} from './adapters.js';

const assetId = '123e4567-e89b-42d3-a456-426614174000';

describe('PageDocument adapters', () => {
  it('converts normalized state to the backend tree contract', () => {
    const document = normalizedToBackendDocument({
      title: 'Contract page',
      seo: { title: 'SEO title', description: 'Description' },
      locale: 'ru',
      layout: {
        shell: 'about',
        showPageTitle: true,
        breadcrumbs: 'hidden',
      },
      content: {
        byId: {
          section: { id: 'section', type: 'section', props: {}, parentId: null },
          heading: { id: 'heading', type: 'heading', props: { text: 'Hello', level: 1 }, parentId: 'section' },
          tabs: {
            id: 'tabs',
            type: 'tabs',
            props: { items: [{ label: 'One', content: '<p>First</p>' }] },
            parentId: 'section',
          },
          image: { id: 'image', type: 'image', props: { assetId, alt: 'Example' }, parentId: null },
          hero: { id: 'hero', type: 'hero', props: { title: 'Editor only' }, parentId: null },
          rich: { id: 'rich', type: 'richText', props: { html: '<p>Kept</p>' }, parentId: 'hero' },
        },
        rootOrder: ['section', 'image', 'hero'],
        childrenByParent: {
          section: ['heading', 'tabs'],
          heading: [],
          tabs: [],
          image: [],
          hero: ['rich'],
          rich: [],
        },
      },
    });

    expect(document).toMatchObject({
      schemaVersion: '1.0',
      pageMeta: { title: 'Contract page', seoTitle: 'SEO title', metaDescription: 'Description' },
      locale: 'ru',
      layout: {
        shell: 'about',
        showPageTitle: true,
        breadcrumbs: 'hidden',
      },
      assetsRefs: [assetId],
    });
    expect(document.blocks.map((block) => block.type)).toEqual(['section', 'image', 'hero']);
    expect(document.blocks[0].children[0]).toMatchObject({
      type: 'heading',
      version: '1.0',
      props: { level: 'h1' },
    });
    expect(document.blocks[0].children[1].props).toEqual({
      tabs: [{ label: 'One', content: '<p>First</p>' }],
    });
  });

  it('normalizes nested backend blocks and wrapped detail fields', () => {
    const page = adaptPageDetail({
      page: {
        id: 'page-id',
        siteId: 'site-id',
        title: 'Page',
        slug: 'page',
        status: 'draft',
      },
      routePath: '/page',
      draft: {
        version: 7,
        updatedAt: '2026-08-12T10:00:00Z',
        document: {
          schemaVersion: '1.0',
          pageMeta: { seoTitle: 'SEO' },
          blocks: [{
            id: 'parent',
            type: 'container',
            version: '1.0',
            props: {},
            children: [{
              id: 'child',
              type: 'heading',
              version: '1.0',
              props: { text: 'Nested', level: 'h2' },
              children: [],
              slots: {},
            }],
            slots: {},
          }],
        },
      },
    });

    expect(page).toMatchObject({
      id: 'page-id',
      siteId: 'site-id',
      routePath: '/page',
      version: 7,
      seo: { title: 'SEO' },
      content: {
        rootOrder: ['parent'],
        childrenByParent: { parent: ['child'], child: [] },
      },
    });
    expect(page.content.byId.child.parentId).toBe('parent');
    expect(page).toMatchObject({
      contentType: 'generic',
      sectionKey: '',
      layout: {
        shell: 'auto',
        showPageTitle: false,
        breadcrumbs: 'auto',
      },
      listingMeta: {
        excerpt: '',
        featured: false,
        hiddenFromLists: false,
      },
    });
    expect(backendDocumentToNormalized({ blocks: [] }).content.rootOrder).toEqual([]);
    expect(backendDocumentToNormalized({
      layout: { shell: 'branches', showPageTitle: true, breadcrumbs: 'hidden' },
      blocks: [],
    }).layout).toEqual({
      shell: 'branches',
      showPageTitle: true,
      breadcrumbs: 'hidden',
    });
  });

  it('preserves camelCase content metadata and adapts public feeds', () => {
    const metadata = {
      title: 'News',
      slug: 'launch',
      routePath: '/about/news/launch',
      contentType: 'news',
      sectionKey: 'news',
      listingMeta: {
        excerpt: 'Launch details',
        coverAssetId: assetId,
        publishedDisplayAt: '2026-08-12T10:00:00Z',
        authorName: 'Editor',
        authorTitle: 'Chief editor',
        sortOrder: 4,
        featured: true,
        hiddenFromLists: false,
        menuLabel: 'Launch',
      },
    };

    expect(pageMetadataToBackend(metadata)).toEqual(metadata);
    expect(adaptPublicFeed({ items: [metadata], total: 1 })).toMatchObject({
      total: 1,
      items: [{
        contentType: 'news',
        sectionKey: 'news',
        listingMeta: {
          excerpt: 'Launch details',
          featured: true,
          sortOrder: 4,
        },
      }],
    });
  });

  it('requires media-library assets for asset-backed blocks', () => {
    expect(() => normalizedToBackendDocument({
      content: {
        byId: { image: { id: 'image', type: 'image', props: { src: 'https://example.com/a.jpg' } } },
        rootOrder: ['image'],
        childrenByParent: { image: [] },
      },
    })).toThrow(DocumentAdapterError);
  });

  it('allows an editorial image to inherit the page cover', () => {
    const document = normalizedToBackendDocument({
      content: {
        byId: {
          image: {
            id: 'image',
            type: 'image',
            props: { usePageCover: true, decorative: true },
          },
        },
        rootOrder: ['image'],
        childrenByParent: { image: [] },
      },
    });
    expect(document.blocks[0]).toMatchObject({
      type: 'image',
      props: { usePageCover: true, decorative: true },
    });
    expect(document.blocks[0].props).not.toHaveProperty('assetId');
  });

  it('normalizes embed provider aliases when loading from backend', () => {
    const normalized = backendDocumentToNormalized({
      blocks: [{
        id: 'embed',
        type: 'embed',
        props: { provider: 'googleMaps', url: 'https://www.google.com/maps/embed?pb=1' },
        children: [],
      }],
    });
    expect(normalized.content.byId.embed.props.provider).toBe('google_maps');
  });

  it('requires media-library assets for card images', () => {
    expect(() => normalizedToBackendDocument({
      content: {
        byId: {
          card: {
            id: 'card',
            type: 'card',
            props: { title: 'Card', image: 'https://example.com/a.jpg' },
          },
        },
        rootOrder: ['card'],
        childrenByParent: { card: [] },
      },
    })).toThrow(DocumentAdapterError);
  });
});
