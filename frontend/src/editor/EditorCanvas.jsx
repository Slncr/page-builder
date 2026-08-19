import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { InteractiveBlock, StaticBlock } from '@construktor/renderer';
import { useCallback, useEffect, useRef } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary.jsx';
import { getBlockDefinition } from '../registry/index.js';
import { rendererAdapters } from '../renderer/integrations.js';
import { withBasePath } from '../routing/basePath.js';
import { useBuilderStore } from '../store/builderStore.js';
import { prioritizeDropCollisions } from './dropCollision.js';
import InlineRichText from './InlineRichText.jsx';

function editorCollisionDetection(args) {
  const pointerCollisions = pointerWithin(args);
  if (!pointerCollisions.length) return rectIntersection(args);
  return prioritizeDropCollisions(
    pointerCollisions,
    useBuilderStore.getState(),
    args.droppableRects,
  );
}

function ChildDropZone({ parentId, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: `inside:${parentId}` });
  return (
    <div ref={setNodeRef} className={`pb-editor-children${isOver ? ' is-over' : ''}`}>
      {children}
    </div>
  );
}

function BlockPreview({ block, selected }) {
  const childIds = useBuilderStore((state) => state.childrenByParent[block.id] || []);
  const title = useBuilderStore((state) => state.title);
  const routePath = useBuilderStore((state) => state.routePath);
  const contentType = useBuilderStore((state) => state.contentType);
  const sectionKey = useBuilderStore((state) => state.sectionKey);
  const listingMeta = useBuilderStore((state) => state.listingMeta);
  const definition = getBlockDefinition(block.type);
  const document = { title, routePath, contentType, sectionKey, listingMeta };

  if (block.type === 'richText' || block.type === 'text') {
    return <InlineRichText block={block} selected={selected} />;
  }
  if (definition?.interactive) {
    return (
      <InteractiveBlock
        block={block}
        document={document}
        adapters={rendererAdapters}
      />
    );
  }

  const children = definition?.acceptsChildren ? (
    <ChildDropZone parentId={block.id}>
      <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
        {childIds.length
          ? childIds.map((id) => <SortableBlock id={id} key={id} />)
          : <div className="pb-editor-drop-hint">Перетащите или добавьте блоки сюда</div>}
      </SortableContext>
    </ChildDropZone>
  ) : null;

  return (
    <StaticBlock block={block} document={document} adapters={rendererAdapters}>
      {children}
    </StaticBlock>
  );
}

