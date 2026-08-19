import { describe, expect, it } from 'vitest';
import { SITE_PATHS, SITE_TEMPLATE_CATEGORIES, SITE_TEMPLATES } from './siteTemplates.js';

const ALLOWED_URL = /^(?:\/doctors(?:\/|$|\?)|\/about\/news(?:\/|$|\?)|\/about\/articles(?:\/|$|\?)|\/services\/directions(?:\/|$|\?)|tel:|#)/;

function collectUrls(block) {
  const props = block.props || {};
  const urls = [];
  for (const key of ['url', 'href', 'link', 'sourceUrl', 'primaryHref', 'secondaryHref']) {
    if (props[key]) urls.push(props[key]);
  }
  for (const button of props.buttons || []) {
    if (button.url) urls.push(button.url);
  }
  for (const item of props.items || []) {
    if (item.href) urls.push(item.href);
    if (item.link) urls.push(item.link);
    if (item.url) urls.push(item.url);
  }
  return urls;
}

describe('editorial site templates', () => {
  it('ships genuinely different news and article layouts for the about shell', () => {
    expect(SITE_TEMPLATE_CATEGORIES.map(({ id }) => id)).toEqual(['news', 'articles']);
    expect(SITE_TEMPLATES).toHaveLength(10);
    expect(SITE_TEMPLATES.every((item) => item.layout.shell === 'about')).toBe(true);
    expect(SITE_TEMPLATES.every((item) => ['news', 'article'].includes(item.contentType))).toBe(true);

    const news = SITE_TEMPLATES.filter((item) => item.category === 'news');
    const articles = SITE_TEMPLATES.filter((item) => item.category === 'articles');
    expect(news.length).toBeGreaterThanOrEqual(5);
    expect(articles.length).toBeGreaterThanOrEqual(5);

    const signatures = new Set();
    const visualVariants = new Set();
    for (const template of SITE_TEMPLATES) {
      const blocks = Object.values(template.content.byId);
      expect(blocks.some((block) => block.type === 'heading' && block.props.level === 'h1')).toBe(true);
      expect(blocks.some((block) => block.type === 'navbar' || block.type === 'footer' || block.type === 'hero')).toBe(false);
      expect(blocks.some((block) => block.type === 'cta')).toBe(true);
      expect(blocks.some((block) => block.type === 'section')).toBe(true);
      expect(blocks.some((block) => block.props.variant === 'eyebrow')).toBe(true);
      expect(blocks.some((block) => block.props.variant === 'lead')).toBe(true);
      expect(template.preview?.layout).toBeTruthy();
      expect(template.listingMeta.excerpt).toBeTruthy();

      const sectionVariants = blocks
        .filter((block) => block.type === 'section')
        .map((block) => block.props.styleVariant);
      for (const section of blocks.filter((block) => block.type === 'section')) {
        expect(section.props.containerWidth).toBe('full');
        const children = template.content.childrenByParent[section.id];
        expect(children).toHaveLength(1);
        const inner = template.content.byId[children[0]];
        expect(inner.type).toBe('container');
        expect(inner.props.width).not.toBe('narrow');
      }
      for (const columns of blocks.filter((block) => block.type === 'columns')) {
        const children = template.content.childrenByParent[columns.id];
        expect(children.length).toBeGreaterThan(0);
        for (const childId of children) {
          expect(template.content.byId[childId].type).toBe('container');
          expect(template.content.byId[childId].props.width).toBe('full');
        }
      }
      sectionVariants.forEach((variant) => visualVariants.add(variant));
      signatures.add(blocks.map((block) => block.type).join('>'));
    }

    expect(signatures.size).toBeGreaterThanOrEqual(7);
    expect(visualVariants.size).toBeGreaterThanOrEqual(10);
    expect(articles.filter((item) => (
      Object.values(item.content.byId).some((block) => block.type === 'faq')
    )).length).toBeGreaterThanOrEqual(4);
    expect(articles.every((item) => (
      Object.values(item.content.byId).some((block) => block.type === 'pageList')
    ))).toBe(true);
    expect(SITE_TEMPLATES.filter((item) => (
      Object.values(item.content.byId).some((block) => block.props.usePageCover)
    )).length).toBeGreaterThanOrEqual(5);
  });

  it('uses wide containers and public clinic routes instead of the admin mount', () => {
    expect(SITE_PATHS).toEqual({
      doctors: '/doctors',
      news: '/about/news',
      articles: '/about/articles',
      directions: '/services/directions',
    });

    for (const template of SITE_TEMPLATES) {
      expect(template.content.rootOrder.every((id) => (
        template.content.byId[id].type === 'section'
      ))).toBe(true);

      for (const block of Object.values(template.content.byId)) {
        if (block.type === 'container') {
          expect(block.props.width).not.toBe('narrow');
        }
        if (block.type === 'section') {
          expect(block.props.containerWidth).toBe('full');
        }
        for (const url of collectUrls(block)) {
          expect(url, `${template.id} ${block.type} ${url}`).not.toMatch(/page-builder/);
          expect(url, `${template.id} ${block.type} ${url}`).toMatch(ALLOWED_URL);
        }
      }
    }
  });
});
