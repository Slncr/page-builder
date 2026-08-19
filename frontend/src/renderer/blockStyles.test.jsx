import { render, screen, waitFor } from '@testing-library/react';
import { ConstruktorRenderer } from '@construktor/renderer';
import { describe, expect, it, vi } from 'vitest';
import { createBlock } from '../registry/index.js';

function pageWith(...blocks) {
  return {
    id: 'style-test-page',
    content: {
      byId: Object.fromEntries(blocks.map((block) => [block.id, block])),
      rootOrder: blocks.map((block) => block.id),
      childrenByParent: Object.fromEntries(blocks.map((block) => [block.id, []])),
    },
  };
}

describe('block presentation styles', () => {
  it.each([
    ['heading', { align: 'center' }, '.pb-heading.pb-align--center'],
    ['text', { align: 'right', html: '<p>Текст</p>' }, '.pb-richtext.pb-align--right'],
    ['image', { align: 'center', assetId: '123e4567-e89b-42d3-a456-426614174000', alt: 'Demo' }, '.pb-image.pb-align--center'],
    ['container', { align: 'right', width: 'narrow' }, '.pb-container.pb-align--right'],
    ['hero', { align: 'left', title: 'Hero title' }, '.pb-hero.pb-align--left'],
  ])('applies alignment classes for %s', (type, props, selector) => {
    const block = createBlock(type, { props });
    const { container } = render(<ConstruktorRenderer document={pageWith(block)} />);
    expect(container.querySelector(selector)).toBeTruthy();
  });

  it('renders feature list column modifiers', () => {
    const block = createBlock('featureList', { props: { columns: 2 } });
    const { container } = render(<ConstruktorRenderer document={pageWith(block)} />);
    expect(container.querySelector('.pb-feature-grid--2')).toBeTruthy();
  });

  it('renders CTA layout modifiers', () => {
    const block = createBlock('cta', { props: { layout: 'center', title: 'CTA' } });
    const { container } = render(<ConstruktorRenderer document={pageWith(block)} />);
    expect(container.querySelector('.pb-cta-layout--center')).toBeTruthy();
  });

  it('renders editorial section variants and asymmetric columns', () => {
    const section = createBlock('section', {
      props: { styleVariant: 'article-magazine' },
    });
    const columns = createBlock('columns', {
      props: { layout: 2, ratio: 'content-aside' },
    });
    const { container } = render(<ConstruktorRenderer document={pageWith(section, columns)} />);
    expect(container.querySelector('.pb-section--article-magazine')).toBeTruthy();
    expect(container.querySelector('[data-pb-variant="article-magazine"]')).toBeTruthy();
    expect(container.querySelector('.pb-columns--ratio-content-aside')).toBeTruthy();
    expect(container.querySelector('.pb-columns')).toHaveClass('pb-stack--mobile');
  });

  it('renders editorial text variants', () => {
    const eyebrow = createBlock('text', {
      props: { html: '<p>Новости</p>', variant: 'eyebrow' },
    });
    const lead = createBlock('text', {
      props: { html: '<p>Краткое введение</p>', variant: 'lead' },
    });
    const { container } = render(<ConstruktorRenderer document={pageWith(eyebrow, lead)} />);
    expect(container.querySelector('.pb-richtext--eyebrow')).toBeTruthy();
    expect(container.querySelector('.pb-richtext--lead')).toBeTruthy();
  });

  it('uses the page listing cover in editorial image blocks', () => {
    const image = createBlock('image', {
      props: { assetId: '', usePageCover: true, decorative: true },
    });
    const document = {
      ...pageWith(image),
      listingMeta: { coverAssetId: '123e4567-e89b-42d3-a456-426614174000' },
    };
    const { container } = render(
      <ConstruktorRenderer
        document={document}
        assetResolver={(id) => `/assets/${id}`}
      />,
    );
    expect(container.querySelector('.pb-image__media')).toHaveAttribute(
      'src',
      '/assets/123e4567-e89b-42d3-a456-426614174000',
    );
  });

  it('renders quote layout modifiers', () => {
    const block = createBlock('quote', { props: { layout: 'large', text: 'Quote text' } });
    const { container } = render(<ConstruktorRenderer document={pageWith(block)} />);
    expect(container.querySelector('.pb-quote--large')).toBeTruthy();
    expect(screen.getByText('Quote text')).toBeInTheDocument();
  });

  it('sets responsive spacer css variables', () => {
    const block = createBlock('spacer', {
      props: { height: 48, heightTablet: 32, heightMobile: 16 },
    });
    const { container } = render(<ConstruktorRenderer document={pageWith(block)} />);
    const spacer = container.querySelector('.pb-spacer');
    expect(spacer).toBeTruthy();
    expect(spacer.style.getPropertyValue('--pb-spacer-height')).toBe('48px');
    expect(spacer.style.getPropertyValue('--pb-spacer-tablet')).toBe('32px');
    expect(spacer.style.getPropertyValue('--pb-spacer-mobile')).toBe('16px');
  });

  it('renders button size and tabs layout modifiers', () => {
    const button = createBlock('button', { props: { label: 'Small', url: '#', size: 'small' } });
    const tabs = createBlock('tabs', { props: { layout: 'vertical', tabs: [{ label: 'A', content: '<p>A</p>' }] } });
    const list = createBlock('list', { props: { style: 'checks', items: [{ text: 'Done' }] } });
    const { container } = render(<ConstruktorRenderer document={pageWith(button, tabs, list)} />);
    expect(container.querySelector('.pb-button--small')).toBeTruthy();
    expect(container.querySelector('.pb-tabs--vertical')).toBeTruthy();
    expect(container.querySelector('.pb-list--checks')).toBeTruthy();
  });

  it('loads dynamic page lists with page metadata context', async () => {
    const pageList = createBlock('pageList', {
      props: {
        sourceType: 'folder',
        source: '',
        items: [{ title: 'Fallback', description: 'Manual', href: '/fallback' }],
      },
    });
    const feedResolver = vi.fn(async () => ({
      items: [{ title: 'News item', description: 'Latest', href: '/news/item' }],
    }));
    render(
      <ConstruktorRenderer
        document={{ ...pageWith(pageList), contentType: 'news', sectionKey: 'launch' }}
        pageFeedResolver={feedResolver}
      />,
    );
    await waitFor(() => expect(feedResolver).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: 'folder',
      contentType: 'news',
      sectionKey: 'launch',
    })));
    expect(await screen.findByRole('link', { name: 'News item' })).toBeInTheDocument();
  });
});