function SortableBlock({ id }) {
  const block = useBuilderStore((state) => state.byId[id]);
  const selected = useBuilderStore((state) => state.selectedId === id);
  const selectBlock = useBuilderStore((state) => state.selectBlock);
  const removeBlock = useBuilderStore((state) => state.removeBlock);
  const duplicateBlock = useBuilderStore((state) => state.duplicateBlock);
  const definition = getBlockDefinition(block?.type);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    data: {
      parentId: block?.parentId ?? null,
      acceptsChildren: Boolean(definition?.acceptsChildren),
    },
  });

  if (!block) return null;
  return (
    <div
      ref={setNodeRef}
      className={`pb-editor-block${selected ? ' is-selected' : ''}${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={(event) => {
        event.stopPropagation();
        selectBlock(id);
      }}
      data-editor-block-id={id}
    >
      <div className="pb-editor-block__label">{definition?.label || block.type}</div>
      {selected && (
        <div className="pb-editor-block__actions">
          <button type="button" className="pb-drag-handle" {...attributes} {...listeners} aria-label={`Переместить блок «${definition?.label || block.type}»`}>⠿</button>
          <button type="button" onClick={(event) => { event.stopPropagation(); duplicateBlock(id); }} aria-label="Дублировать блок">⧉</button>
          <button type="button" onClick={(event) => { event.stopPropagation(); removeBlock(id); }} aria-label="Удалить блок">⌫</button>
        </div>
      )}
      <ErrorBoundary resetKey={`${id}-${JSON.stringify(block.props)}`} showDetails>
        <BlockPreview block={block} selected={selected} />
      </ErrorBoundary>
    </div>
  );
}

function DeviceFrame() {
  const frame = useRef(null);
  const pageId = useBuilderStore((state) => state.pageId);
  const device = useBuilderStore((state) => state.device);
  const byId = useBuilderStore((state) => state.byId);
  const rootOrder = useBuilderStore((state) => state.rootOrder);
  const childrenByParent = useBuilderStore((state) => state.childrenByParent);
  const title = useBuilderStore((state) => state.title);
  const slug = useBuilderStore((state) => state.slug);
  const routePath = useBuilderStore((state) => state.routePath);
  const contentType = useBuilderStore((state) => state.contentType);
  const sectionKey = useBuilderStore((state) => state.sectionKey);
  const listingMeta = useBuilderStore((state) => state.listingMeta);
  const seo = useBuilderStore((state) => state.seo);
  const locale = useBuilderStore((state) => state.locale);
  const deviceLabel = {
    desktop: 'Компьютер',
    tablet: 'Планшет',
    mobile: 'Телефон',
  }[device] || 'Устройство';
  const send = useCallback(() => {
    frame.current?.contentWindow?.postMessage({
      type: 'pb:render',
      page: {
        id: pageId,
        title,
        slug,
        routePath,
        contentType,
        sectionKey,
        listingMeta,
        seo,
        locale,
        content: { byId, rootOrder, childrenByParent },
      },
    }, window.location.origin);
  }, [
    byId,
    childrenByParent,
    contentType,
    listingMeta,
    locale,
    pageId,
    rootOrder,
    routePath,
    sectionKey,
    seo,
    slug,
    title,
  ]);

  useEffect(() => {
    send();
  }, [send]);

  // Frame page announces readiness after React/session mount; onLoad alone races that.
  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'pb:ready') return;
      if (event.source && event.source !== frame.current?.contentWindow) return;
      send();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [send]);

  return (
    <div className={`pb-device-frame pb-device-frame--${device}`}>
      <iframe
        ref={frame}
        title={`Предпросмотр страницы: ${deviceLabel}`}
        src={withBasePath(`/admin/builder/pages/${pageId}/frame`)}
        onLoad={send}
      />
    </div>
  );
}

export default function EditorCanvas() {
  const rootOrder = useBuilderStore((state) => state.rootOrder);
  const device = useBuilderStore((state) => state.device);
  const canvasMode = useBuilderStore((state) => state.canvasMode);
  const selectBlock = useBuilderStore((state) => state.selectBlock);
  const moveBlock = useBuilderStore((state) => state.moveBlock);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const dragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const state = useBuilderStore.getState();
    if (overId.startsWith('inside:')) {
      const parentId = overId.slice('inside:'.length);
      moveBlock(activeId, parentId, (state.childrenByParent[parentId] || []).length);
      return;
    }
    const target = state.byId[overId];
    if (!target) return;
    const siblings = target.parentId
      ? state.childrenByParent[target.parentId] || []
      : state.rootOrder;
    moveBlock(activeId, target.parentId, siblings.indexOf(overId));
  };

  if (canvasMode === 'preview') {
    return <section className="pb-editor-canvas pb-editor-canvas--preview"><DeviceFrame /></section>;
  }

  return (
    <section className="pb-editor-canvas" onClick={() => selectBlock(null)} aria-label="Холст страницы">
      <DndContext
        sensors={sensors}
        collisionDetection={editorCollisionDetection}
        onDragEnd={dragEnd}
      >
        <div
          className={`pb-editor-page pb-editor-page--${device}`}
          data-construktor-renderer
          data-pb-root
          data-pb-preview={device}
        >
          <SortableContext items={rootOrder} strategy={verticalListSortingStrategy}>
            {rootOrder.length
              ? rootOrder.map((id) => <SortableBlock id={id} key={id} />)
              : (
                <div className="pb-editor-empty">
                  <span aria-hidden="true">＋</span>
                  <strong>Начните с блока</strong>
                  <p>Выберите блок на левой панели, чтобы приступить к созданию страницы.</p>
                </div>
              )}
          </SortableContext>
        </div>
      </DndContext>
    </section>
  );
}
