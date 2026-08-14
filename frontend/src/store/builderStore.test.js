import { describe, expect, it } from 'vitest';
import { HISTORY_LIMIT, createBuilderStore } from './builderStore.js';

describe('builder store', () => {
  it('keeps blocks normalized and reverses patch operations', () => {
    const store = createBuilderStore();
    const headingId = store.getState().addBlock('heading');
    const sectionId = store.getState().addBlock('section');

    expect(store.getState().rootOrder).toEqual([headingId, sectionId]);
    expect(store.getState().byId[headingId].parentId).toBeNull();

    expect(store.getState().moveBlock(headingId, sectionId, 0)).toBe(true);
    expect(store.getState().rootOrder).toEqual([sectionId]);
    expect(store.getState().childrenByParent[sectionId]).toEqual([headingId]);

    store.getState().updateBlock(headingId, { text: 'Changed heading' });
    expect(store.getState().byId[headingId].props.text).toBe('Changed heading');
    store.getState().undo();
    expect(store.getState().byId[headingId].props.text).not.toBe('Changed heading');
    store.getState().redo();
    expect(store.getState().byId[headingId].props.text).toBe('Changed heading');
  });

  it('rejects invalid nesting and recursive ancestry', () => {
    const store = createBuilderStore();
    const headingId = store.getState().addBlock('heading');
    const sectionId = store.getState().addBlock('section');
    const nestedSectionId = store.getState().addBlock('section', sectionId);

    expect(store.getState().moveBlock(sectionId, nestedSectionId, 0)).toBe(false);
    expect(store.getState().moveBlock(headingId, headingId, 0)).toBe(false);
    expect(store.getState().moveBlock(sectionId, headingId, 0)).toBe(false);
  });

  it('duplicates and removes a complete normalized subtree', () => {
    const store = createBuilderStore();
    const sectionId = store.getState().addBlock('section');
    store.getState().addBlock('heading', sectionId);
    const duplicateId = store.getState().duplicateBlock(sectionId);

    expect(store.getState().rootOrder).toEqual([sectionId, duplicateId]);
    expect(store.getState().childrenByParent[duplicateId]).toHaveLength(1);
    store.getState().removeBlock(duplicateId);
    expect(store.getState().byId[duplicateId]).toBeUndefined();
    expect(store.getState().rootOrder).toEqual([sectionId]);
  });

  it('supports snapshot history and caps history at 50 steps', () => {
    const store = createBuilderStore();
    store.getState().replaceDocument({
      title: 'Restored',
      slug: 'restored',
      seo: {},
      content: { byId: {}, rootOrder: [], childrenByParent: {} },
    });
    expect(store.getState().title).toBe('Restored');
    store.getState().undo();
    expect(store.getState().title).toBe('Страница без названия');

    for (let index = 0; index < HISTORY_LIMIT + 8; index += 1) {
      store.getState().updatePage({ title: `Title ${index}` });
    }
    expect(store.getState().history.past).toHaveLength(HISTORY_LIMIT);
  });

  it('keeps content classification and listing metadata in document history', () => {
    const store = createBuilderStore({
      title: 'News',
      slug: 'launch',
      routePath: '/about/news/launch',
      contentType: 'news',
      sectionKey: 'news',
      listingMeta: { excerpt: 'Initial', featured: false },
      content: { byId: {}, rootOrder: [], childrenByParent: {} },
    });

    store.getState().updatePage({
      listingMeta: { excerpt: 'Updated', featured: true },
      sectionKey: 'company-news',
    });

    expect(store.getState().serialize()).toMatchObject({
      contentType: 'news',
      sectionKey: 'company-news',
      routePath: '/about/news/launch',
      listingMeta: {
        excerpt: 'Updated',
        featured: true,
        hiddenFromLists: false,
      },
    });
    store.getState().undo();
    expect(store.getState().listingMeta.excerpt).toBe('Initial');
    expect(store.getState().sectionKey).toBe('news');
  });

  it('normalizes, edits, and serializes the host layout contract', () => {
    const store = createBuilderStore({
      layout: {},
      content: { byId: {}, rootOrder: [], childrenByParent: {} },
    });

    expect(store.getState().layout).toEqual({
      shell: 'auto',
      showPageTitle: false,
      breadcrumbs: 'auto',
    });

    store.getState().updatePage({
      layout: { shell: 'labs', showPageTitle: true, breadcrumbs: 'hidden' },
    });
    expect(store.getState().serialize().layout).toEqual({
      shell: 'labs',
      showPageTitle: true,
      breadcrumbs: 'hidden',
    });

    store.getState().undo();
    expect(store.getState().layout).toEqual({
      shell: 'auto',
      showPageTitle: false,
      breadcrumbs: 'auto',
    });
  });

  it('remembers that a draft already has a live published version', () => {
    const store = createBuilderStore();
    store.getState().loadPage({
      id: 'page-1',
      title: 'Published page',
      slug: 'published-page',
      status: 'draft',
      publishedRevisionId: 'revision-1',
      content: { byId: {}, rootOrder: [], childrenByParent: {} },
    });

    expect(store.getState().hasPublishedVersion).toBe(true);
    expect(store.getState().serialize()).not.toHaveProperty('hasPublishedVersion');
  });
});
