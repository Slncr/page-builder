import React, { Component, useEffect } from 'react';
import {
  defaultAssetResolver,
  defaultFormSubmitter,
  defaultIntegrationAdapters,
  defaultIntegrationSlots,
  defaultLinkResolver,
} from './integrations.js';
import {
  InteractiveBlock,
  isInteractiveBlock,
} from './InteractiveBlocks.jsx';
import { StaticBlock } from './StaticBlocks.jsx';

const STATIC_BLOCK_TYPES = new Set([
  'section',
  'container',
  'columns',
  'spacer',
  'divider',
  'heading',
  'richText',
  'text',
  'quote',
  'image',
  'file',
  'button',
  'cta',
  'card',
  'hero',
  'features',
  'featureList',
  'table',
  'list',
  'stats',
  'testimonials',
  'pricing',
  'embed',
  'html',
  'map',
  'breadcrumbs',
  'pageList',
  'navbar',
  'footer',
]);

export class MissingIntegrationSlotError extends Error {
  constructor(slotName, blockId) {
    super(`Required integration slot "${slotName}" is unavailable.`);
    this.name = 'MissingIntegrationSlotError';
    this.slotName = slotName;
    this.blockId = blockId;
  }
}

class RendererErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.props.onError?.(error, info);
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const missingIntegration = error instanceof MissingIntegrationSlotError;
    return (
      <div
        className={`pb-block-error${missingIntegration ? ' pb-integration-error' : ''}`}
        role="alert"
        data-pb-block={this.props.blockType || undefined}
        data-pb-block-id={this.props.blockId || undefined}
      >
        <strong>
          {missingIntegration
            ? 'Required integration is unavailable.'
            : 'Не удалось отобразить этот блок.'}
        </strong>
        {(missingIntegration || this.props.showDetails) && <small>{error.message}</small>}
      </div>
    );
  }
}

function treeToNormalized(blocks = []) {
  const byId = {};
  const rootOrder = [];
  const childrenByParent = {};

  const visit = (block, parentId = null) => {
    if (!block || typeof block === 'string' || !block.id) return null;
    byId[block.id] = { ...block, parentId, props: block.props || {} };
    childrenByParent[block.id] = [];
    const nested = [
      ...(block.children || []),
      ...Object.values(block.slots || {}).flat(),
    ];
    for (const child of nested) {
      const childId = visit(child, block.id);
      if (childId && !childrenByParent[block.id].includes(childId)) {
        childrenByParent[block.id].push(childId);
      }
    }
    return block.id;
  };

  for (const block of blocks) {
    const id = visit(block);
    if (id) rootOrder.push(id);
  }
  return { byId, rootOrder, childrenByParent };
}

export function normalizeRendererDocument(value) {
  const envelope = value?.document && !value?.content ? value.document : value;
  const content = envelope?.content || envelope || {};
  if (content.byId || content.rootOrder || content.childrenByParent) {
    return {
      byId: content.byId || {},
      rootOrder: content.rootOrder || [],
      childrenByParent: content.childrenByParent || {},
    };
  }
  return treeToNormalized(content.blocks || []);
}

function integrationDescriptor(block, slots) {
  const props = block.props || {};
  const declared = block.integration || props.integration || {};
  const requiredSlot = block.requiredIntegrationSlot || props.requiredIntegrationSlot;
  let name = (
    (typeof requiredSlot === 'string' ? requiredSlot : '')
    || block.integrationSlot
    || props.integrationSlot
    || declared.slot
    || declared.name
    || props.slotName
    || props.slot
    || ''
  );
  if (!name && block.type?.startsWith('integration:')) {
    name = block.type.slice('integration:'.length);
  }
  if (!name && ['integration', 'integrationSlot'].includes(block.type)) {
    name = props.name || props.key || block.type;
  }
  if (!name && slots?.[block.type]) name = block.type;
  const slot = name ? slots?.[name] : null;
  const slotConfig = slot && typeof slot === 'object' && !React.isValidElement(slot)
    ? slot
    : null;
  const required = Boolean(
    requiredSlot
    || block.integrationRequired
    || props.integrationRequired
    || declared.required
    || slotConfig?.required
    || (
      ['integration', 'integrationSlot'].includes(block.type)
      && props.required !== false
    )
    || (
      name
      && props.required === true
    ),
  );
  return { name, slot, slotConfig, required };
}

