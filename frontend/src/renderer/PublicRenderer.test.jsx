import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConstruktorRenderer as PublicRenderer } from '@construktor/renderer';
import { describe, expect, it, vi } from 'vitest';
import { createBlock } from '../registry/index.js';

function pageWith(...blocks) {
  return {
    id: 'test-page',
    content: {
      byId: Object.fromEntries(blocks.map((block) => [block.id, block])),
      rootOrder: blocks.map((block) => block.id),
      childrenByParent: Object.fromEntries(blocks.map((block) => [block.id, []])),
    },
  };
}

describe('public renderer', () => {
  it('renders normalized content under the public scope', () => {
    const heading = createBlock('heading', { props: { text: 'Accessible heading', level: 2 } });
    const { container } = render(<PublicRenderer document={pageWith(heading)} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Accessible heading' })).toBeInTheDocument();
    expect(container.querySelector('[data-pb-root]')).toBeInTheDocument();
    expect(container.querySelector('[data-pb-block="heading"]')).toHaveAttribute('data-pb-block-id', heading.id);
  });

  it('sanitizes rich text and custom HTML', () => {
    const html = createBlock('html', {
      props: { html: '<p>Safe copy</p><script>window.hacked=true</script><img src=x onerror="window.hacked=true">' },
    });
    const { container } = render(<PublicRenderer document={pageWith(html)} />);
    expect(screen.getByText('Safe copy')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).not.toHaveAttribute('onerror');
  });

  it('provides accessible accordion behavior from the lazy interactive bundle', async () => {
    const accordion = createBlock('accordion', {
      props: {
        items: [{ title: 'First question', content: '<p>First answer</p>' }],
        allowMultiple: false,
      },
    });
    render(<PublicRenderer document={pageWith(accordion)} />);
    const trigger = await screen.findByRole('button', { name: /First question/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('region', { hidden: true })).not.toBeVisible();
  });

  it('renders tables with a caption and scoped row headers', () => {
    const table = createBlock('table', {
      props: { caption: 'Plan comparison', headerRow: ['Plan', 'Price'], rows: [['Basic', '$10']] },
    });
    render(<PublicRenderer document={pageWith(table)} />);
    expect(screen.getByRole('table', { name: 'Plan comparison' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Basic' })).toBeInTheDocument();
  });

  it('has a public renderer for every mandatory block type', async () => {
    const types = [
      'section', 'container', 'columns', 'spacer', 'divider',
      'heading', 'text', 'quote', 'image', 'gallery', 'video', 'file',
      'button', 'cta', 'card', 'featureList', 'accordion', 'tabs',
      'table', 'list', 'form', 'embed', 'html', 'map', 'faq',
      'breadcrumbs', 'pageList',
    ];
    const { container } = render(<PublicRenderer document={pageWith(...types.map((type) => createBlock(type)))} />);
    await waitFor(() => expect(container.querySelector('.pb-block-loading')).toBeNull());
    expect(container).not.toHaveTextContent('Неподдерживаемый блок:');
    for (const type of types) {
      expect(container.querySelector(`[data-pb-block="${type}"]`), type).toBeInTheDocument();
    }
  });

  it('sets the document language from the page with a Russian fallback', () => {
    const { rerender } = render(<PublicRenderer document={pageWith()} />);
    expect(document.documentElement.lang).toBe('ru');
    rerender(<PublicRenderer document={{ ...pageWith(), locale: 'kk' }} />);
    expect(document.documentElement.lang).toBe('kk');
  });

  it('uses host asset and link adapters', () => {
    const image = createBlock('image', {
      props: { assetId: 'asset-id', alt: 'Resolved image' },
    });
    const button = createBlock('button', {
      props: { label: 'Resolved link', url: '/contact' },
    });
    render(
      <PublicRenderer
        document={pageWith(image, button)}
        assetResolver={(id) => `/media/${id}`}
        linkResolver={(href) => `/site${href}`}
      />,
    );

    expect(screen.getByRole('img', { name: 'Resolved image' }))
      .toHaveAttribute('src', '/media/asset-id');
    expect(screen.getByRole('link', { name: 'Resolved link' }))
      .toHaveAttribute('href', '/site/contact');
  });

  it('renders integration slots and reports a missing required slot', () => {
    const available = {
      id: 'available',
      type: 'integrationSlot',
      props: { integrationSlot: 'weather', required: true },
    };
    const missing = {
      id: 'missing',
      type: 'integrationSlot',
      props: { integrationSlot: 'search', required: true },
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <PublicRenderer
        document={pageWith(available, missing)}
        integrationSlots={{
          weather: ({ block }) => <p>Slot ready: {block.id}</p>,
        }}
      />,
    );

    expect(screen.getByText('Slot ready: available')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Required integration slot "search" is unavailable.',
    );
    expect(container.querySelector('[data-pb-block-id="missing"]')).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
