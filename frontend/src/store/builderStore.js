import { applyPatches, current, enablePatches, produceWithPatches } from 'immer';
import { create } from 'zustand';
import {
  canonicalRoutePath,
  normalizeContentType,
  normalizeListingMeta,
  normalizePageLayout,
} from '../content/pageTypes.js';
import { canNest, createBlock, getBlockDefinition } from '../registry/index.js';

enablePatches();

const HISTORY_LIMIT = 50;
const DOCUMENT_KEYS = [
  'title',
  'slug',
  'routePath',
  'status',
  'contentType',
  'sectionKey',
  'listingMeta',
  'seo',
  'locale',
  'layout',
  'settings',
  'assetsRefs',
  'byId',
  'rootOrder',
  'childrenByParent',
];

const emptyDocument = {
  title: 'Страница без названия',
  slug: 'stranitsa-bez-nazvaniya',
  routePath: '/',
  status: 'draft',
  contentType: 'generic',
  sectionKey: '',
  listingMeta: normalizeListingMeta(),
  seo: { title: '', description: '', socialImage: '', noIndex: false },
  locale: 'ru',
  layout: normalizePageLayout(),
  settings: {},
  assetsRefs: [],
  byId: {},
  rootOrder: [],
  childrenByParent: {},
};

function documentSnapshot(state) {
  return DOCUMENT_KEYS.reduce((snapshot, key) => {
    snapshot[key] = structuredClone(state[key]);
    return snapshot;
  }, {});
}

function historyWithEntry(history, entry) {
  return {
    past: [...history.past, entry].slice(-HISTORY_LIMIT),
    future: [],
  };
}

function siblingList(document, parentId) {
  return parentId == null
    ? document.rootOrder
    : (document.childrenByParent[parentId] ||= []);
}

function descendantsOf(document, id, result = []) {
  for (const childId of document.childrenByParent[id] || []) {
    result.push(childId);
    descendantsOf(document, childId, result);
  }
  return result;
}

function depthOf(document, parentId) {
  let depth = 0;
  let current = parentId;
  const visited = new Set();
  while (current && document.byId[current] && !visited.has(current)) {
    visited.add(current);
    depth += 1;
    current = document.byId[current].parentId;
  }
  return depth;
}

function normalizePage(page) {
  const content = page?.content || page || {};
  return {
    title: page?.title || 'Страница без названия',
    slug: page?.slug || 'stranitsa-bez-nazvaniya',
    routePath: canonicalRoutePath(
      page?.contentType,
      page?.slug || 'stranitsa-bez-nazvaniya',
      page?.routePath || page?.path,
    ),
    status: page?.status || 'draft',
    hasPublishedVersion: Boolean(
      page?.hasPublishedVersion
      || page?.publishedRevisionId
      || page?.publishedAt
      || page?.status === 'published'
    ),
    contentType: normalizeContentType(page?.contentType),
    sectionKey: page?.sectionKey || '',
    listingMeta: normalizeListingMeta(page?.listingMeta),
    seo: {
      title: '',
      description: '',
      socialImage: '',
      noIndex: false,
      ...(page?.seo || {}),
    },
    locale: page?.locale || 'ru',
    layout: normalizePageLayout(page?.layout),
    settings: structuredClone(page?.settings || {}),
    assetsRefs: structuredClone(page?.assetsRefs || []),
    byId: structuredClone(content.byId || {}),
    rootOrder: structuredClone(content.rootOrder || []),
    childrenByParent: structuredClone(content.childrenByParent || {}),
  };
}

