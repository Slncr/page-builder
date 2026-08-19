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

  it('warns about empty galleries and dynamic page lists without a source', () => {
    const page = {
      title: 'Страница',
      slug: 'stranitsa',
      seo: { title: 'Страница', description: 'Описание страницы', socialImage: '' },
      layout: { showPageTitle: false },
      content: {
        byId: {
          gallery: { id: 'gallery', type: 'gallery', props: { assets: [] } },
          pageList: { id: 'pageList', type: 'pageList', props: { sourceType: 'folder', source: '' } },
          heading: { id: 'heading', type: 'heading', props: { level: 'h1', text: 'Заголовок' } },
        },
        rootOrder: ['gallery', 'pageList', 'heading'],
      },
    };
    const messages = getPrepublishWarnings(page).map((warning) => warning.message);
    expect(messages).toContain('Галерея должна содержать хотя бы одно изображение.');
    expect(messages).toContain('Укажите папку или тег для динамического списка страниц.');
  });

  it('warns about video autoplay without mute and redirect forms without URL', () => {
    const page = {
      title: 'Страница',
      slug: 'stranitsa',
      seo: { title: 'Страница', description: 'Описание страницы', socialImage: '' },
      layout: { showPageTitle: false },
      content: {
        byId: {
          video: {
            id: 'video',
            type: 'video',
            props: { provider: 'youtube', videoUrl: 'https://youtu.be/demo', autoplay: true, muted: false },
          },
          form: {
            id: 'form',
            type: 'form',
            props: { successAction: 'redirect', redirectUrl: '', fields: [{ name: 'email', label: 'Email', type: 'email' }] },
          },
          heading: { id: 'heading', type: 'heading', props: { level: 'h1', text: 'Заголовок' } },
        },
        rootOrder: ['video', 'form', 'heading'],
      },
    };
    const messages = getPrepublishWarnings(page).map((warning) => warning.message);
    expect(messages).toContain('Автовоспроизведение видео возможно только без звука.');
    expect(messages).toContain('Укажите URL перенаправления после отправки формы.');
  });

  it('accepts an editorial image backed by the page cover', () => {
    const page = pageWithHeading('h1', false);
    page.listingMeta = {
      coverAssetId: '123e4567-e89b-42d3-a456-426614174000',
    };
    page.content.byId.cover = {
      id: 'cover',
      type: 'image',
      props: { usePageCover: true, decorative: true },
    };
    const messages = getPrepublishWarnings(page).map((warning) => warning.message);
    expect(messages).not.toContain('Для блока обложки выберите обложку в настройках страницы.');
  });
});
