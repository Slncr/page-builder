import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DevicePreviewPage } from './PreviewPages.jsx';

vi.mock('@construktor/renderer', () => ({
  ConstruktorRenderer: ({ document }) => (
    <div data-testid="preview-doc">{document?.title || 'empty'}</div>
  ),
}));

vi.mock('../renderer/integrations.js', () => ({
  rendererAdapters: {},
}));

describe('DevicePreviewPage handshake', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('announces ready and renders after pb:render from the parent', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage');
    render(
      <MemoryRouter>
        <DevicePreviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Подготовка предпросмотра…')).toBeInTheDocument();
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'pb:ready' },
      window.location.origin,
    );

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: 'pb:render',
          page: { title: 'Черновик новости', content: { byId: {}, rootOrder: [], childrenByParent: {} } },
        },
      }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('preview-doc')).toHaveTextContent('Черновик новости');
    });
  });
});