function IntegrationSlot({
  descriptor,
  block,
  document,
  children,
  adapters,
}) {
  if (!descriptor.slot) {
    if (descriptor.required) {
      throw new MissingIntegrationSlotError(
        descriptor.name || block.type || 'unknown',
        block.id,
      );
    }
    return null;
  }

  const slotProps = {
    block,
    document,
    children,
    assetResolver: adapters.assetResolver,
    formSubmitter: adapters.formSubmitter,
    linkResolver: adapters.linkResolver,
    integrationSlots: adapters.integrationSlots,
  };
  if (React.isValidElement(descriptor.slot)) {
    return React.cloneElement(descriptor.slot, slotProps);
  }
  const SlotComponent = descriptor.slotConfig?.component
    || descriptor.slotConfig?.render
    || descriptor.slot;
  if (typeof SlotComponent !== 'function' && typeof SlotComponent !== 'string') {
    if (descriptor.required) {
      throw new MissingIntegrationSlotError(descriptor.name, block.id);
    }
    return null;
  }
  return <SlotComponent {...slotProps} />;
}

function RenderNode({
  id,
  normalized,
  document,
  adapters,
  ancestry = new Set(),
  editor = false,
  onError,
}) {
  const block = normalized.byId[id];
  if (!block || ancestry.has(id)) return null;
  const nextAncestry = new Set(ancestry).add(id);
  const children = (normalized.childrenByParent[id] || []).map((childId) => (
    <RenderNode
      id={childId}
      normalized={normalized}
      document={document}
      adapters={adapters}
      ancestry={nextAncestry}
      editor={editor}
      onError={onError}
      key={childId}
    />
  ));
  const descriptor = integrationDescriptor(block, adapters.integrationSlots);
  const customIntegration = Boolean(
    descriptor.name
    || descriptor.slot
    || descriptor.required,
  );

  return (
    <RendererErrorBoundary
      resetKey={`${id}-${JSON.stringify(block.props)}`}
      showDetails={editor}
      onError={onError}
      blockId={id}
      blockType={block.type}
    >
      <div
        className={`pb-block pb-block--${block.type}`}
        data-pb-block={block.type}
        data-pb-block-id={id}
      >
        {customIntegration ? (
          <IntegrationSlot
            descriptor={descriptor}
            block={block}
            document={document}
            adapters={adapters}
          >
            {children}
          </IntegrationSlot>
        ) : isInteractiveBlock(block.type) ? (
          <InteractiveBlock block={block} document={document} adapters={adapters} />
        ) : STATIC_BLOCK_TYPES.has(block.type) ? (
          <StaticBlock block={block} document={document} adapters={adapters}>
            {children}
          </StaticBlock>
        ) : (
          <div className="pb-placeholder">Неподдерживаемый блок: {block.type}</div>
        )}
      </div>
    </RendererErrorBoundary>
  );
}

export function PublicRenderer({
  document,
  page,
  assetResolver = defaultAssetResolver,
  formSubmitter = defaultFormSubmitter,
  linkResolver = defaultLinkResolver,
  pageFeedResolver = defaultIntegrationAdapters.pageFeedResolver,
  integrationSlots = defaultIntegrationSlots,
  className = '',
  editor = false,
  onError,
}) {
  const source = document || page || {};
  const metadata = source.page
    ? { ...source.page, document: source.document }
    : source;
  const normalized = normalizeRendererDocument(source);
  const adapters = {
    assetResolver,
    formSubmitter,
    linkResolver,
    pageFeedResolver,
    integrationSlots: integrationSlots || defaultIntegrationSlots,
  };

  useEffect(() => {
    if (!globalThis.document?.documentElement) return undefined;
    const previous = globalThis.document.documentElement.lang;
    globalThis.document.documentElement.lang = metadata?.locale || 'ru';
    return () => {
      globalThis.document.documentElement.lang = previous || 'ru';
    };
  }, [metadata?.locale]);

  return (
    <main
      data-construktor-renderer
      data-pb-root
      className={className}
      data-page-id={metadata?.id || undefined}
    >
      {normalized.rootOrder.length ? normalized.rootOrder.map((id) => (
        <RenderNode
          id={id}
          normalized={normalized}
          document={metadata}
          adapters={adapters}
          editor={editor}
          onError={onError}
          key={id}
        />
      )) : (
        <section className="pb-empty">
          <h1>Эта страница ещё готовится.</h1>
        </section>
      )}
    </main>
  );
}

export const ConstruktorRenderer = PublicRenderer;
export default PublicRenderer;
