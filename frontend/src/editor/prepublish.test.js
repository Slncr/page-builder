import { describe, expect, it } from 'vitest';
import { getPrepublishWarnings } from './prepublish.js';

function pageWithHeading(level, showPageTitle) {
  return {
    title: 'Страница',
    slug: 'stranitsa',
    layout: { showPageTitle },
    seo: { title: 'Страница', description: 'Описание страницы', socialImage: '' },
    content: {
      byId: {
        heading: {
          id: 'heading',
          type: 'heading',
          props: { level, text: 'Заголовок' },
        },
      },
    },
  };
}

describe('prepublish page title validation', () => {
  it('requires the document H1 when the site shell does not render it', () => {
    const messages = getPrepublishWarnings(pageWithHeading('h2', false))
      .map((warning) => warning.message);

    expect(messages).toContain('На странице должен быть ровно один заголовок первого уровня.');
  });

  it('requires no document H1 when the site shell renders it', () => {
    const validMessages = getPrepublishWarnings(pageWithHeading('h2', true))
      .map((warning) => warning.message);
    const duplicateMessages = getPrepublishWarnings(pageWithHeading('h1', true))
      .map((warning) => warning.message);

    expect(validMessages).not.toContain('На странице должен быть ровно один заголовок первого уровня.');
    expect(duplicateMessages).toContain('Удалите H1 из блоков: его выводит оболочка сайта.');
  });
});
