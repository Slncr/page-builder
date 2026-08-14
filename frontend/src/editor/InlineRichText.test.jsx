import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tiptap/react', () => ({
  EditorContent: () => <div data-testid="editor-content" />,
  useEditor: () => ({
    commands: { setContent: vi.fn() },
    getHTML: () => '<p>Текст</p>',
  }),
}));

import InlineRichText from './InlineRichText.jsx';

describe('InlineRichText', () => {
  it.each(['left', 'center', 'right'])('applies %s alignment in the editor', (align) => {
    const { container } = render(
      <InlineRichText
        block={{
          id: `text-${align}`,
          props: { align, html: '<p>Текст</p>' },
        }}
        selected={false}
      />,
    );

    expect(container.firstChild).toHaveClass(`pb-align--${align}`);
  });
});