export function createBuilderStore(initialDocument) {
  return create((set, get) => {
    const commit = (label, recipe) => {
      const state = get();
      const before = documentSnapshot(state);
      const [after, patches, inversePatches] = produceWithPatches(before, recipe);
      if (!patches.length) return false;
      set({
        ...after,
        dirty: true,
        conflict: null,
        history: historyWithEntry(state.history, {
          type: 'patch',
          label,
          patches,
          inversePatches,
        }),
      });
      return true;
    };

    return {
      ...structuredClone(emptyDocument),
      ...(initialDocument ? normalizePage(initialDocument) : {}),
      pageId: null,
      siteId: null,
      baseVersion: 0,
      selectedId: null,
      hoveredId: null,
      device: 'desktop',
      canvasMode: 'edit',
      dirty: false,
      saveState: 'idle',
      lastSavedAt: null,
      conflict: null,
      history: { past: [], future: [] },

      loadPage(page) {
        set({
          ...normalizePage(page),
          pageId: page.id,
          siteId: page.siteId || null,
          baseVersion: page.version || 0,
          selectedId: null,
          hoveredId: null,
          dirty: false,
          saveState: 'idle',
          lastSavedAt: page.updatedAt || null,
          conflict: null,
          history: { past: [], future: [] },
        });
      },

      replaceDocument(nextDocument, label = 'Восстановить версию') {
        const state = get();
        const before = documentSnapshot(state);
        const after = normalizePage(nextDocument);
        set({
          ...after,
          dirty: true,
          selectedId: null,
          history: historyWithEntry(state.history, {
            type: 'snapshot',
            label,
            before,
            after: structuredClone(after),
          }),
        });
      },

      updatePage(patch) {
        commit('Изменить настройки страницы', (document) => {
          for (const key of [
            'title',
            'slug',
            'routePath',
            'status',
            'contentType',
            'sectionKey',
            'listingMeta',
            'seo',
            'layout',
          ]) {
            if (key in patch) {
              if (key === 'seo') document.seo = { ...document.seo, ...patch.seo };
              else if (key === 'listingMeta') {
                document.listingMeta = normalizeListingMeta({
                  ...document.listingMeta,
                  ...patch.listingMeta,
                });
              } else if (key === 'contentType') {
                document.contentType = normalizeContentType(patch.contentType);
              } else if (key === 'layout') {
                document.layout = normalizePageLayout({
                  ...document.layout,
                  ...patch.layout,
                });
              } else {
                document[key] = patch[key];
              }
            }
          }
        });
      },

      addBlock(type, parentId = null, index) {
        let created;
        const changed = commit(`Добавить блок «${getBlockDefinition(type)?.label || type}»`, (document) => {
          const parent = parentId ? document.byId[parentId] : null;
          if (parent && !canNest(type, parent.type, depthOf(document, parentId))) return;
          created = createBlock(type, { parentId });
          document.byId[created.id] = created;
          document.childrenByParent[created.id] = [];
          const siblings = siblingList(document, parentId);
          const destination = Number.isInteger(index)
            ? Math.max(0, Math.min(index, siblings.length))
            : siblings.length;
          siblings.splice(destination, 0, created.id);
        });
        if (changed && created) set({ selectedId: created.id });
        return created?.id || null;
      },

      updateBlock(id, props) {
        return commit('Изменить блок', (document) => {
          if (!document.byId[id]) return;
          document.byId[id].props = {
            ...document.byId[id].props,
            ...props,
          };
        });
      },

      removeBlock(id) {
        const state = get();
        if (!state.byId[id]) return false;
        const changed = commit('Удалить блок', (document) => {
          const block = document.byId[id];
          const siblings = siblingList(document, block.parentId);
          const index = siblings.indexOf(id);
          if (index >= 0) siblings.splice(index, 1);
          const ids = [id, ...descendantsOf(document, id)];
          for (const currentId of ids) {
            delete document.byId[currentId];
            delete document.childrenByParent[currentId];
          }
        });
        if (changed && get().selectedId === id) set({ selectedId: null });
        return changed;
      },

      moveBlock(id, nextParentId = null, nextIndex = 0) {
        const state = get();
        if (!state.byId[id] || id === nextParentId) return false;
        if (descendantsOf(state, id).includes(nextParentId)) return false;
        const parent = nextParentId ? state.byId[nextParentId] : null;
        if (parent && !canNest(state.byId[id].type, parent.type, depthOf(state, nextParentId))) {
          return false;
        }
        return commit('Переместить блок', (document) => {
          const block = document.byId[id];
          const previous = siblingList(document, block.parentId);
          const previousIndex = previous.indexOf(id);
          if (previousIndex >= 0) previous.splice(previousIndex, 1);
          block.parentId = nextParentId;
          const next = siblingList(document, nextParentId);
          const safeIndex = Math.max(0, Math.min(nextIndex, next.length));
          next.splice(safeIndex, 0, id);
        });
      },

      duplicateBlock(id) {
        const state = get();
        if (!state.byId[id]) return null;
        let duplicateRootId = null;
        commit('Дублировать блок', (document) => {
          const cloneBranch = (sourceId, parentId) => {
            const source = document.byId[sourceId];
            const clone = createBlock(source.type, {
              parentId,
              props: structuredClone(current(source.props)),
            });
            document.byId[clone.id] = clone;
            document.childrenByParent[clone.id] = [];
            for (const childId of document.childrenByParent[sourceId] || []) {
              const childClone = cloneBranch(childId, clone.id);
              document.childrenByParent[clone.id].push(childClone);
            }
            return clone.id;
          };
          const source = document.byId[id];
          duplicateRootId = cloneBranch(id, source.parentId);
          const siblings = siblingList(document, source.parentId);
          siblings.splice(siblings.indexOf(id) + 1, 0, duplicateRootId);
        });
        if (duplicateRootId) set({ selectedId: duplicateRootId });
        return duplicateRootId;
      },

      undo() {
        const state = get();
        const entry = state.history.past.at(-1);
        if (!entry) return false;
        const current = documentSnapshot(state);
        const previous = entry.type === 'snapshot'
          ? structuredClone(entry.before)
          : applyPatches(current, entry.inversePatches);
        set({
          ...previous,
          selectedId: previous.byId[state.selectedId] ? state.selectedId : null,
          dirty: true,
          history: {
            past: state.history.past.slice(0, -1),
            future: [entry, ...state.history.future],
          },
        });
        return true;
      },

      redo() {
        const state = get();
        const [entry, ...remaining] = state.history.future;
        if (!entry) return false;
        const current = documentSnapshot(state);
        const next = entry.type === 'snapshot'
          ? structuredClone(entry.after)
          : applyPatches(current, entry.patches);
        set({
          ...next,
          dirty: true,
          history: {
            past: [...state.history.past, entry].slice(-HISTORY_LIMIT),
            future: remaining,
          },
        });
        return true;
      },

      selectBlock(id) {
        set({ selectedId: id && get().byId[id] ? id : null });
      },
      hoverBlock(id) {
        set({ hoveredId: id });
      },
      setDevice(device) {
        if (['desktop', 'tablet', 'mobile'].includes(device)) set({ device });
      },
      setCanvasMode(canvasMode) {
        set({ canvasMode });
      },
      setSaveState(saveState) {
        set({ saveState });
      },
      markSaved(page, savedDocument) {
        const unchangedWhileSaving = !savedDocument
          || JSON.stringify(get().serialize()) === JSON.stringify(savedDocument);
        set({
          ...(unchangedWhileSaving ? normalizePage(page) : {}),
          baseVersion: page.version,
          dirty: !unchangedWhileSaving,
          saveState: unchangedWhileSaving ? 'saved' : 'idle',
          lastSavedAt: page.updatedAt || new Date().toISOString(),
          conflict: null,
        });
      },
      setConflict(conflict) {
        set({ conflict, saveState: 'conflict' });
      },
      clearConflict() {
        set({ conflict: null, saveState: 'idle' });
      },
      serialize() {
        const state = get();
        return {
          id: state.pageId,
          siteId: state.siteId,
          routePath: state.routePath,
          title: state.title,
          slug: state.slug,
          contentType: state.contentType,
          sectionKey: state.sectionKey,
          listingMeta: structuredClone(state.listingMeta),
          status: state.status,
          seo: structuredClone(state.seo),
          locale: state.locale,
          layout: normalizePageLayout(state.layout),
          settings: structuredClone(state.settings),
          assetsRefs: structuredClone(state.assetsRefs),
          content: {
            byId: structuredClone(state.byId),
            rootOrder: structuredClone(state.rootOrder),
            childrenByParent: structuredClone(state.childrenByParent),
          },
        };
      },
    };
  });
}

export const useBuilderStore = createBuilderStore();
export { HISTORY_LIMIT };
